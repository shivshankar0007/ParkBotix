import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, parkingLots, parkingSlots, evChargingSlots } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireRole, logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

const createSlotSchema = z.object({
  lotId: z.number().int().positive(),
  slotCode: z.string().trim().min(1).max(20),
  floor: z.string().trim().min(1).max(16).default("L1"),
  slotType: z.enum(["standard", "ev", "compact", "handicapped", "vip"]).default("standard"),
  hourlyRate: z.number().positive().max(10000),
  isEvEnabled: z.boolean().optional(),
  chargerType: z.string().trim().max(60).optional(),
  powerKw: z.number().positive().max(350).optional(),
});

export async function GET(request: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(request.url);
  const lotIdParam = searchParams.get("lotId");

  const slots = lotIdParam
    ? await db
        .select()
        .from(parkingSlots)
        .where(eq(parkingSlots.lotId, Number(lotIdParam)))
        .orderBy(asc(parkingSlots.id))
    : await db.select().from(parkingSlots).orderBy(asc(parkingSlots.id));

  return Response.json({ slots });
}

export async function POST(request: Request) {
  const auth = await requireRole(["superadmin", "admin", "owner"]);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const parsed = createSlotSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid slot data" },
        { status: 400 }
      );
    }

    const d = parsed.data;
    const [lot] = await db
      .select()
      .from(parkingLots)
      .where(eq(parkingLots.id, d.lotId))
      .limit(1);

    if (!lot) {
      return Response.json({ error: "Parking lot not found" }, { status: 404 });
    }

    if (auth.user.role === "owner" && lot.ownerId !== auth.user.id) {
      return Response.json(
        { error: "Forbidden: cannot add slots to another owner's lot." },
        { status: 403 }
      );
    }

    const isEv = d.isEvEnabled ?? d.slotType === "ev";

    const [created] = await db
      .insert(parkingSlots)
      .values({
        lotId: d.lotId,
        slotCode: d.slotCode.toUpperCase(),
        floor: d.floor,
        slotType: d.slotType,
        status: "available",
        hourlyRate: d.hourlyRate,
        isEvEnabled: isEv,
      })
      .returning();

    if (isEv) {
      await db.insert(evChargingSlots).values({
        slotId: created.id,
        lotId: d.lotId,
        chargerType: d.chargerType || "CCS2 DC Fast",
        powerKw: d.powerKw || 22,
        status: "idle",
        ratePerKwh: 18,
      });
    }

    const lotSlots = await db
      .select({ id: parkingSlots.id })
      .from(parkingSlots)
      .where(eq(parkingSlots.lotId, d.lotId));
    await db
      .update(parkingLots)
      .set({ totalSlots: lotSlots.length, updatedAt: new Date() })
      .where(eq(parkingLots.id, d.lotId));

    await logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: "PARKING_SLOT_CREATED",
      entityType: "parking_slot",
      entityId: created.id,
      metadata: { lotId: d.lotId, slotCode: created.slotCode },
    });

    return Response.json({ slot: created }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to create slot" },
      { status: 500 }
    );
  }
}
