import { eq } from "drizzle-orm";
import { db, parkingLots, parkingSlots, shadowReservations } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { getCurrentUser } from "@/lib/auth";
import { recordAiActivity } from "@/lib/ai-provider";

export async function POST(request: Request) {
  await ensureSeeded();
  const started = Date.now();
  const user = await getCurrentUser();
  const body = (await request.json().catch(() => ({}))) as {
    lotId?: number;
    preferEv?: boolean;
    preferVip?: boolean;
    createShadowHold?: boolean;
  };

  const [lots, slots] = await Promise.all([
    body.lotId
      ? db.select().from(parkingLots).where(eq(parkingLots.id, Number(body.lotId)))
      : db.select().from(parkingLots),
    db.select().from(parkingSlots).where(eq(parkingSlots.status, "available")),
  ]);

  const lotMap = new Map(lots.map((l) => [l.id, l]));
  const filteredSlots = slots.filter((s) => lotMap.has(s.lotId));

  const ranked = filteredSlots
    .map((s) => {
      let score = 70 - s.hourlyRate * 0.25;
      if (body.preferEv && s.isEvEnabled) score += 35;
      if (body.preferVip && s.slotType === "vip") score += 25;
      if (s.floor === "L1") score += 8;
      return {
        slotId: s.id,
        slotCode: s.slotCode,
        lotId: s.lotId,
        lotName: lotMap.get(s.lotId)?.name ?? `Lot #${s.lotId}`,
        floor: s.floor,
        slotType: s.slotType,
        hourlyRate: s.hourlyRate,
        isEvEnabled: s.isEvEnabled,
        matchScore: Math.min(99, Math.round(score)),
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 6);

  let shadowHold = null;
  if (body.createShadowHold && ranked[0]) {
    const now = new Date();
    const [created] = await db
      .insert(shadowReservations)
      .values({
        userId: user?.id ?? null,
        lotId: ranked[0].lotId,
        slotId: ranked[0].slotId,
        confidenceScore: ranked[0].matchScore / 100,
        predictedArrival: new Date(now.getTime() + 15 * 60 * 1000),
        expiresAt: new Date(now.getTime() + 25 * 60 * 1000),
        status: "holding",
      })
      .returning();
    shadowHold = created;
  }

  const latencyMs = Math.max(3, Date.now() - started);
  await recordAiActivity({
    endpoint: "/api/ipre/suggest",
    module: "IPRE",
    userId: user?.id ?? null,
    lotId: body.lotId ?? ranked[0]?.lotId ?? null,
    requestPayload: body as Record<string, unknown>,
    responsePayload: { topSlot: ranked[0]?.slotCode, count: ranked.length },
    provider: "deterministic-engine",
    latencyMs,
  });

  return Response.json({
    module: "IPRE (Intelligent Parking Recommendation Engine)",
    provider: "deterministic-engine",
    latencyMs,
    suggestions: ranked,
    shadowReservation: shadowHold,
  });
}
