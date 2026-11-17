import { eq } from "drizzle-orm";
import { db, evChargingSlots, parkingSlots, parkingLots } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { getCurrentUser } from "@/lib/auth";
import { recordAiActivity } from "@/lib/ai-provider";

export async function POST(request: Request) {
  await ensureSeeded();
  const started = Date.now();
  const user = await getCurrentUser();
  const body = (await request.json().catch(() => ({}))) as {
    lotId?: number;
    minPowerKw?: number;
    batteryPercent?: number;
  };

  const minPower = body.minPowerKw ?? 22;
  const batteryPercent = body.batteryPercent ?? 35;

  const [evList, slots, lots] = await Promise.all([
    body.lotId
      ? db.select().from(evChargingSlots).where(eq(evChargingSlots.lotId, Number(body.lotId)))
      : db.select().from(evChargingSlots),
    db.select().from(parkingSlots),
    db.select().from(parkingLots),
  ]);

  const slotMap = new Map(slots.map((s) => [s.id, s]));
  const lotMap = new Map(lots.map((l) => [l.id, l]));

  const candidates = evList
    .map((ev) => {
      const slot = slotMap.get(ev.slotId);
      const lot = lotMap.get(ev.lotId);
      if (!slot || slot.status !== "available" || ev.status !== "idle") return null;
      const estimatedChargeMinutes = Math.round(
        (((80 - Math.min(79, batteryPercent)) * 0.45) / Math.max(7, ev.powerKw)) * 60
      );
      return {
        evSlotId: ev.id,
        slotId: slot.id,
        slotCode: slot.slotCode,
        lotId: ev.lotId,
        lotName: lot?.name ?? `Lot #${ev.lotId}`,
        chargerType: ev.chargerType,
        powerKw: ev.powerKw,
        ratePerKwh: ev.ratePerKwh,
        hourlyParkingRate: slot.hourlyRate,
        meetsPowerTarget: ev.powerKw >= minPower,
        estimatedChargeTo80Mins: Math.max(15, estimatedChargeMinutes),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => Number(b.meetsPowerTarget) - Number(a.meetsPowerTarget) || b.powerKw - a.powerKw);

  const latencyMs = Math.max(3, Date.now() - started);
  await recordAiActivity({
    endpoint: "/api/easas/assign",
    module: "EASAS",
    userId: user?.id ?? null,
    lotId: body.lotId ?? candidates[0]?.lotId ?? null,
    requestPayload: body as Record<string, unknown>,
    responsePayload: { assignedSlot: candidates[0]?.slotCode ?? null, availableEvCount: candidates.length },
    provider: "deterministic-engine",
    latencyMs,
  });

  return Response.json({
    module: "EASAS (EV Autonomous Slot Assignment System)",
    provider: "deterministic-engine",
    latencyMs,
    recommendedEvBay: candidates[0] ?? null,
    availableEvBays: candidates,
  });
}
