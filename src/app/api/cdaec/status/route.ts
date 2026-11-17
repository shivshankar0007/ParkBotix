import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, crowdDensity, parkingLots } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { getCurrentUser } from "@/lib/auth";
import { recordAiActivity } from "@/lib/ai-provider";

export const dynamic = "force-dynamic";

const ingestSchema = z.object({
  lotId: z.number().int().positive(),
  zoneName: z.string().trim().min(2).max(80).default("Main Entry Ramp"),
  vehicleCount: z.number().int().min(0).max(500),
  pedestrianCount: z.number().int().min(0).max(1000),
});

export async function GET(request: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(request.url);
  const lotIdParam = searchParams.get("lotId");

  const [readings, lots] = await Promise.all([
    lotIdParam
      ? db
          .select()
          .from(crowdDensity)
          .where(eq(crowdDensity.lotId, Number(lotIdParam)))
          .orderBy(desc(crowdDensity.recordedAt))
          .limit(30)
      : db.select().from(crowdDensity).orderBy(desc(crowdDensity.recordedAt)).limit(30),
    db.select({ id: parkingLots.id, name: parkingLots.name }).from(parkingLots),
  ]);

  const lotMap = new Map(lots.map((l) => [l.id, l.name]));

  return Response.json({
    module: "CDAEC (Crowd Density & Access Entry Control)",
    zones: readings.map((r) => ({
      ...r,
      lotName: lotMap.get(r.lotId) ?? `Lot #${r.lotId}`,
    })),
  });
}

export async function POST(request: Request) {
  await ensureSeeded();
  const started = Date.now();
  const user = await getCurrentUser();

  const body = await request.json().catch(() => ({}));
  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid crowd telemetry reading" }, { status: 400 });
  }

  const d = parsed.data;
  const densityScore = Math.min(
    1,
    Math.round(((d.vehicleCount * 2.2 + d.pedestrianCount) / 80) * 100) / 100
  );
  const alertLevel =
    densityScore >= 0.85
      ? "critical"
      : densityScore >= 0.65
      ? "high"
      : densityScore >= 0.35
      ? "moderate"
      : "low";

  const [saved] = await db
    .insert(crowdDensity)
    .values({
      lotId: d.lotId,
      zoneName: d.zoneName,
      densityScore,
      vehicleCount: d.vehicleCount,
      pedestrianCount: d.pedestrianCount,
      alertLevel,
    })
    .returning();

  await recordAiActivity({
    endpoint: "/api/cdaec/status",
    module: "CDAEC",
    userId: user?.id ?? null,
    lotId: d.lotId,
    requestPayload: d as unknown as Record<string, unknown>,
    responsePayload: { densityScore, alertLevel },
    provider: "deterministic-engine",
    latencyMs: Math.max(3, Date.now() - started),
  });

  return Response.json({ reading: saved }, { status: 201 });
}
