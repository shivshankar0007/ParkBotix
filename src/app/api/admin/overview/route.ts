import { desc, asc } from "drizzle-orm";
import {
  db,
  users,
  parkingLots,
  parkingSlots,
  bookings,
  payments,
  coupons,
  feedback,
  penalties,
  evChargingSlots,
} from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  const [
    allUsers,
    allLots,
    allSlots,
    allBookings,
    allPayments,
    allCoupons,
    allFeedback,
    allPenalties,
    allEv,
  ] = await Promise.all([
    db
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
      .orderBy(asc(users.id)),
    db.select().from(parkingLots).orderBy(asc(parkingLots.id)),
    db.select().from(parkingSlots).orderBy(asc(parkingSlots.id)),
    db.select().from(bookings).orderBy(desc(bookings.createdAt)).limit(60),
    db.select().from(payments).orderBy(desc(payments.createdAt)).limit(60),
    db.select().from(coupons).orderBy(desc(coupons.createdAt)),
    db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(50),
    db.select().from(penalties).orderBy(desc(penalties.createdAt)).limit(40),
    db.select().from(evChargingSlots),
  ]);

  const verifiedRevenue = allPayments
    .filter((p) => p.status === "verified")
    .reduce((sum, p) => sum + p.amount, 0);
  const penaltyRevenue = allPenalties.reduce((sum, p) => sum + p.amount, 0);
  const availableSlots = allSlots.filter((s) => s.status === "available").length;
  const activeBookings = allBookings.filter(
    (b) => b.status === "active" || b.status === "confirmed"
  ).length;

  return Response.json({
    metrics: {
      totalLots: allLots.length,
      totalSlots: allSlots.length,
      availableSlots,
      occupiedOrReservedSlots: allSlots.length - availableSlots,
      occupancyPercent:
        allSlots.length > 0
          ? Math.round(((allSlots.length - availableSlots) / allSlots.length) * 100)
          : 0,
      totalUsers: allUsers.length,
      activeBookings,
      totalBookings: allBookings.length,
      verifiedRevenueInr: Math.round(verifiedRevenue * 100) / 100,
      penaltyRevenueInr: Math.round(penaltyRevenue * 100) / 100,
      evChargersCount: allEv.length,
    },
    users: allUsers,
    lots: allLots,
    slots: allSlots,
    bookings: allBookings,
    payments: allPayments,
    coupons: allCoupons,
    feedback: allFeedback,
    penalties: allPenalties,
  });
}
