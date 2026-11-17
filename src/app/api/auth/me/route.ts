import { eq, and } from "drizzle-orm";
import { db, userLoyalty, userSubscriptions, subscriptionPlans } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ user: null });
  }

  const [loyaltyRow] = await db
    .select()
    .from(userLoyalty)
    .where(eq(userLoyalty.userId, user.id))
    .limit(1);

  const [subRow] = await db
    .select({
      id: userSubscriptions.id,
      status: userSubscriptions.status,
      hoursRemaining: userSubscriptions.hoursRemaining,
      endDate: userSubscriptions.endDate,
      planName: subscriptionPlans.name,
      discountPercent: subscriptionPlans.discountPercent,
      evBonus: subscriptionPlans.evBonus,
    })
    .from(userSubscriptions)
    .innerJoin(subscriptionPlans, eq(userSubscriptions.planId, subscriptionPlans.id))
    .where(
      and(
        eq(userSubscriptions.userId, user.id),
        eq(userSubscriptions.status, "active")
      )
    )
    .limit(1);

  return Response.json({
    user,
    loyalty: loyaltyRow ?? {
      pointsBalance: 0,
      totalEarned: 0,
      totalRedeemed: 0,
      tier: "Bronze",
    },
    subscription: subRow ?? null,
  });
}
