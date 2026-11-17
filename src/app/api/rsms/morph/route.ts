import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, parkingSlots, slotMorphs, parkingEvents } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireRole } from "@/lib/auth";
import { recordAiActivity } from "@/lib/ai-provider";

const morphSchema = z.object({
  slotId: z.number().int().positive(),
  toType: z.enum(["standard", "ev", "compact", "handicapped", "vip"]),
  reason: z.string().trim().min(3).max(200).default("Peak demand dynamic bay morph"),
  durationHours: z.number().min(1).max(24).default(4),
});

export async function POST(request: Request) {
  await ensureSeeded();
  const started = Date.now();
  const auth = await requireRole(["superadmin", "admin", "owner"]);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const parsed = morphSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Valid slotId and toType required" }, { status: 400 });
  }

  const d = parsed.data;
  const [slot] = await db
    .select()
    .from(parkingSlots)
    .where(eq(parkingSlots.id, d.slotId))
    .limit(1);

  if (!slot) {
    return Response.json({ error: "Slot not found" }, { status: 404 });
  }

  if (slot.status !== "available") {
    return Response.json(
      { error: `Cannot morph slot while status is '${slot.status}'.` },
      { status: 409 }
    );
  }

  const activeUntil = new Date(Date.now() + d.durationHours * 60 * 60 * 1000);
  const [morph] = await db
    .insert(slotMorphs)
    .values({
      lotId: slot.lotId,
      slotId: slot.id,
      fromType: slot.slotType,
      toType: d.toType,
      reason: d.reason,
      triggeredBy: auth.user.email,
      activeUntil,
    })
    .returning();

  const [updatedSlot] = await db
    .update(parkingSlots)
    .set({
      slotType: d.toType,
      isEvEnabled: d.toType === "ev" ? true : slot.isEvEnabled,
      updatedAt: new Date(),
    })
    .where(eq(parkingSlots.id, slot.id))
    .returning();

  await db.insert(parkingEvents).values({
    eventType: "slot_morphed",
    lotId: slot.lotId,
    slotId: slot.id,
    actorId: auth.user.id,
    actorRole: auth.user.role,
    details: { fromType: slot.slotType, toType: d.toType, reason: d.reason },
  });

  const latencyMs = Math.max(4, Date.now() - started);
  await recordAiActivity({
    endpoint: "/api/rsms/morph",
    module: "RSMS",
    userId: auth.user.id,
    lotId: slot.lotId,
    requestPayload: d as unknown as Record<string, unknown>,
    responsePayload: { morphId: morph.id, from: slot.slotType, to: d.toType },
    provider: "deterministic-engine",
    latencyMs,
  });

  return Response.json({
    module: "RSMS (Real-Time Slot Morphing System)",
    provider: "deterministic-engine",
    latencyMs,
    morph,
    slot: updatedSlot,
  });
}
