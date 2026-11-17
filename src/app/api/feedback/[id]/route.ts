import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, feedback, parkingLots } from "@/db";
import { requireRole, logAudit } from "@/lib/auth";

const replySchema = z.object({
  adminResponse: z.string().trim().min(2).max(1000),
  status: z.enum(["open", "reviewed", "resolved"]).default("resolved"),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(["superadmin", "admin", "owner"]);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const feedbackId = Number(id);
  const [existing] = await db
    .select()
    .from(feedback)
    .where(eq(feedback.id, feedbackId))
    .limit(1);

  if (!existing) {
    return Response.json({ error: "Feedback record not found" }, { status: 404 });
  }

  if (auth.user.role === "owner") {
    const [lot] = await db
      .select()
      .from(parkingLots)
      .where(eq(parkingLots.id, existing.lotId))
      .limit(1);
    if (!lot || lot.ownerId !== auth.user.id) {
      return Response.json(
        { error: "Forbidden: owners can only respond to feedback on their assigned lots." },
        { status: 403 }
      );
    }
  }

  const body = await request.json();
  const parsed = replySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Valid response required" }, { status: 400 });
  }

  const [updated] = await db
    .update(feedback)
    .set({
      adminResponse: parsed.data.adminResponse,
      status: parsed.data.status,
    })
    .where(eq(feedback.id, feedbackId))
    .returning();

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "FEEDBACK_RESPONDED",
    entityType: "feedback",
    entityId: feedbackId,
  });

  return Response.json({ feedback: updated });
}
