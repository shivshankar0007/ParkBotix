import { eq } from "drizzle-orm";
import { db, bookings, penalties, parkingLots } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { getCurrentUser } from "@/lib/auth";
import { recordAiActivity } from "@/lib/ai-provider";

export async function POST(request: Request) {
  await ensureSeeded();
  const started = Date.now();
  const user = await getCurrentUser();
  const body = (await request.json().catch(() => ({}))) as { lotId?: number };

  const [allBookings, allPenalties, lots] = await Promise.all([
    body.lotId
      ? db.select().from(bookings).where(eq(bookings.lotId, Number(body.lotId)))
      : db.select().from(bookings),
    body.lotId
      ? db.select().from(penalties).where(eq(penalties.lotId, Number(body.lotId)))
      : db.select().from(penalties),
    db.select().from(parkingLots),
  ]);

  const now = Date.now();
  const activeBookings = allBookings.filter((b) => b.status === "active");
  const overtimeRiskList = activeBookings.map((b) => {
    const minsRemaining = Math.round((b.endTime.getTime() - now) / 60000);
    const riskScore =
      minsRemaining <= 0
        ? 0.95
        : minsRemaining <= 20
        ? 0.78
        : minsRemaining <= 45
        ? 0.45
        : 0.15;
    return {
      bookingId: b.id,
      bookingCode: b.bookingCode,
      lotId: b.lotId,
      minutesRemaining: minsRemaining,
      autoExtendEnabled: b.autoExtendEnabled,
      overtimeProbability: riskScore,
      recommendedAction:
        riskScore >= 0.7 && !b.autoExtendEnabled
          ? "Send driver exit reminder or offer one-tap 30m extension"
          : riskScore >= 0.7
          ? "Eligible for automated extension worker"
          : "Normal session trajectory",
    };
  });

  const historicalPenaltyRate =
    allBookings.length > 0
      ? Math.round((allPenalties.length / allBookings.length) * 1000) / 10
      : 0;
  const totalBookingValue = allBookings.reduce((s, b) => s + b.finalAmount, 0);
  const projectedOvertimeRevenueInr = Math.round(
    overtimeRiskList.reduce((s, r) => s + r.overtimeProbability * 35, 0)
  );

  const latencyMs = Math.max(3, Date.now() - started);
  await recordAiActivity({
    endpoint: "/api/aerr/predict",
    module: "AERR",
    userId: user?.id ?? null,
    lotId: body.lotId ?? null,
    requestPayload: body as Record<string, unknown>,
    responsePayload: {
      activeEvaluated: overtimeRiskList.length,
      projectedOvertimeRevenueInr,
    },
    provider: "deterministic-engine",
    latencyMs,
  });

  return Response.json({
    module: "AERR (Adaptive Exit & Revenue Risk Predictor)",
    provider: "deterministic-engine",
    latencyMs,
    summary: {
      lotsMonitored: body.lotId ? 1 : lots.length,
      activeSessionsEvaluated: overtimeRiskList.length,
      historicalOvertimeRatePercent: historicalPenaltyRate,
      recordedRevenueInr: Math.round(totalBookingValue * 100) / 100,
      projectedOvertimeRevenueInr,
    },
    sessionsAtRisk: overtimeRiskList,
  });
}
