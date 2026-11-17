import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, bookings, marketplaceOffers, parkingEvents } from "@/db";
import { requireAuth } from "@/lib/auth";
import { createSignedQr } from "@/lib/qr";
import { recordAiActivity } from "@/lib/ai-provider";

const takeSchema = z.object({
  offerId: z.number().int().positive(),
  vehicleNumber: z.string().trim().min(3).max(30).optional(),
});

export async function POST(request: Request) {
  const started = Date.now();
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const parsed = takeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Valid offerId required" }, { status: 400 });
  }

  const [offer] = await db
    .select()
    .from(marketplaceOffers)
    .where(eq(marketplaceOffers.id, parsed.data.offerId))
    .limit(1);

  if (!offer || offer.status !== "open") {
    return Response.json({ error: "Marketplace offer is no longer available." }, { status: 404 });
  }
  if (offer.sellerId === auth.user.id) {
    return Response.json({ error: "You cannot claim your own marketplace offer." }, { status: 400 });
  }

  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, offer.bookingId))
    .limit(1);

  if (!booking) {
    return Response.json({ error: "Linked booking not found." }, { status: 404 });
  }

  const newQr = createSignedQr({
    bookingCode: booking.bookingCode,
    lotId: booking.lotId,
    slotId: booking.slotId,
    userId: auth.user.id,
    endTime: booking.endTime,
  });

  const updated = await db.transaction(async (tx) => {
    const [claimedOffer] = await tx
      .update(marketplaceOffers)
      .set({ buyerId: auth.user.id, status: "claimed" })
      .where(eq(marketplaceOffers.id, offer.id))
      .returning();

    const [transferredBooking] = await tx
      .update(bookings)
      .set({
        userId: auth.user.id,
        vehicleNumber: (
          parsed.data.vehicleNumber ||
          auth.user.vehicleNumber ||
          booking.vehicleNumber
        ).toUpperCase(),
        finalAmount: offer.askingPrice,
        qrCodePayload: newQr.qrToken,
        qrSignature: newQr.signature,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id))
      .returning();

    await tx.insert(parkingEvents).values({
      eventType: "rrm_offer_claimed",
      lotId: booking.lotId,
      slotId: booking.slotId,
      bookingId: booking.id,
      actorId: auth.user.id,
      actorRole: auth.user.role,
      details: { offerId: offer.id, sellerId: offer.sellerId, buyerId: auth.user.id },
    });

    return { claimedOffer, transferredBooking };
  });

  await recordAiActivity({
    endpoint: "/api/rrm/take",
    module: "RRM",
    userId: auth.user.id,
    lotId: booking.lotId,
    requestPayload: parsed.data as unknown as Record<string, unknown>,
    responsePayload: { offerId: offer.id, bookingCode: booking.bookingCode },
    provider: "deterministic-engine",
    latencyMs: Math.max(4, Date.now() - started),
  });

  return Response.json({
    ok: true,
    offer: updated.claimedOffer,
    booking: updated.transferredBooking,
    message: "Reservation transferred and QR code re-signed for your account.",
  });
}
