import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, users } from "@/db";
import { requireRole, logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

const updateUserSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(["superadmin", "admin", "owner", "employee", "customer"]).optional(),
  assignedLotId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  const list = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      assignedLotId: users.assignedLotId,
      vehicleNumber: users.vehicleNumber,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.id));

  return Response.json({ users: list });
}

export async function PATCH(request: Request) {
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid user update" },
      { status: 400 }
    );
  }

  const { userId, role, assignedLotId, isActive } = parsed.data;
  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // Strict Phase 4 RBAC: Only SuperAdmin can modify SuperAdmin/Admin roles or promote to Admin
  if (auth.user.role !== "superadmin") {
    if (
      target.role === "superadmin" ||
      target.role === "admin" ||
      role === "superadmin" ||
      role === "admin"
    ) {
      await logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        action: "PRIVILEGE_ESCALATION_BLOCKED",
        entityType: "user",
        entityId: target.id,
        outcome: "denied",
        metadata: { attemptedRole: role, targetRole: target.role },
      });
      return Response.json(
        {
          error:
            "Forbidden: only SuperAdmin can assign or revoke Admin/SuperAdmin privileges.",
        },
        { status: 403 }
      );
    }
  }

  const updatePayload: Partial<typeof users.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (role !== undefined) updatePayload.role = role;
  if (assignedLotId !== undefined) updatePayload.assignedLotId = assignedLotId;
  if (isActive !== undefined) updatePayload.isActive = isActive;

  const [updated] = await db
    .update(users)
    .set(updatePayload)
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      assignedLotId: users.assignedLotId,
      isActive: users.isActive,
    });

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "USER_ROLE_OR_ASSIGNMENT_UPDATED",
    entityType: "user",
    entityId: updated.id,
    metadata: {
      previousRole: target.role,
      newRole: updated.role,
      assignedLotId: updated.assignedLotId,
      isActive: updated.isActive,
    },
  });

  return Response.json({ user: updated });
}
