import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { db, parkingLots, parkingSlots, evChargingSlots, feedback } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireRole, logAudit } from "@/lib/auth";
import { haversineDistanceKm } from "@/lib/geo";

export const dynamic = "force-dynamic";

const createLotSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(4).max(250),
  city: z.string().trim().min(2).max(80).default("Bengaluru"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  totalSlots: z.number().int().min(1).max(500).default(12),
  baseHourlyRate: z.number().positive().max(10000).default(40),
  evRateMultiplier: z.number().min(1).max(5).default(1.3),
  ownerId: z.number().int().positive().nullable().optional(),
  operatingHours: z.string().trim().max(100).default("24/7"),
  amenities: z.array(z.string()).optional(),
  autoGenerateSlots: z.boolean().optional().default(true),
  evSlotsCount: z.number().int().min(0).max(100).optional().default(2),
});

export async function GET(request: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim().toLowerCase() || "";
  const city = searchParams.get("city")?.trim().toLowerCase() || "";
  const latStr = searchParams.get("lat");
  const lngStr = searchParams.get("lng");
  const evOnly = searchParams.get("evOnly") === "true";

  const userLat = latStr ? Number(latStr) : null;
  const userLng = lngStr ? Number(lngStr) : null;

  const [lotsList, allSlots, allFeedback] = await Promise.all([
    db.select().from(parkingLots).orderBy(asc(parkingLots.id)),
    db.select().from(parkingSlots),
    db.select().from(feedback),
  ]);

  const enriched = lotsList
    .map((lot) => {
      const lotSlots = allSlots.filter((s) => s.lotId === lot.id);
      const availableSlots = lotSlots.filter((s) => s.status === "available").length;
      const reservedSlots = lotSlots.filter((s) => s.status === "reserved").length;
      const occupiedSlots = lotSlots.filter((s) => s.status === "occupied").length;
      const evSlots = lotSlots.filter((s) => s.isEvEnabled).length;
      const evAvailable = lotSlots.filter(
        (s) => s.isEvEnabled && s.status === "available"
      ).length;

      const lotFeedback = allFeedback.filter((f) => f.lotId === lot.id);
      const avgRating =
        lotFeedback.length > 0
          ? Math.round(
              (lotFeedback.reduce((sum, f) => sum + f.rating, 0) / lotFeedback.length) *
                10
            ) / 10
          : 4.6;

      const distanceKm =
        userLat !== null &&
        userLng !== null &&
        Number.isFinite(userLat) &&
        Number.isFinite(userLng)
          ? haversineDistanceKm(userLat, userLng, lot.latitude, lot.longitude)
          : null;

      return {
        ...lot,
        totalSlotCount: lotSlots.length,
        availableSlots,
        reservedSlots,
        occupiedSlots,
        evSlots,
        evAvailable,
        occupancyPercent:
          lotSlots.length > 0
            ? Math.round(((lotSlots.length - availableSlots) / lotSlots.length) * 100)
            : 0,
        avgRating,
        reviewCount: lotFeedback.length,
        distanceKm,
      };
    })
    .filter((lot) => {
      if (q) {
        const hay = `${lot.name} ${lot.address} ${lot.city}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (city && lot.city.toLowerCase() !== city) return false;
      if (evOnly && lot.evSlots === 0) return false;
      return true;
    });

  if (userLat !== null && userLng !== null) {
    enriched.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
  }

  return Response.json({ lots: enriched });
}

export async function POST(request: Request) {
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const parsed = createLotSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid parking lot data" },
        { status: 400 }
      );
    }

    const d = parsed.data;
    const [createdLot] = await db
      .insert(parkingLots)
      .values({
        name: d.name,
        address: d.address,
        city: d.city,
        latitude: d.latitude,
        longitude: d.longitude,
        totalSlots: d.totalSlots,
        baseHourlyRate: d.baseHourlyRate,
        evRateMultiplier: d.evRateMultiplier,
        ownerId: d.ownerId ?? null,
        operatingHours: d.operatingHours,
        amenities: d.amenities ?? ["CCTV", "QR Gate", "24/7 Security"],
        imageUrl: "/images/smart-parking-hero.jpg",
      })
      .returning();

    if (d.autoGenerateSlots && d.totalSlots > 0) {
      const evTarget = Math.min(d.evSlotsCount, d.totalSlots);
      const slotRows = Array.from({ length: d.totalSlots }, (_, idx) => {
        const num = idx + 1;
        const isEv = num <= evTarget;
        return {
          lotId: createdLot.id,
          slotCode: isEv
            ? `EV-${String(num).padStart(2, "0")}`
            : `A-${String(num).padStart(2, "0")}`,
          floor: num <= Math.ceil(d.totalSlots / 2) ? "L1" : "L2",
          slotType: isEv ? "ev" : "standard",
          status: "available",
          hourlyRate: isEv
            ? Math.round(d.baseHourlyRate * d.evRateMultiplier)
            : d.baseHourlyRate,
          isEvEnabled: isEv,
        };
      });

      const insertedSlots = await db
        .insert(parkingSlots)
        .values(slotRows)
        .returning();

      const evRows = insertedSlots
        .filter((s) => s.isEvEnabled)
        .map((s) => ({
          slotId: s.id,
          lotId: createdLot.id,
          chargerType: "CCS2 DC Fast",
          powerKw: 22,
          status: "idle",
          ratePerKwh: 18,
        }));
      if (evRows.length > 0) {
        await db.insert(evChargingSlots).values(evRows);
      }
    }

    await logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: "PARKING_LOT_CREATED",
      entityType: "parking_lot",
      entityId: createdLot.id,
      metadata: { name: createdLot.name, totalSlots: createdLot.totalSlots },
    });

    return Response.json({ lot: createdLot }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to create parking lot" },
      { status: 500 }
    );
  }
}
