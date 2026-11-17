import { desc } from "drizzle-orm";
import {
  db,
  aiActivity,
  congestionPredictions,
  dynamicPricingLogs,
  slotMorphs,
  crowdDensity,
  vehicleFingerprints,
  autoExtensions,
  shadowReservations,
} from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  const [
    activities,
    predictions,
    pricingLogs,
    morphs,
    crowd,
    fingerprints,
    extensions,
    shadows,
  ] = await Promise.all([
    db.select().from(aiActivity).orderBy(desc(aiActivity.createdAt)).limit(40),
    db
      .select()
      .from(congestionPredictions)
      .orderBy(desc(congestionPredictions.createdAt))
      .limit(20),
    db
      .select()
      .from(dynamicPricingLogs)
      .orderBy(desc(dynamicPricingLogs.createdAt))
      .limit(20),
    db.select().from(slotMorphs).orderBy(desc(slotMorphs.createdAt)).limit(20),
    db.select().from(crowdDensity).orderBy(desc(crowdDensity.recordedAt)).limit(20),
    db
      .select()
      .from(vehicleFingerprints)
      .orderBy(desc(vehicleFingerprints.lastSeenAt))
      .limit(20),
    db
      .select()
      .from(autoExtensions)
      .orderBy(desc(autoExtensions.createdAt))
      .limit(20),
    db
      .select()
      .from(shadowReservations)
      .orderBy(desc(shadowReservations.createdAt))
      .limit(20),
  ]);

  return Response.json({
    aiProviders: {
      groqConfigured: Boolean(process.env.GROQ_API_KEY),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    },
    activities,
    predictions,
    pricingLogs,
    morphs,
    crowd,
    fingerprints,
    extensions,
    shadows,
  });
}
