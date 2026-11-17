import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, feedback, parkingLots, users } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireAuth, logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

const createFeedbackSchema = z.object({
  lotId: z.number().int().positive(),
  bookingId: z.number().int().positive().optional().nullable(),
  rating: z.number().int().min(1).max(5),
  category: z.enum(["experience", "scanner", "navigation", "ev_charging", "cleanliness", "billing"]).default("experience"),
  comment: z.string().trim().min(5, "Please share at least 5 characters of feedback").max(1000),
});

export async function GET(request: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(request.url);
  const lotIdParam = searchParams.get("lotId");

  const rows = lotIdParam
    ? await db
        .select()
        .from(feedback)
        .where(eq(feedback.lotId, Number(lotIdParam)))
        .orderBy(desc(feedback.createdAt))
        .limit(80)
    : await db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(80);

  const [lots, userList] = await Promise.all([
    db.select({ id: parkingLots.id, name: parkingLots.name }).from(parkingLots),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);

  const lotMap = new Map(lots.map((l) => [l.id, l.name]));
  const userMap = new Map(userList.map((u) => [u.id, u.name]));

  return Response.json({
    feedback: rows.map((f) => ({
      ...f,
      lotName: lotMap.get(f.lotId) ?? `Lot #${f.lotId}`,
      authorName: userMap.get(f.userId) ?? "Driver",
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = createFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid feedback submission" },
      { status: 400 }
    );
  }

  const [created] = await db
    .insert(feedback)
    .values({
      userId: auth.user.id,
      lotId: parsed.data.lotId,
      bookingId: parsed.data.bookingId ?? null,
      rating: parsed.data.rating,
      category: parsed.data.category,
      comment: parsed.data.comment,
      status: "open",
    })
    .returning();

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "FEEDBACK_SUBMITTED",
    entityType: "feedback",
    entityId: created.id,
    metadata: { lotId: created.lotId, rating: created.rating },
  });

  return Response.json({ feedback: created }, { status: 201 });
}
