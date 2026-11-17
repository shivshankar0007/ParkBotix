import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, coupons } from "@/db";
import { ensureSeeded } from "@/db/seed";

const validateSchema = z.object({
  code: z.string().trim().min(1),
  bookingAmount: z.number().positive(),
});

export async function POST(request: Request) {
  await ensureSeeded();
  const body = await request.json();
  const parsed = validateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Coupon code and amount required" }, { status: 400 });
  }

  const codeUpper = parsed.data.code.toUpperCase();
  const [coupon] = await db
    .select()
    .from(coupons)
    .where(eq(coupons.code, codeUpper))
    .limit(1);

  const now = new Date();
  if (!coupon || !coupon.isActive) {
    return Response.json({ valid: false, error: "Invalid or inactive coupon code." }, { status: 400 });
  }
  if (coupon.validUntil < now || coupon.validFrom > now) {
    return Response.json({ valid: false, error: "This coupon has expired." }, { status: 400 });
  }
  if (coupon.usedCount >= coupon.usageLimit) {
    return Response.json({ valid: false, error: "Coupon usage limit reached." }, { status: 400 });
  }
  if (parsed.data.bookingAmount < coupon.minBookingAmount) {
    return Response.json(
      {
        valid: false,
        error: `Minimum booking amount of ₹${coupon.minBookingAmount} required.`,
      },
      { status: 400 }
    );
  }

  const rawDiscount =
    coupon.discountType === "percentage"
      ? (parsed.data.bookingAmount * coupon.discountValue) / 100
      : coupon.discountValue;
  const discountAmount =
    Math.round(Math.min(rawDiscount, coupon.maxDiscount, parsed.data.bookingAmount) * 100) / 100;

  return Response.json({
    valid: true,
    coupon: {
      code: coupon.code,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
    },
    discountAmount,
    finalAfterCoupon: Math.max(0, parsed.data.bookingAmount - discountAmount),
  });
}
