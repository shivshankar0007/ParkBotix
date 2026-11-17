import { and, eq, inArray } from "drizzle-orm";
import { db, parkingSlots, bookings, parkingEvents } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { getCurrentUser } from "@/lib/auth";
import { recordAiActivity } from "@/lib/ai-provider";

export async function POST(request: Request) {
  await ensureSeeded();
  const started = Date.now();
  const user = await getCurrentUser();
  const body = (await request.json().catch(() => ({}))) as {
    lotId?: number;
    autoReconcile?: boolean;
  };

  const slots = body.lotId
    ? await db
        .select()
        .from(parkingSlots)
        .where(eq(parkingSlots.lotId, Number(body.lotId)))
    : await db.select().from(parkingSlots);

  const activeBookings = await db
    .select()
    .from(bookings)
    .where(inArray(bookings.status, ["confirmed", "active", "pending"]));

  const activeSlotIds = new Set(activeBookings.map((b) => b.slotId));
  const now = new Date();

  const ghosts = slots.filter((slot) => {
    if (slot.status === "reserved" && !activeSlotIds.has(slot.id)) {
      return true;
    }
    if (
      slot.status === "locked" &&
      slot.lockExpiresAt &&
      slot.lockExpiresAt < now
    ) {
      return true;
    }
    return false;
  });

  const canReconcile =
    body.autoReconcile &&
    user &&
    (user.role === "admin" || user.role === "superadmin");

  let reconciledCount = 0;
  if (canReconcile && ghosts.length > 0) {
    for (const g of ghosts) {
      await db
        .update(parkingSlots)
        .set({
          status: "available",
          currentBookingId: null,
          lockExpiresAt: null,
          updatedAt: now,
        })
        .where(and(eq(parkingSlots.id, g.id)));
      await db.insert(parkingEvents).values({
        eventType: "ghost_slot_reconciled",
        lotId: g.lotId,
        slotId: g.id,
        actorId: user.id,
        actorRole: user.role,
        details: { previousStatus: g.status, slotCode: g.slotCode },
      });
      reconciledCount += 1;
    }
  }

  const latencyMs = Math.max(3, Date.now() - started);
  await recordAiActivity({
    endpoint: "/api/gsd/detect",
    module: "GSD",
    userId: user?.id ?? null,
    lotId: body.lotId ?? null,
    requestPayload: body as Record<string, unknown>,
    responsePayload: { ghostsDetected: ghosts.length, reconciledCount },
    provider: "deterministic-engine",
    latencyMs,
  });

  return Response.json({
    module: "GSD (Ghost Slot Detection Engine)",
    provider: "deterministic-engine",
    latencyMs,
    scannedSlotsCount: slots.length,
    ghostSlotsDetected: ghosts.map((g) => ({
      slotId: g.id,
      lotId: g.lotId,
      slotCode: g.slotCode,
      currentStatus: g.status,
      reason: "Marked reserved/locked without active booking or lock expired",
    })),
    reconciledCount,
  });
}
