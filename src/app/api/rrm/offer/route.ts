import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, bookings, marketplaceOffers, parkingEvents } from "@/db";
import { requireAuth } from "@/lib/auth";
import { recordAiActivity } from "@/lib/ai-provider";

const offerSchema = z.object({
  bookingId: z.number().int().positive(),
  askingPrice: z.number().positive(),
});

export async function POST(request: Request) {
  const started = Date.now();
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const parsed = offerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Valid bookingId and askingPrice required" }, { status: 400 });
  }

  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, parsed.data.bookingId))
    .limit(1);

  if (!booking) {
    return Response.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.userId !== auth.user.id) {
    return Response.json({ error: "You can only list your own booking." }, { status: 403 });
  }
  if (booking.status !== "confirmed") {
    return Response.json(
      { error: "Only upcoming confirmed bookings can be listed on the marketplace." },
      { status: 400 }
    );
  }

  const [offer] = await db
    .insert(marketplaceOffers)
    .values({
      bookingId: booking.id,
      sellerId: auth.user.id,
      lotId: booking.lotId,
      slotId: booking.slotId,
      askingPrice: parsed.data.askingPrice,
      originalPrice: booking.finalAmount,
      status: "open",
      expiresAt: booking.endTime,
    })
    .returning();

  await db.insert(parkingEvents).values({
    eventType: "rrm_offer_listed",
    lotId: booking.lotId,
    slotId: booking.slotId,
    bookingId: booking.id,
    actorId: auth.user.id,
    actorRole: auth.user.role,
    details: { offerId: offer.id, askingPrice: offer.askingPrice },
  });

  await recordAiActivity({
    endpoint: "/api/rrm/offer",
    module: "RRM",
    userId: auth.user.id,
    lotId: booking.lotId,
    requestPayload: parsed.data as unknown as Record<string, unknown>,
    responsePayload: { offerId: offer.id },
    provider: "deterministic-engine",
    latencyMs: Math.max(3, Date.now() - started),
  });

  return Response.json({ offer }, { status: 201 });
}
