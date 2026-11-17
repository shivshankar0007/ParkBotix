import crypto from "crypto";
import { z } from "zod";
import { desc, eq, inArray } from "drizzle-orm";
import { db, payments, bookings, parkingLots, settings } from "@/db";
import { requireAuth, logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

const initiatePaymentSchema = z.object({
  bookingId: z.number().int().positive(),
  method: z.enum(["upi", "card", "wallet", "cash"]).default("upi"),
  upiId: z.string().trim().max(80).optional(),
});

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope");

  let rows: Array<typeof payments.$inferSelect> = [];

  if (
    (auth.user.role === "superadmin" || auth.user.role === "admin") &&
    scope === "all"
  ) {
    rows = await db
      .select()
      .from(payments)
      .orderBy(desc(payments.createdAt))
      .limit(100);
  } else if (auth.user.role === "owner" && scope === "owner") {
    const ownedLots = await db
      .select({ id: parkingLots.id })
      .from(parkingLots)
      .where(eq(parkingLots.ownerId, auth.user.id));
    const lotIds = ownedLots.map((l) => l.id);
    if (lotIds.length > 0) {
      const lotBookings = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(inArray(bookings.lotId, lotIds));
      const bIds = lotBookings.map((b) => b.id);
      if (bIds.length > 0) {
        rows = await db
          .select()
          .from(payments)
          .where(inArray(payments.bookingId, bIds))
          .orderBy(desc(payments.createdAt))
          .limit(100);
      }
    }
  } else {
    rows = await db
      .select()
      .from(payments)
      .where(eq(payments.userId, auth.user.id))
      .orderBy(desc(payments.createdAt))
      .limit(50);
  }

  return Response.json({ payments: rows });
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = initiatePaymentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payment initiation request" }, { status: 400 });
  }

  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, parsed.data.bookingId))
    .limit(1);

  if (!booking) {
    return Response.json({ error: "Booking not found" }, { status: 404 });
  }

  if (
    booking.userId !== auth.user.id &&
    auth.user.role !== "admin" &&
    auth.user.role !== "superadmin"
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const [vpaSetting] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "upi_merchant_vpa"))
    .limit(1);
  const merchantVpa =
    process.env.UPI_MERCHANT_VPA || vpaSetting?.value || "parkbotix.smart@okhdfcbank";

  const transactionId = `TXN-UPI-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(2)
    .toString("hex")
    .toUpperCase()}`;
  const verificationCode = String(crypto.randomInt(100000, 999999));

  const [payment] = await db
    .insert(payments)
    .values({
      bookingId: booking.id,
      userId: booking.userId,
      transactionId,
      upiId: parsed.data.upiId || merchantVpa,
      amount: booking.finalAmount,
      method: parsed.data.method,
      status: "pending_verification",
      verificationCode,
      metadata: { merchantVpa, bookingCode: booking.bookingCode },
    })
    .returning();

  const upiUri = `upi://pay?pa=${encodeURIComponent(merchantVpa)}&pn=ParkBotix&am=${booking.finalAmount.toFixed(
    2
  )}&cu=INR&tn=${encodeURIComponent(booking.bookingCode)}`;

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "PAYMENT_INITIATED",
    entityType: "payment",
    entityId: payment.id,
    metadata: { transactionId, amount: payment.amount },
  });

  return Response.json({
    payment,
    upiUri,
    merchantVpa,
    note: "Confirm this payment server-side using /api/payments/verify with the issued verificationCode and UTR reference.",
  });
}
