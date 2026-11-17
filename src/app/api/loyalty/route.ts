import { desc, eq } from "drizzle-orm";
import { db, userLoyalty, coupons, marketplaceOffers, parkingLots, parkingSlots } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { getCurrentUser } from "@/lib/auth";
import { LOYALTY_POINT_RUPEE_VALUE } from "@/lib/geo";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const user = await getCurrentUser();

  const [activeCoupons, offers, lots, slots] = await Promise.all([
    db.select().from(coupons).where(eq(coupons.isActive, true)).orderBy(desc(coupons.createdAt)),
    db
      .select()
      .from(marketplaceOffers)
      .where(eq(marketplaceOffers.status, "open"))
      .orderBy(desc(marketplaceOffers.createdAt)),
    db.select().from(parkingLots),
    db.select().from(parkingSlots),
  ]);

  let loyalty = null;
  if (user) {
    const [row] = await db
      .select()
      .from(userLoyalty)
      .where(eq(userLoyalty.userId, user.id))
      .limit(1);
    loyalty = row ?? {
      userId: user.id,
      pointsBalance: 0,
      totalEarned: 0,
      totalRedeemed: 0,
      tier: "Bronze",
      lastTransactionNote: "No transactions yet",
    };
  }

  const lotMap = new Map(lots.map((l) => [l.id, l]));
  const slotMap = new Map(slots.map((s) => [s.id, s]));

  return Response.json({
    loyalty,
    conversionRateInr: LOYALTY_POINT_RUPEE_VALUE,
    coupons: activeCoupons,
    marketplaceOffers: offers.map((o) => ({
      ...o,
      lotName: lotMap.get(o.lotId)?.name ?? `Lot #${o.lotId}`,
      slotCode: slotMap.get(o.slotId)?.slotCode ?? `Slot #${o.slotId}`,
    })),
  });
}
