import { desc, eq, inArray } from "drizzle-orm";
import {
  db,
  parkingLots,
  parkingSlots,
  bookings,
  payments,
  feedback,
  penaltyShareLogs,
  users,
} from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const auth = await requireRole(["owner", "superadmin"]);
  if (auth.error) return auth.error;

  // Strict data isolation: Owners ONLY see lots assigned to their user ID
  const ownedLots =
    auth.user.role === "owner"
      ? await db
          .select()
          .from(parkingLots)
          .where(eq(parkingLots.ownerId, auth.user.id))
      : await db.select().from(parkingLots);

  const lotIds = ownedLots.map((l) => l.id);
  if (lotIds.length === 0) {
    return Response.json({
      lots: [],
      metrics: {
        lotCount: 0,
        totalSlots: 0,
        occupiedOrReserved: 0,
        occupancyPercent: 0,
        verifiedRevenueInr: 0,
        ownerPenaltyShareInr: 0,
        totalBookings: 0,
      },
      bookings: [],
      feedback: [],
      penaltyShares: [],
    });
  }

  const [slots, lotBookings, lotFeedback, shares, allUsers] = await Promise.all([
    db.select().from(parkingSlots).where(inArray(parkingSlots.lotId, lotIds)),
    db
      .select()
      .from(bookings)
      .where(inArray(bookings.lotId, lotIds))
      .orderBy(desc(bookings.createdAt))
      .limit(80),
    db
      .select()
      .from(feedback)
      .where(inArray(feedback.lotId, lotIds))
      .orderBy(desc(feedback.createdAt))
      .limit(50),
    auth.user.role === "owner"
      ? db
          .select()
          .from(penaltyShareLogs)
          .where(eq(penaltyShareLogs.ownerId, auth.user.id))
          .orderBy(desc(penaltyShareLogs.createdAt))
      : db.select().from(penaltyShareLogs).orderBy(desc(penaltyShareLogs.createdAt)),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);

  const bookingIds = lotBookings.map((b) => b.id);
  const lotPayments =
    bookingIds.length > 0
      ? await db
          .select()
          .from(payments)
          .where(inArray(payments.bookingId, bookingIds))
      : [];

  const verifiedRevenue = lotPayments
    .filter((p) => p.status === "verified")
    .reduce((sum, p) => sum + p.amount, 0);
  const ownerPenaltyShare = shares.reduce((sum, s) => sum + s.ownerShare, 0);
  const availableCount = slots.filter((s) => s.status === "available").length;

  const lotMap = new Map(ownedLots.map((l) => [l.id, l.name]));
  const slotMap = new Map(slots.map((s) => [s.id, s.slotCode]));
  const userMap = new Map(allUsers.map((u) => [u.id, u.name]));

  return Response.json({
    lots: ownedLots.map((lot) => {
      const ls = slots.filter((s) => s.lotId === lot.id);
      const avail = ls.filter((s) => s.status === "available").length;
      return {
        ...lot,
        slots: ls,
        availableSlots: avail,
        occupancyPercent:
          ls.length > 0 ? Math.round(((ls.length - avail) / ls.length) * 100) : 0,
      };
    }),
    metrics: {
      lotCount: ownedLots.length,
      totalSlots: slots.length,
      occupiedOrReserved: slots.length - availableCount,
      occupancyPercent:
        slots.length > 0
          ? Math.round(((slots.length - availableCount) / slots.length) * 100)
          : 0,
      verifiedRevenueInr: Math.round(verifiedRevenue * 100) / 100,
      ownerPenaltyShareInr: Math.round(ownerPenaltyShare * 100) / 100,
      totalBookings: lotBookings.length,
    },
    bookings: lotBookings.map((b) => ({
      ...b,
      lotName: lotMap.get(b.lotId) ?? `Lot #${b.lotId}`,
      slotCode: slotMap.get(b.slotId) ?? `Slot #${b.slotId}`,
      customerName: userMap.get(b.userId) ?? "Driver",
    })),
    feedback: lotFeedback.map((f) => ({
      ...f,
      lotName: lotMap.get(f.lotId) ?? `Lot #${f.lotId}`,
      authorName: userMap.get(f.userId) ?? "Driver",
    })),
    penaltyShares: shares,
  });
}
