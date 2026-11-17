import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, bookings, shadowReservations, parkingEvents } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireAuth } from "@/lib/auth";
import { recordAiActivity } from "@/lib/ai-provider";

const adjustSchema = z.object({
  bookingId: z.number().int().positive(),
  trafficDelayMinutes: z.number().int().min(5).max(90).default(15),
  routeNote: z.string().trim().max(150).optional(),
});

export async function POST(request: Request) {
  await ensureSeeded();
  const started = Date.now();
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const parsed = adjustSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Valid bookingId and trafficDelayMinutes required" }, { status: 400 });
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

  const delayMs = parsed.data.trafficDelayMinutes * 60 * 1000;
  const adjustedStart = new Date(booking.startTime.getTime() + delayMs);
  const adjustedEnd = new Date(booking.endTime.getTime() + delayMs);

  const [updated] = await db
    .update(bookings)
    .set({
      startTime: adjustedStart,
      endTime: adjustedEnd,
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, booking.id))
    .returning();

  const [shadow] = await db
    .insert(shadowReservations)
    .values({
      userId: booking.userId,
      lotId: booking.lotId,
      slotId: booking.slotId,
      confidenceScore: 0.91,
      predictedArrival: adjustedStart,
      expiresAt: new Date(adjustedStart.getTime() + 20 * 60 * 1000),
      status: "adjusted",
    })
    .returning();

  await db.insert(parkingEvents).values({
    eventType: "dnlrp_traffic_adjustment",
    lotId: booking.lotId,
    slotId: booking.slotId,
    bookingId: booking.id,
    actorId: auth.user.id,
    actorRole: auth.user.role,
    details: {
      trafficDelayMinutes: parsed.data.trafficDelayMinutes,
      routeNote: parsed.data.routeNote || "Traffic congestion detected",
    },
  });

  const latencyMs = Math.max(4, Date.now() - started);
  await recordAiActivity({
    endpoint: "/api/dnlrp/adjust",
    module: "DNLRP",
    userId: auth.user.id,
    lotId: booking.lotId,
    requestPayload: parsed.data as unknown as Record<string, unknown>,
    responsePayload: { adjustedStart: adjustedStart.toISOString() },
    provider: "deterministic-engine",
    latencyMs,
  });

  return Response.json({
    module: "DNLRP (Traffic-Aware Dynamic Reservation Adjustment)",
    provider: "deterministic-engine",
    latencyMs,
    booking: updated,
    shadowReservation: shadow,
    shiftedByMinutes: parsed.data.trafficDelayMinutes,
  });
}
