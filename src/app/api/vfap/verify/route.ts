import crypto from "crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, vehicleFingerprints } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { getCurrentUser } from "@/lib/auth";
import { recordAiActivity } from "@/lib/ai-provider";

const verifyFpSchema = z.object({
  vehicleNumber: z.string().trim().min(4).max(30),
  vehicleMake: z.string().trim().optional(),
  vehicleColor: z.string().trim().optional(),
});

export async function POST(request: Request) {
  await ensureSeeded();
  const started = Date.now();
  const user = await getCurrentUser();

  const body = await request.json().catch(() => ({}));
  const parsed = verifyFpSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "vehicleNumber is required" }, { status: 400 });
  }

  const plate = parsed.data.vehicleNumber.toUpperCase();
  const [record] = await db
    .select()
    .from(vehicleFingerprints)
    .where(eq(vehicleFingerprints.vehicleNumber, plate))
    .limit(1);

  if (!record) {
    return Response.json({
      verified: false,
      vehicleNumber: plate,
      reason: "No registered vehicle fingerprint found for this plate.",
    });
  }

  let matched = true;
  if (parsed.data.vehicleMake && parsed.data.vehicleColor) {
    const computed = crypto
      .createHash("sha256")
      .update(
        `${plate}|${parsed.data.vehicleMake.toLowerCase()}|${parsed.data.vehicleColor.toLowerCase()}`
      )
      .digest("hex")
      .slice(0, 32);
    matched = computed === record.fingerprintHash;
  }

  if (matched) {
    await db
      .update(vehicleFingerprints)
      .set({
        verifiedCount: record.verifiedCount + 1,
        trustScore: Math.min(0.99, Math.round((record.trustScore + 0.01) * 100) / 100),
        lastSeenAt: new Date(),
      })
      .where(eq(vehicleFingerprints.id, record.id));
  }

  const latencyMs = Math.max(3, Date.now() - started);
  await recordAiActivity({
    endpoint: "/api/vfap/verify",
    module: "VFAP",
    userId: user?.id ?? null,
    requestPayload: { vehicleNumber: plate },
    responsePayload: { verified: matched, trustScore: record.trustScore },
    provider: "deterministic-engine",
    latencyMs,
  });

  return Response.json({
    module: "VFAP (Vehicle Fingerprint Verification)",
    verified: matched,
    vehicleNumber: plate,
    vehicleMake: record.vehicleMake,
    vehicleColor: record.vehicleColor,
    trustScore: matched ? Math.min(0.99, record.trustScore + 0.01) : 0.25,
    verifiedCount: matched ? record.verifiedCount + 1 : record.verifiedCount,
    fingerprintHash: record.fingerprintHash,
  });
}
