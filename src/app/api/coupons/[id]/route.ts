import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, coupons } from "@/db";
import { requireRole, logAudit } from "@/lib/auth";

const patchCouponSchema = z.object({
  description: z.string().trim().min(4).max(200).optional(),
  discountValue: z.number().positive().optional(),
  minBookingAmount: z.number().min(0).optional(),
  maxDiscount: z.number().positive().optional(),
  usageLimit: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const couponId = Number(id);
  const body = await request.json();
  const parsed = patchCouponSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid coupon update" }, { status: 400 });
  }

  const [updated] = await db
    .update(coupons)
    .set(parsed.data)
    .where(eq(coupons.id, couponId))
    .returning();

  if (!updated) {
    return Response.json({ error: "Coupon not found" }, { status: 404 });
  }

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "COUPON_UPDATED",
    entityType: "coupon",
    entityId: couponId,
    metadata: parsed.data,
  });

  return Response.json({ coupon: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const couponId = Number(id);
  const [deleted] = await db
    .delete(coupons)
    .where(eq(coupons.id, couponId))
    .returning();

  if (!deleted) {
    return Response.json({ error: "Coupon not found" }, { status: 404 });
  }

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "COUPON_DELETED",
    entityType: "coupon",
    entityId: couponId,
    metadata: { code: deleted.code },
  });

  return Response.json({ ok: true });
}
