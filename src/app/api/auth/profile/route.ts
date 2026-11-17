import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { requireAuth, logAudit } from "@/lib/auth";

const profileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(25).optional().nullable(),
  vehicleNumber: z.string().trim().max(30).optional().nullable(),
});

export async function PATCH(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid profile data" },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(users)
      .set({
        name: parsed.data.name,
        phone: parsed.data.phone || null,
        vehicleNumber: parsed.data.vehicleNumber
          ? parsed.data.vehicleNumber.toUpperCase()
          : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, auth.user.id))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        vehicleNumber: users.vehicleNumber,
      });

    await logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: "PROFILE_UPDATED",
      entityType: "user",
      entityId: auth.user.id,
    });

    return Response.json({ user: updated });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update profile" },
      { status: 500 }
    );
  }
}
