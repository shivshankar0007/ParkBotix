import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db, subscriptionPlans, userSubscriptions } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { getCurrentUser, requireAuth, logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

const subscribeSchema = z.object({
  planId: z.number().int().positive(),
});

export async function GET() {
  await ensureSeeded();
  const user = await getCurrentUser();
  const plans = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.isActive, true))
    .orderBy(asc(subscriptionPlans.monthlyPrice));

  let activeSubscription = null;
  if (user) {
    const [sub] = await db
      .select()
      .from(userSubscriptions)
      .where(
        and(
          eq(userSubscriptions.userId, user.id),
          eq(userSubscriptions.status, "active")
        )
      )
      .limit(1);
    activeSubscription = sub ?? null;
  }

  return Response.json({ plans, activeSubscription });
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Valid planId required" }, { status: 400 });
  }

  const [plan] = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, parsed.data.planId))
    .limit(1);

  if (!plan || !plan.isActive) {
    return Response.json({ error: "Subscription plan not found" }, { status: 404 });
  }

  const now = new Date();
  const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  await db
    .update(userSubscriptions)
    .set({ status: "replaced" })
    .where(
      and(
        eq(userSubscriptions.userId, auth.user.id),
        eq(userSubscriptions.status, "active")
      )
    );

  const [sub] = await db
    .insert(userSubscriptions)
    .values({
      userId: auth.user.id,
      planId: plan.id,
      startDate: now,
      endDate,
      status: "active",
      hoursRemaining: plan.includedHours,
    })
    .returning();

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "SUBSCRIPTION_ENROLLED",
    entityType: "subscription",
    entityId: sub.id,
    metadata: { planName: plan.name, monthlyPrice: plan.monthlyPrice },
  });

  return Response.json({ subscription: sub, plan }, { status: 201 });
}
