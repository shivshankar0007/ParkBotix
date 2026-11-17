import { and, eq, gt, gte, lte, ne, sql } from "drizzle-orm";
import {
  db,
  bookings,
  parkingSlots,
  autoExtensions,
  parkingEvents,
} from "@/db";

const ADVISORY_LOCK_KEY = 40962026; // Distributed Postgres advisory lock for auto-extension worker

export interface AutoExtensionRunResult {
  lockAcquired: boolean;
  checkedCount: number;
  extendedCount: number;
  skippedCount: number;
  extensions: Array<{
    bookingId: number;
    bookingCode: string;
    addedMinutes: number;
    extraCharge: number;
    newEndTime: string;
    reason: string;
  }>;
  ranAt: string;
}

export async function runAutoExtensionWorker(options?: {
  windowMinutes?: number;
  extensionMinutes?: number;
  actorId?: number | null;
}): Promise<AutoExtensionRunResult> {
  const windowMinutes = options?.windowMinutes ?? 20;
  const extensionMinutes = options?.extensionMinutes ?? 30;
  const now = new Date();
  const soonThreshold = new Date(now.getTime() + windowMinutes * 60 * 1000);

  // Acquire PostgreSQL advisory lock so multiple server instances cannot double-extend
  const lockRes = await db.execute(
    sql`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked`
  );
  const locked = Boolean((lockRes.rows[0] as { locked?: boolean } | undefined)?.locked);

  if (!locked) {
    return {
      lockAcquired: false,
      checkedCount: 0,
      extendedCount: 0,
      skippedCount: 0,
      extensions: [],
      ranAt: now.toISOString(),
    };
  }

  try {
    // Find active bookings with auto-extend enabled expiring within windowMinutes
    const candidates = await db
      .select({
        booking: bookings,
        slotHourlyRate: parkingSlots.hourlyRate,
      })
      .from(bookings)
      .innerJoin(parkingSlots, eq(bookings.slotId, parkingSlots.id))
      .where(
        and(
          eq(bookings.status, "active"),
          eq(bookings.autoExtendEnabled, true),
          gte(bookings.endTime, new Date(now.getTime() - 10 * 60 * 1000)),
          lte(bookings.endTime, soonThreshold)
        )
      );

    const extensions: AutoExtensionRunResult["extensions"] = [];
    let skippedCount = 0;

    for (const item of candidates) {
      const b = item.booking;

      // Prevent duplicate extension within last 15 minutes
      const recentExt = await db
        .select()
        .from(autoExtensions)
        .where(
          and(
            eq(autoExtensions.bookingId, b.id),
            gte(autoExtensions.createdAt, new Date(now.getTime() - 15 * 60 * 1000))
          )
        )
        .limit(1);

      if (recentExt.length > 0) {
        skippedCount += 1;
        continue;
      }

      const newEndTime = new Date(b.endTime.getTime() + extensionMinutes * 60 * 1000);

      // Check if another upcoming confirmed/active booking conflicts on the same slot
      const conflicts = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.slotId, b.slotId),
            ne(bookings.id, b.id),
            lte(bookings.startTime, newEndTime),
            gt(bookings.endTime, b.endTime),
            sql`${bookings.status} IN ('confirmed', 'active', 'pending')`
          )
        )
        .limit(1);

      if (conflicts.length > 0) {
        skippedCount += 1;
        await db.insert(parkingEvents).values({
          eventType: "auto_extension_skipped_conflict",
          lotId: b.lotId,
          slotId: b.slotId,
          bookingId: b.id,
          actorId: options?.actorId ?? null,
          actorRole: "system-worker",
          details: {
            reason: "Upcoming conflicting reservation detected on slot",
            conflictingBookingId: conflicts[0].id,
          },
        });
        continue;
      }

      const extraCharge = Math.round(((item.slotHourlyRate * extensionMinutes) / 60) * 100) / 100;
      const reason = `Auto-extended by ${extensionMinutes}m (no upcoming slot conflict)`;

      await db.transaction(async (tx) => {
        await tx
          .update(bookings)
          .set({
            endTime: newEndTime,
            durationHours: Math.round((b.durationHours + extensionMinutes / 60) * 100) / 100,
            totalAmount: Math.round((b.totalAmount + extraCharge) * 100) / 100,
            finalAmount: Math.round((b.finalAmount + extraCharge) * 100) / 100,
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, b.id));

        await tx.insert(autoExtensions).values({
          bookingId: b.id,
          slotId: b.slotId,
          previousEndTime: b.endTime,
          newEndTime,
          addedMinutes: extensionMinutes,
          extraCharge,
          status: "applied",
          reason,
        });

        await tx.insert(parkingEvents).values({
          eventType: "auto_extension_applied",
          lotId: b.lotId,
          slotId: b.slotId,
          bookingId: b.id,
          actorId: options?.actorId ?? null,
          actorRole: "system-worker",
          details: {
            previousEndTime: b.endTime.toISOString(),
            newEndTime: newEndTime.toISOString(),
            addedMinutes: extensionMinutes,
            extraCharge,
          },
        });
      });

      extensions.push({
        bookingId: b.id,
        bookingCode: b.bookingCode,
        addedMinutes: extensionMinutes,
        extraCharge,
        newEndTime: newEndTime.toISOString(),
        reason,
      });
    }

    return {
      lockAcquired: true,
      checkedCount: candidates.length,
      extendedCount: extensions.length,
      skippedCount,
      extensions,
      ranAt: now.toISOString(),
    };
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
  }
}
