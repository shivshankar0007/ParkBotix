import crypto from "crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, vehicleFingerprints } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireAuth } from "@/lib/auth";
import { recordAiActivity } from "@/lib/ai-provider";

const registerFpSchema = z.object({
  vehicleNumber: z.string().trim().min(4).max(30),
  vehicleMake: z.string().trim().min(2).max(60),
  vehicleColor: z.string().trim().min(2).max(40),
});

export async function POST(request: Request) {
  await ensureSeeded();
  const started = Date.now();
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const parsed = registerFpSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Provide vehicleNumber, vehicleMake, and vehicleColor" },
      { status: 400 }
    );
  }

  const plate = parsed.data.vehicleNumber.toUpperCase();
  const fingerprintHash = crypto
    .createHash("sha256")
    .update(`${plate}|${parsed.data.vehicleMake.toLowerCase()}|${parsed.data.vehicleColor.toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);

  const [existing] = await db
    .select()
    .from(vehicleFingerprints)
    .where(eq(vehicleFingerprints.vehicleNumber, plate))
    .limit(1);

  let record;
  if (existing) {
    [record] = await db
      .update(vehicleFingerprints)
      .set({
        vehicleMake: parsed.data.vehicleMake,
        vehicleColor: parsed.data.vehicleColor,
        fingerprintHash,
        lastSeenAt: new Date(),
      })
      .where(eq(vehicleFingerprints.id, existing.id))
      .returning();
  } else {
    [record] = await db
      .insert(vehicleFingerprints)
      .values({
        userId: auth.user.id,
        vehicleNumber: plate,
        vehicleMake: parsed.data.vehicleMake,
        vehicleColor: parsed.data.vehicleColor,
        fingerprintHash,
        trustScore: 0.95,
        verifiedCount: 1,
      })
      .returning();
  }

  const latencyMs = Math.max(3, Date.now() - started);
  await recordAiActivity({
    endpoint: "/api/vfap/register",
    module: "VFAP",
    userId: auth.user.id,
    requestPayload: { vehicleNumber: plate },
    responsePayload: { fingerprintHash: record.fingerprintHash },
    provider: "deterministic-engine",
    latencyMs,
  });

  return Response.json(
    {
      module: "VFAP (Vehicle Fingerprint Authentication Protocol)",
      fingerprint: record,
    },
    { status: 201 }
  );
}
