import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, parkingSlots, parkingEvents } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { getCurrentUser } from "@/lib/auth";
import { recordAiActivity } from "@/lib/ai-provider";

const edgeSchema = z.object({
  slotId: z.number().int().positive(),
  sensorConfidence: z.number().min(0).max(1).default(0.94),
  detectedOccupied: z.boolean(),
  cameraNodeId: z.string().trim().max(40).default("EDGE-CAM-L1"),
  applyToSlot: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  await ensureSeeded();
  const started = Date.now();
  const user = await getCurrentUser();

  const body = await request.json().catch(() => ({}));
  const parsed = edgeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Provide slotId and detectedOccupied boolean" },
      { status: 400 }
    );
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

  const dbOccupied = slot.status === "occupied";
  const discrepancy = dbOccupied !== d.detectedOccupied;
  let applied = false;

  if (
    d.applyToSlot &&
    user &&
    (user.role === "admin" || user.role === "superadmin")
  ) {
    await db
      .update(parkingSlots)
      .set({
        status: d.detectedOccupied ? "occupied" : "available",
        updatedAt: new Date(),
      })
      .where(eq(parkingSlots.id, slot.id));
    applied = true;
  }

  await db.insert(parkingEvents).values({
    eventType: "edge_ai_sensor_telemetry",
    lotId: slot.lotId,
    slotId: slot.id,
    actorId: user?.id ?? null,
    actorRole: user?.role ?? "edge-node",
    details: {
      cameraNodeId: d.cameraNodeId,
      sensorConfidence: d.sensorConfidence,
      detectedOccupied: d.detectedOccupied,
      dbStatusBefore: slot.status,
      discrepancy,
      applied,
    },
  });

  const latencyMs = Math.max(3, Date.now() - started);
  await recordAiActivity({
    endpoint: "/api/easdl/process",
    module: "EASDL",
    userId: user?.id ?? null,
    lotId: slot.lotId,
    requestPayload: d as unknown as Record<string, unknown>,
    responsePayload: { discrepancy, applied },
    provider: "deterministic-engine",
    latencyMs,
  });

  return Response.json({
    module: "EASDL (Edge AI Slot Detection & Logging)",
    provider: "deterministic-engine",
    latencyMs,
    slotCode: slot.slotCode,
    previousStatus: slot.status,
    detectedOccupied: d.detectedOccupied,
    discrepancyDetected: discrepancy,
    appliedToDatabase: applied,
  });
}
