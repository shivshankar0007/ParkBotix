import { z } from "zod";
import { desc } from "drizzle-orm";
import { db, coupons } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireRole, logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

const createCouponSchema = z.object({
  code: z.string().trim().min(3).max(32),
  description: z.string().trim().min(4).max(200),
  discountType: z.enum(["percentage", "fixed"]),
  discountValue: z.number().positive(),
  minBookingAmount: z.number().min(0).default(0),
  maxDiscount: z.number().positive().default(500),
  usageLimit: z.number().int().positive().default(100),
  validUntil: z.string().datetime(),
  isActive: z.boolean().default(true),
});

export async function GET() {
  await ensureSeeded();
  const rows = await db.select().from(coupons).orderBy(desc(coupons.createdAt));
  return Response.json({ coupons: rows });
}

export async function POST(request: Request) {
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const parsed = createCouponSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid coupon data" },
        { status: 400 }
      );
    }

    const d = parsed.data;
    const [created] = await db
      .insert(coupons)
      .values({
        code: d.code.toUpperCase(),
        description: d.description,
        discountType: d.discountType,
        discountValue: d.discountValue,
        minBookingAmount: d.minBookingAmount,
        maxDiscount: d.maxDiscount,
        usageLimit: d.usageLimit,
        validFrom: new Date(),
        validUntil: new Date(d.validUntil),
        isActive: d.isActive,
        createdById: auth.user.id,
      })
      .returning();

    await logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: "COUPON_CREATED",
      entityType: "coupon",
      entityId: created.id,
      metadata: { code: created.code },
    });

    return Response.json({ coupon: created }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to create coupon" },
      { status: 500 }
    );
  }
}
