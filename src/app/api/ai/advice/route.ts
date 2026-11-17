import { db, parkingLots, parkingSlots } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { getCurrentUser } from "@/lib/auth";
import { generateAiText, recordAiActivity } from "@/lib/ai-provider";
import { haversineDistanceKm } from "@/lib/geo";

export async function POST(request: Request) {
  await ensureSeeded();
  const user = await getCurrentUser();
  const body = (await request.json().catch(() => ({}))) as {
    lat?: number;
    lng?: number;
    preferEv?: boolean;
    maxHourlyRate?: number;
    durationHours?: number;
  };

  const [lots, slots] = await Promise.all([
    db.select().from(parkingLots),
    db.select().from(parkingSlots),
  ]);

  const ranked = lots
    .map((lot) => {
      const lotSlots = slots.filter((s) => s.lotId === lot.id);
      const avail = lotSlots.filter((s) => s.status === "available").length;
      const evAvail = lotSlots.filter((s) => s.isEvEnabled && s.status === "available").length;
      const distKm =
        typeof body.lat === "number" && typeof body.lng === "number"
          ? haversineDistanceKm(body.lat, body.lng, lot.latitude, lot.longitude)
          : null;
      let score = avail * 4 - lot.baseHourlyRate * 0.3;
      if (body.preferEv) score += evAvail * 12;
      if (distKm !== null) score -= distKm * 3.5;
      if (body.maxHourlyRate && lot.baseHourlyRate > body.maxHourlyRate) score -= 25;

      return {
        lotId: lot.id,
        name: lot.name,
        city: lot.city,
        baseHourlyRate: lot.baseHourlyRate,
        availableSlots: avail,
        evAvailable: evAvail,
        distanceKm: distKm,
        score: Math.round(score * 10) / 10,
      };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const fallback = top
    ? `Recommended hub: ${top.name} (${top.availableSlots} open bays, ${top.evAvailable} EV chargers ready, base ₹${top.baseHourlyRate}/hr${
        top.distanceKm !== null ? `, ${top.distanceKm} km away` : ""
      }). Consider booking ahead with coupon PARK20 for 20% off.`
    : "No active parking hubs found.";

  const ai = await generateAiText(
    "You are ParkBotix Smart Parking Advisor. Give concise, data-grounded 2-sentence parking advice using only the provided live lot data.",
    `User preferences: ${JSON.stringify(body)}\nLive ranked lots: ${JSON.stringify(ranked.slice(0, 3))}`,
    fallback
  );

  const responsePayload = {
    advice: ai.text,
    provider: ai.provider,
    latencyMs: ai.latencyMs,
    recommendedLot: top ?? null,
    rankedLots: ranked,
  };

  await recordAiActivity({
    endpoint: "/api/ai/advice",
    module: "AI_ADVICE",
    userId: user?.id ?? null,
    lotId: top?.lotId ?? null,
    requestPayload: body as Record<string, unknown>,
    responsePayload: { recommendedLot: top?.name, provider: ai.provider },
    provider: ai.provider,
    latencyMs: ai.latencyMs,
  });

  return Response.json(responsePayload);
}
