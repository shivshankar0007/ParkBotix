import { eq } from "drizzle-orm";
import {
  db,
  parkingLots,
  parkingSlots,
  congestionPredictions,
  dynamicPricingLogs,
} from "@/db";
import { ensureSeeded } from "@/db/seed";
import { getCurrentUser } from "@/lib/auth";
import { recordAiActivity } from "@/lib/ai-provider";

export async function POST(request: Request) {
  await ensureSeeded();
  const started = Date.now();
  const user = await getCurrentUser();
  const body = (await request.json().catch(() => ({}))) as {
    lotId?: number;
    horizonMinutes?: number;
  };

  const lots = body.lotId
    ? await db.select().from(parkingLots).where(eq(parkingLots.id, Number(body.lotId)))
    : await db.select().from(parkingLots);

  if (lots.length === 0) {
    return Response.json({ error: "Parking lot not found" }, { status: 404 });
  }

  const slots = await db.select().from(parkingSlots);
  const horizonMinutes = Math.min(240, Math.max(15, body.horizonMinutes ?? 60));
  const hourOfDay = new Date().getHours();
  const peakBoost = (hourOfDay >= 9 && hourOfDay <= 11) || (hourOfDay >= 17 && hourOfDay <= 20) ? 0.14 : 0.04;

  const advisories = [];
  for (const lot of lots) {
    const lotSlots = slots.filter((s) => s.lotId === lot.id);
    const total = Math.max(1, lotSlots.length);
    const occupied = lotSlots.filter((s) => s.status !== "available").length;
    const currentOccupancy = occupied / total;
    const predictedOccupancy = Math.min(
      0.98,
      Math.round((currentOccupancy + peakBoost) * 100) / 100
    );

    const congestionLevel =
      predictedOccupancy >= 0.85
        ? "critical"
        : predictedOccupancy >= 0.65
        ? "high"
        : predictedOccupancy >= 0.4
        ? "moderate"
        : "low";

    const demandFactor =
      congestionLevel === "critical"
        ? 1.3
        : congestionLevel === "high"
        ? 1.15
        : congestionLevel === "moderate"
        ? 1.05
        : 0.95;

    const computedRate = Math.round(lot.baseHourlyRate * demandFactor);
    const recommendedAction =
      congestionLevel === "critical" || congestionLevel === "high"
        ? `Apply ${Math.round((demandFactor - 1) * 100)}% surge pricing (₹${computedRate}/hr) & activate overflow routing.`
        : "Keep standard pricing and promote pre-booking discounts.";

    const predictedFor = new Date(Date.now() + horizonMinutes * 60 * 1000);

    await db.insert(congestionPredictions).values({
      lotId: lot.id,
      predictedFor,
      predictedOccupancy,
      congestionLevel,
      recommendedAction,
      confidence: 0.86,
    });

    await db.insert(dynamicPricingLogs).values({
      lotId: lot.id,
      baseRate: lot.baseHourlyRate,
      computedRate,
      occupancyRate: Math.round(currentOccupancy * 100) / 100,
      demandFactor,
      reason: `PCDE ${horizonMinutes}m horizon (${congestionLevel} congestion)`,
    });

    advisories.push({
      lotId: lot.id,
      lotName: lot.name,
      currentOccupancyPercent: Math.round(currentOccupancy * 100),
      predictedOccupancyPercent: Math.round(predictedOccupancy * 100),
      congestionLevel,
      baseRate: lot.baseHourlyRate,
      recommendedRate: computedRate,
      demandFactor,
      recommendedAction,
      predictedFor: predictedFor.toISOString(),
    });
  }

  const latencyMs = Math.max(4, Date.now() - started);
  await recordAiActivity({
    endpoint: "/api/pcde/advise",
    module: "PCDE",
    userId: user?.id ?? null,
    lotId: body.lotId ?? null,
    requestPayload: body as Record<string, unknown>,
    responsePayload: { advisoriesCount: advisories.length },
    provider: "deterministic-engine",
    latencyMs,
  });

  return Response.json({
    module: "PCDE (Predictive Congestion & Dynamic Pricing Engine)",
    provider: "deterministic-engine",
    latencyMs,
    advisories,
  });
}
