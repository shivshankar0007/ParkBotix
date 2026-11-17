import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, parkingLots, parkingSlots, evChargingSlots, feedback } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireRole, logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

const updateLotSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  address: z.string().trim().min(4).max(250).optional(),
  city: z.string().trim().min(2).max(80).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  baseHourlyRate: z.number().positive().max(10000).optional(),
  evRateMultiplier: z.number().min(1).max(5).optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  operatingHours: z.string().trim().max(100).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await ensureSeeded();
  const { id } = await context.params;
  const lotId = Number(id);
  if (!Number.isInteger(lotId) || lotId <= 0) {
    return Response.json({ error: "Invalid lot ID" }, { status: 400 });
  }

  const [lot] = await db
    .select()
    .from(parkingLots)
    .where(eq(parkingLots.id, lotId))
    .limit(1);

  if (!lot) {
    return Response.json({ error: "Parking lot not found" }, { status: 404 });
  }

  const [slots, chargers, reviews] = await Promise.all([
    db
      .select()
      .from(parkingSlots)
      .where(eq(parkingSlots.lotId, lotId))
      .orderBy(asc(parkingSlots.id)),
    db.select().from(evChargingSlots).where(eq(evChargingSlots.lotId, lotId)),
    db.select().from(feedback).where(eq(feedback.lotId, lotId)),
  ]);

  const chargerMap = new Map(chargers.map((c) => [c.slotId, c]));
  const enrichedSlots = slots.map((s) => ({
    ...s,
    evCharger: chargerMap.get(s.id) ?? null,
  }));

  return Response.json({
    lot,
    slots: enrichedSlots,
    reviews,
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(["superadmin", "admin", "owner"]);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const lotId = Number(id);
  if (!Number.isInteger(lotId)) {
    return Response.json({ error: "Invalid lot ID" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(parkingLots)
    .where(eq(parkingLots.id, lotId))
    .limit(1);

  if (!existing) {
    return Response.json({ error: "Parking lot not found" }, { status: 404 });
  }

  // Strict owner isolation check
  if (auth.user.role === "owner" && existing.ownerId !== auth.user.id) {
    return Response.json(
      { error: "Forbidden: you can only manage your assigned parking lots." },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = updateLotSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid update payload" },
      { status: 400 }
    );
  }

  const updateData = { ...parsed.data };
  if (auth.user.role === "owner") {
    // Owners cannot reassign lot ownership
    delete updateData.ownerId;
  }

  const [updated] = await db
    .update(parkingLots)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(parkingLots.id, lotId))
    .returning();

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "PARKING_LOT_UPDATED",
    entityType: "parking_lot",
    entityId: lotId,
    metadata: updateData,
  });

  return Response.json({ lot: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const lotId = Number(id);
  if (!Number.isInteger(lotId)) {
    return Response.json({ error: "Invalid lot ID" }, { status: 400 });
  }

  const [deleted] = await db
    .delete(parkingLots)
    .where(eq(parkingLots.id, lotId))
    .returning();

  if (!deleted) {
    return Response.json({ error: "Parking lot not found" }, { status: 404 });
  }

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "PARKING_LOT_DELETED",
    entityType: "parking_lot",
    entityId: lotId,
    metadata: { name: deleted.name },
  });

  return Response.json({ ok: true, deletedId: lotId });
}
