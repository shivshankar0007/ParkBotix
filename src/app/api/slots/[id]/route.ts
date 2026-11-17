import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, parkingLots, parkingSlots } from "@/db";
import { requireRole, logAudit } from "@/lib/auth";

const updateSlotSchema = z.object({
  status: z.enum(["available", "reserved", "occupied", "locked", "maintenance"]).optional(),
  slotType: z.enum(["standard", "ev", "compact", "handicapped", "vip"]).optional(),
  hourlyRate: z.number().positive().max(10000).optional(),
  floor: z.string().trim().min(1).max(16).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(["superadmin", "admin", "owner"]);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const slotId = Number(id);
  if (!Number.isInteger(slotId)) {
    return Response.json({ error: "Invalid slot ID" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(parkingSlots)
    .where(eq(parkingSlots.id, slotId))
    .limit(1);

  if (!existing) {
    return Response.json({ error: "Slot not found" }, { status: 404 });
  }

  if (auth.user.role === "owner") {
    const [lot] = await db
      .select()
      .from(parkingLots)
      .where(eq(parkingLots.id, existing.lotId))
      .limit(1);
    if (!lot || lot.ownerId !== auth.user.id) {
      return Response.json(
        { error: "Forbidden: cannot edit slots outside your assigned lots." },
        { status: 403 }
      );
    }
  }

  const body = await request.json();
  const parsed = updateSlotSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid slot update" },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(parkingSlots)
    .set({
      ...parsed.data,
      isEvEnabled:
        parsed.data.slotType !== undefined
          ? parsed.data.slotType === "ev"
          : existing.isEvEnabled,
      currentBookingId:
        parsed.data.status === "available" ? null : existing.currentBookingId,
      updatedAt: new Date(),
    })
    .where(eq(parkingSlots.id, slotId))
    .returning();

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "PARKING_SLOT_UPDATED",
    entityType: "parking_slot",
    entityId: slotId,
    metadata: parsed.data,
  });

  return Response.json({ slot: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const slotId = Number(id);
  if (!Number.isInteger(slotId)) {
    return Response.json({ error: "Invalid slot ID" }, { status: 400 });
  }

  const [deleted] = await db
    .delete(parkingSlots)
    .where(eq(parkingSlots.id, slotId))
    .returning();

  if (!deleted) {
    return Response.json({ error: "Slot not found" }, { status: 404 });
  }

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "PARKING_SLOT_DELETED",
    entityType: "parking_slot",
    entityId: slotId,
    metadata: { lotId: deleted.lotId, slotCode: deleted.slotCode },
  });

  return Response.json({ ok: true, deletedId: slotId });
}
