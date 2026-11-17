import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, payments, parkingEvents } from "@/db";
import { requireAuth, logAudit } from "@/lib/auth";

const verifySchema = z.object({
  transactionId: z.string().trim().min(5),
  verificationCode: z.string().trim().min(4).max(32),
  utrReference: z.string().trim().min(6).max(40).optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Valid transactionId and verificationCode are required." },
      { status: 400 }
    );
  }

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.transactionId, parsed.data.transactionId))
    .limit(1);

  if (!payment) {
    return Response.json({ error: "Payment transaction not found." }, { status: 404 });
  }

  if (
    payment.userId !== auth.user.id &&
    auth.user.role !== "admin" &&
    auth.user.role !== "superadmin"
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (payment.status === "verified") {
    return Response.json({ payment, message: "Payment is already verified." });
  }

  // Strict server-side verification: require exact matching server-issued verificationCode
  if (
    !payment.verificationCode ||
    payment.verificationCode !== parsed.data.verificationCode.trim()
  ) {
    await logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: "PAYMENT_VERIFICATION_REJECTED",
      entityType: "payment",
      entityId: payment.id,
      outcome: "denied",
      metadata: { transactionId: payment.transactionId },
    });
    return Response.json(
      { error: "Verification code mismatch. Payment cannot be marked verified." },
      { status: 400 }
    );
  }

  const now = new Date();
  const [updated] = await db
    .update(payments)
    .set({
      status: "verified",
      verifiedAt: now,
      metadata: {
        ...(payment.metadata ?? {}),
        utrReference: parsed.data.utrReference || `UTR${Date.now()}`,
        verifiedByUserId: auth.user.id,
      },
    })
    .where(eq(payments.id, payment.id))
    .returning();

  await db.insert(parkingEvents).values({
    eventType: "payment_verified",
    bookingId: payment.bookingId,
    actorId: auth.user.id,
    actorRole: auth.user.role,
    details: {
      transactionId: payment.transactionId,
      amount: payment.amount,
      method: payment.method,
    },
  });

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "PAYMENT_VERIFIED",
    entityType: "payment",
    entityId: payment.id,
    metadata: { transactionId: payment.transactionId, amount: payment.amount },
  });

  return Response.json({
    payment: updated,
    message: "Payment verified and recorded successfully.",
  });
}
