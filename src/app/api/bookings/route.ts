import crypto from "crypto";
import { z } from "zod";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import {
  db,
  bookings,
  parkingLots,
  parkingSlots,
  coupons,
  userLoyalty,
  payments,
  parkingEvents,
  users,
} from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireAuth, logAudit } from "@/lib/auth";
import { createSignedQr, generateQrDataUrl } from "@/lib/qr";
import { LOYALTY_POINT_RUPEE_VALUE, computeTier } from "@/lib/geo";

export const dynamic = "force-dynamic";

const createBookingSchema = z.object({
  lotId: z.number().int().positive(),
  slotId: z.number().int().positive(),
  vehicleNumber: z.string().trim().min(3, "Vehicle plate number required").max(30),
  durationHours: z.number().min(0.5).max(48).default(2),
  startTime: z.string().datetime().optional(),
  couponCode: z.string().trim().max(40).optional().nullable(),
  loyaltyPointsToRedeem: z.number().int().min(0).max(50000).optional().default(0),
  autoExtendEnabled: z.boolean().optional().default(false),
  upiId: z.string().trim().max(80).optional().nullable(),
});

export async function GET(request: Request) {
  await ensureSeeded();
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope");

  let targetBookings: Array<typeof bookings.$inferSelect> = [];

  if (
    (auth.user.role === "superadmin" || auth.user.role === "admin") &&
    scope === "all"
  ) {
    targetBookings = await db
      .select()
      .from(bookings)
      .orderBy(desc(bookings.createdAt))
      .limit(100);
  } else if (auth.user.role === "owner" && scope === "owner") {
    const ownedLots = await db
      .select({ id: parkingLots.id })
      .from(parkingLots)
      .where(eq(parkingLots.ownerId, auth.user.id));
    const ownedIds = ownedLots.map((l) => l.id);
    if (ownedIds.length > 0) {
      targetBookings = await db
        .select()
        .from(bookings)
        .where(inArray(bookings.lotId, ownedIds))
        .orderBy(desc(bookings.createdAt))
        .limit(100);
    }
  } else {
    targetBookings = await db
      .select()
      .from(bookings)
      .where(eq(bookings.userId, auth.user.id))
      .orderBy(desc(bookings.createdAt))
      .limit(60);
  }

  if (targetBookings.length === 0) {
    return Response.json({ bookings: [] });
  }

  const lotIds = [...new Set(targetBookings.map((b) => b.lotId))];
  const slotIds = [...new Set(targetBookings.map((b) => b.slotId))];
  const userIds = [...new Set(targetBookings.map((b) => b.userId))];
  const bookingIds = targetBookings.map((b) => b.id);

  const [lotRows, slotRows, userRows, paymentRows] = await Promise.all([
    db.select().from(parkingLots).where(inArray(parkingLots.id, lotIds)),
    db.select().from(parkingSlots).where(inArray(parkingSlots.id, slotIds)),
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds)),
    db.select().from(payments).where(inArray(payments.bookingId, bookingIds)),
  ]);

  const lotMap = new Map(lotRows.map((l) => [l.id, l]));
  const slotMap = new Map(slotRows.map((s) => [s.id, s]));
  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const paymentMap = new Map<number, typeof payments.$inferSelect>();
  for (const p of paymentRows) {
    paymentMap.set(p.bookingId, p);
  }

  const enriched = await Promise.all(
    targetBookings.map(async (b) => ({
      ...b,
      lotName: lotMap.get(b.lotId)?.name ?? `Lot #${b.lotId}`,
      lotAddress: lotMap.get(b.lotId)?.address ?? "",
      slotCode: slotMap.get(b.slotId)?.slotCode ?? `Slot #${b.slotId}`,
      slotType: slotMap.get(b.slotId)?.slotType ?? "standard",
      customerName: userMap.get(b.userId)?.name ?? "Customer",
      customerEmail: userMap.get(b.userId)?.email ?? "",
      payment: paymentMap.get(b.id) ?? null,
      qrDataUrl: await generateQrDataUrl(b.qrCodePayload),
    }))
  );

  return Response.json({ bookings: enriched });
}

export async function POST(request: Request) {
  await ensureSeeded();
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const parsed = createBookingSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid booking payload" },
        { status: 400 }
      );
    }

    const d = parsed.data;
    const now = new Date();
    const startTime = d.startTime ? new Date(d.startTime) : now;
    const endTime = new Date(startTime.getTime() + d.durationHours * 60 * 60 * 1000);

    const result = await db.transaction(async (tx) => {
      // Acquire row-level lock on the target slot to prevent simultaneous double booking
      const lockedSlotRes = await tx.execute(
        sql`SELECT id, lot_id, slot_code, slot_type, status, hourly_rate FROM parking_slots WHERE id = ${d.slotId} AND lot_id = ${d.lotId} FOR UPDATE`
      );
      const lockedSlot = lockedSlotRes.rows[0] as
        | {
            id: number;
            lot_id: number;
            slot_code: string;
            slot_type: string;
            status: string;
            hourly_rate: number;
          }
        | undefined;

      if (!lockedSlot) {
        throw new Error("SLOT_NOT_FOUND");
      }

      if (lockedSlot.status !== "available") {
        throw new Error(`SLOT_UNAVAILABLE:${lockedSlot.status}`);
      }

      // Check overlapping confirmed/active bookings for this slot
      const overlaps = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.slotId, d.slotId),
            lt(bookings.startTime, endTime),
            gt(bookings.endTime, startTime),
            sql`${bookings.status} IN ('pending', 'confirmed', 'active')`
          )
        )
        .limit(1);

      if (overlaps.length > 0) {
        throw new Error("SLOT_TIME_CONFLICT");
      }

      const baseAmount = Math.round(lockedSlot.hourly_rate * d.durationHours * 100) / 100;
      let discountAmount = 0;
      let appliedCouponCode: string | null = null;

      // Server-side coupon validation
      if (d.couponCode && d.couponCode.trim().length > 0) {
        const codeUpper = d.couponCode.trim().toUpperCase();
        const [coupon] = await tx
          .select()
          .from(coupons)
          .where(eq(coupons.code, codeUpper))
          .limit(1);

        if (!coupon || !coupon.isActive) {
          throw new Error("COUPON_INVALID");
        }
        if (coupon.validUntil < now || coupon.validFrom > now) {
          throw new Error("COUPON_EXPIRED");
        }
        if (coupon.usedCount >= coupon.usageLimit) {
          throw new Error("COUPON_LIMIT_REACHED");
        }
        if (baseAmount < coupon.minBookingAmount) {
          throw new Error(`COUPON_MIN_AMOUNT:${coupon.minBookingAmount}`);
        }

        const rawDiscount =
          coupon.discountType === "percentage"
            ? (baseAmount * coupon.discountValue) / 100
            : coupon.discountValue;
        discountAmount =
          Math.round(Math.min(rawDiscount, coupon.maxDiscount, baseAmount) * 100) / 100;
        appliedCouponCode = coupon.code;

        await tx
          .update(coupons)
          .set({ usedCount: coupon.usedCount + 1 })
          .where(eq(coupons.id, coupon.id));
      }

      // Server-side loyalty redemption (1 point = ₹0.50)
      let loyaltyPointsUsed = 0;
      let loyaltyDiscount = 0;
      const afterCoupon = Math.max(0, baseAmount - discountAmount);

      if (d.loyaltyPointsToRedeem > 0) {
        const [loyalty] = await tx
          .select()
          .from(userLoyalty)
          .where(eq(userLoyalty.userId, auth.user.id))
          .limit(1);

        if (!loyalty || loyalty.pointsBalance < d.loyaltyPointsToRedeem) {
          throw new Error("INSUFFICIENT_LOYALTY_POINTS");
        }

        const maxRedeemablePoints = Math.floor(afterCoupon / LOYALTY_POINT_RUPEE_VALUE);
        loyaltyPointsUsed = Math.min(d.loyaltyPointsToRedeem, maxRedeemablePoints);
        loyaltyDiscount =
          Math.round(loyaltyPointsUsed * LOYALTY_POINT_RUPEE_VALUE * 100) / 100;

        await tx
          .update(userLoyalty)
          .set({
            pointsBalance: loyalty.pointsBalance - loyaltyPointsUsed,
            totalRedeemed: loyalty.totalRedeemed + loyaltyPointsUsed,
            lastTransactionNote: `Redeemed ${loyaltyPointsUsed} pts (₹${loyaltyDiscount}) on slot ${lockedSlot.slot_code}`,
            updatedAt: now,
          })
          .where(eq(userLoyalty.id, loyalty.id));
      }

      const finalAmount =
        Math.round(Math.max(0, baseAmount - discountAmount - loyaltyDiscount) * 100) / 100;

      const randomPart = crypto.randomBytes(3).toString("hex").toUpperCase();
      const bookingCode = `PBX-${d.lotId}${lockedSlot.slot_code.replace(/[^A-Z0-9]/g, "")}-${randomPart}`;

      const signedQr = createSignedQr({
        bookingCode,
        lotId: d.lotId,
        slotId: d.slotId,
        userId: auth.user.id,
        endTime,
      });

      const [booking] = await tx
        .insert(bookings)
        .values({
          bookingCode,
          userId: auth.user.id,
          lotId: d.lotId,
          slotId: d.slotId,
          vehicleNumber: d.vehicleNumber.toUpperCase(),
          startTime,
          endTime,
          durationHours: d.durationHours,
          baseAmount,
          discountAmount,
          loyaltyDiscount,
          loyaltyPointsUsed,
          totalAmount: baseAmount,
          finalAmount,
          status: "confirmed",
          qrCodePayload: signedQr.qrToken,
          qrSignature: signedQr.signature,
          couponCode: appliedCouponCode,
          autoExtendEnabled: d.autoExtendEnabled,
        })
        .returning();

      // Lock slot as reserved
      await tx
        .update(parkingSlots)
        .set({
          status: "reserved",
          currentBookingId: booking.id,
          updatedAt: now,
        })
        .where(eq(parkingSlots.id, d.slotId));

      // Create initiated payment record with server-issued verification code
      const txnId = `TXN-${Date.now().toString(36).toUpperCase()}-${crypto
        .randomBytes(2)
        .toString("hex")
        .toUpperCase()}`;
      const verificationCode = String(crypto.randomInt(100000, 999999));

      const [payment] = await tx
        .insert(payments)
        .values({
          bookingId: booking.id,
          userId: auth.user.id,
          transactionId: txnId,
          upiId: d.upiId || "parkbotix.smart@okhdfcbank",
          amount: finalAmount,
          method: "upi",
          status: finalAmount === 0 ? "verified" : "pending_verification",
          verificationCode,
          verifiedAt: finalAmount === 0 ? now : null,
          metadata: {
            slotCode: lockedSlot.slot_code,
            couponCode: appliedCouponCode,
            loyaltyPointsUsed,
          },
        })
        .returning();

      // Award earned loyalty points (10% of final amount, min 5 pts)
      const earnedPoints = Math.max(5, Math.round(finalAmount * 0.1));
      const [existingLoyalty] = await tx
        .select()
        .from(userLoyalty)
        .where(eq(userLoyalty.userId, auth.user.id))
        .limit(1);

      if (existingLoyalty) {
        const newTotalEarned = existingLoyalty.totalEarned + earnedPoints;
        await tx
          .update(userLoyalty)
          .set({
            pointsBalance: existingLoyalty.pointsBalance + earnedPoints,
            totalEarned: newTotalEarned,
            tier: computeTier(newTotalEarned),
            lastTransactionNote: `Earned +${earnedPoints} pts from booking ${bookingCode}`,
            updatedAt: now,
          })
          .where(eq(userLoyalty.id, existingLoyalty.id));
      } else {
        await tx.insert(userLoyalty).values({
          userId: auth.user.id,
          pointsBalance: earnedPoints,
          totalEarned: earnedPoints,
          totalRedeemed: 0,
          tier: computeTier(earnedPoints),
          lastTransactionNote: `Earned +${earnedPoints} pts from booking ${bookingCode}`,
        });
      }

      await tx.insert(parkingEvents).values({
        eventType: "booking_created",
        lotId: d.lotId,
        slotId: d.slotId,
        bookingId: booking.id,
        actorId: auth.user.id,
        actorRole: auth.user.role,
        details: {
          bookingCode,
          slotCode: lockedSlot.slot_code,
          finalAmount,
          earnedPoints,
        },
      });

      return { booking, payment, earnedPoints, slotCode: lockedSlot.slot_code };
    });

    const qrDataUrl = await generateQrDataUrl(result.booking.qrCodePayload);

    await logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: "BOOKING_CREATED",
      entityType: "booking",
      entityId: result.booking.id,
      metadata: {
        bookingCode: result.booking.bookingCode,
        finalAmount: result.booking.finalAmount,
      },
    });

    return Response.json(
      {
        booking: {
          ...result.booking,
          slotCode: result.slotCode,
          qrDataUrl,
        },
        payment: result.payment,
        earnedPoints: result.earnedPoints,
      },
      { status: 201 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Booking failed";
    if (msg === "SLOT_NOT_FOUND") {
      return Response.json({ error: "Selected slot was not found." }, { status: 404 });
    }
    if (msg.startsWith("SLOT_UNAVAILABLE:")) {
      return Response.json(
        { error: `Slot is currently ${msg.split(":")[1]} and cannot be booked.` },
        { status: 409 }
      );
    }
    if (msg === "SLOT_TIME_CONFLICT") {
      return Response.json(
        { error: "Slot already has an active reservation during this time window." },
        { status: 409 }
      );
    }
    if (msg === "COUPON_INVALID") {
      return Response.json({ error: "Invalid or inactive coupon code." }, { status: 400 });
    }
    if (msg === "COUPON_EXPIRED") {
      return Response.json({ error: "This coupon code has expired." }, { status: 400 });
    }
    if (msg === "COUPON_LIMIT_REACHED") {
      return Response.json({ error: "Coupon usage limit has been reached." }, { status: 400 });
    }
    if (msg.startsWith("COUPON_MIN_AMOUNT:")) {
      return Response.json(
        { error: `Minimum booking amount of ₹${msg.split(":")[1]} required for this coupon.` },
        { status: 400 }
      );
    }
    if (msg === "INSUFFICIENT_LOYALTY_POINTS") {
      return Response.json({ error: "Insufficient loyalty points balance." }, { status: 400 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
