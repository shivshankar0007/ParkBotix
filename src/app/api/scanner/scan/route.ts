import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  db,
  bookings,
  parkingSlots,
  parkingLots,
  penalties,
  penaltyShareLogs,
  parkingEvents,
} from "@/db";
import { requireRole, logAudit } from "@/lib/auth";
import { verifySignedQr } from "@/lib/qr";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const scanSchema = z.object({
  qrInput: z.string().trim().min(4, "QR payload or booking code required"),
  mode: z.enum(["auto", "entry", "exit"]).default("auto"),
  gateName: z.string().trim().max(40).default("Main Gate 01"),
});

export async function POST(request: Request) {
  const auth = await requireRole(["employee", "admin", "superadmin"]);
  if (auth.error) return auth.error;

  const ip = getClientIp(request);
  const rl = checkRateLimit(`scan:${auth.user.id}`, 60, 60_000);
  if (!rl.allowed) {
    return Response.json({ error: "Scanner rate limit exceeded." }, { status: 429 });
  }

  try {
    const body = await request.json();
    const parsed = scanSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid QR scan request" },
        { status: 400 }
      );
    }

    const verification = verifySignedQr(parsed.data.qrInput);
    if (!verification.valid || !verification.bookingCode) {
      await db.insert(parkingEvents).values({
        eventType: "qr_scan_rejected",
        actorId: auth.user.id,
        actorRole: auth.user.role,
        details: {
          reason: verification.reason || "Invalid QR",
          rawSample: parsed.data.qrInput.slice(0, 32),
        },
      });
      return Response.json(
        {
          ok: false,
          error: verification.reason || "Invalid or forged QR code rejected.",
        },
        { status: 400 }
      );
    }

    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.bookingCode, verification.bookingCode))
      .limit(1);

    if (!booking) {
      return Response.json(
        { ok: false, error: `No booking found for code ${verification.bookingCode}.` },
        { status: 404 }
      );
    }

    // Employee lot authorization check
    if (
      auth.user.role === "employee" &&
      auth.user.assignedLotId &&
      booking.lotId !== auth.user.assignedLotId
    ) {
      await logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        action: "SCANNER_LOT_MISMATCH_DENIED",
        entityType: "booking",
        entityId: booking.id,
        outcome: "denied",
        metadata: {
          assignedLotId: auth.user.assignedLotId,
          bookingLotId: booking.lotId,
        },
        ipAddress: ip,
      });
      return Response.json(
        {
          ok: false,
          error: `Unauthorized gate scan: this booking belongs to Lot #${booking.lotId}, but your scanner is assigned to Lot #${auth.user.assignedLotId}.`,
        },
        { status: 403 }
      );
    }

    const [slot] = await db
      .select()
      .from(parkingSlots)
      .where(eq(parkingSlots.id, booking.slotId))
      .limit(1);
    const [lot] = await db
      .select()
      .from(parkingLots)
      .where(eq(parkingLots.id, booking.lotId))
      .limit(1);

    if (booking.status === "cancelled") {
      return Response.json(
        { ok: false, error: "This booking was cancelled and cannot be scanned." },
        { status: 400 }
      );
    }
    if (booking.status === "completed") {
      return Response.json(
        {
          ok: false,
          error: "Duplicate scan rejected: this booking has already completed exit.",
        },
        { status: 409 }
      );
    }
    if (booking.status === "expired") {
      return Response.json(
        { ok: false, error: "Booking has expired." },
        { status: 400 }
      );
    }

    const now = new Date();
    const targetAction =
      parsed.data.mode === "auto"
        ? booking.status === "confirmed" || booking.status === "pending"
          ? "entry"
          : "exit"
        : parsed.data.mode;

    // ENTRY WORKFLOW
    if (targetAction === "entry") {
      if (booking.actualEntryTime || booking.status === "active") {
        return Response.json(
          {
            ok: false,
            error: "Duplicate entry scan blocked: vehicle has already checked in.",
          },
          { status: 409 }
        );
      }

      if (now > booking.endTime) {
        await db
          .update(bookings)
          .set({ status: "expired", updatedAt: now })
          .where(eq(bookings.id, booking.id));
        await db
          .update(parkingSlots)
          .set({ status: "available", currentBookingId: null, updatedAt: now })
          .where(eq(parkingSlots.id, booking.slotId));
        return Response.json(
          {
            ok: false,
            error: "Booking window has already expired. Entry denied and slot released.",
          },
          { status: 400 }
        );
      }

      const [updated] = await db.transaction(async (tx) => {
        const bRes = await tx
          .update(bookings)
          .set({
            status: "active",
            actualEntryTime: now,
            updatedAt: now,
          })
          .where(eq(bookings.id, booking.id))
          .returning();

        await tx
          .update(parkingSlots)
          .set({
            status: "occupied",
            currentBookingId: booking.id,
            updatedAt: now,
          })
          .where(eq(parkingSlots.id, booking.slotId));

        await tx.insert(parkingEvents).values({
          eventType: "qr_entry_verified",
          lotId: booking.lotId,
          slotId: booking.slotId,
          bookingId: booking.id,
          actorId: auth.user.id,
          actorRole: auth.user.role,
          details: {
            bookingCode: booking.bookingCode,
            gateName: parsed.data.gateName,
            signedToken: verification.isSignedToken,
            vehicleNumber: booking.vehicleNumber,
          },
        });

        return bRes;
      });

      await logAudit({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        action: "QR_ENTRY_SCANNED",
        entityType: "booking",
        entityId: booking.id,
        metadata: { bookingCode: booking.bookingCode, gateName: parsed.data.gateName },
        ipAddress: ip,
      });

      return Response.json({
        ok: true,
        action: "entry",
        message: `ENTRY APPROVED — Gate opened for ${booking.vehicleNumber} → Slot ${slot?.slotCode ?? booking.slotId}`,
        booking: updated,
        slotCode: slot?.slotCode,
        lotName: lot?.name,
        scannedAt: now.toISOString(),
      });
    }

    // EXIT WORKFLOW
    if (booking.status !== "active" || !booking.actualEntryTime) {
      return Response.json(
        {
          ok: false,
          error: "Cannot process exit before vehicle entry has been scanned.",
        },
        { status: 400 }
      );
    }

    const overtimeMs = Math.max(0, now.getTime() - booking.endTime.getTime());
    const overtimeMinutes = Math.floor(overtimeMs / 60000);
    // 10-minute grace period, then ₹25 per 15-minute overtime block
    const billableOvertime = Math.max(0, overtimeMinutes - 10);
    const penaltyAmount =
      billableOvertime > 0 ? Math.ceil(billableOvertime / 15) * 25 : 0;

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(bookings)
        .set({
          status: "completed",
          actualExitTime: now,
          updatedAt: now,
        })
        .where(eq(bookings.id, booking.id))
        .returning();

      await tx
        .update(parkingSlots)
        .set({
          status: "available",
          currentBookingId: null,
          updatedAt: now,
        })
        .where(eq(parkingSlots.id, booking.slotId));

      let createdPenalty: typeof penalties.$inferSelect | null = null;
      if (penaltyAmount > 0) {
        const [p] = await tx
          .insert(penalties)
          .values({
            bookingId: booking.id,
            userId: booking.userId,
            lotId: booking.lotId,
            reason: `Overtime exit (${overtimeMinutes} mins beyond scheduled window)`,
            overtimeMinutes,
            amount: penaltyAmount,
            status: "unpaid",
          })
          .returning();
        createdPenalty = p;

        await tx.insert(penaltyShareLogs).values({
          penaltyId: p.id,
          ownerId: lot?.ownerId ?? null,
          platformShare: Math.round(penaltyAmount * 0.2 * 100) / 100,
          ownerShare: Math.round(penaltyAmount * 0.8 * 100) / 100,
          settled: false,
        });
      }

      await tx.insert(parkingEvents).values({
        eventType: "qr_exit_verified",
        lotId: booking.lotId,
        slotId: booking.slotId,
        bookingId: booking.id,
        actorId: auth.user.id,
        actorRole: auth.user.role,
        details: {
          bookingCode: booking.bookingCode,
          gateName: parsed.data.gateName,
          overtimeMinutes,
          penaltyAmount,
          vehicleNumber: booking.vehicleNumber,
        },
      });

      return { updated, createdPenalty };
    });

    await logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: "QR_EXIT_SCANNED",
      entityType: "booking",
      entityId: booking.id,
      metadata: {
        bookingCode: booking.bookingCode,
        overtimeMinutes,
        penaltyAmount,
      },
      ipAddress: ip,
    });

    return Response.json({
      ok: true,
      action: "exit",
      message:
        penaltyAmount > 0
          ? `EXIT APPROVED (Overtime ${overtimeMinutes}m • Penalty ₹${penaltyAmount}) — Slot ${slot?.slotCode} released.`
          : `EXIT APPROVED — Vehicle ${booking.vehicleNumber} cleared. Slot ${slot?.slotCode} is now available.`,
      booking: result.updated,
      penalty: result.createdPenalty,
      overtimeMinutes,
      slotCode: slot?.slotCode,
      lotName: lot?.name,
      scannedAt: now.toISOString(),
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Scan processing error" },
      { status: 500 }
    );
  }
}
