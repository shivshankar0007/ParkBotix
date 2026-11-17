import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, bookings, parkingSlots, parkingEvents } from "@/db";
import { requireAuth, logAudit } from "@/lib/auth";
import { generateQrDataUrl } from "@/lib/qr";

const patchBookingSchema = z.object({
  action: z.enum(["cancel", "toggle_auto_extend"]),
  autoExtendEnabled: z.boolean().optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId)) {
    return Response.json({ error: "Invalid booking ID" }, { status: 400 });
  }

  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    return Response.json({ error: "Booking not found" }, { status: 404 });
  }

  if (
    booking.userId !== auth.user.id &&
    auth.user.role !== "admin" &&
    auth.user.role !== "superadmin"
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return Response.json({
    booking: {
      ...booking,
      qrDataUrl: await generateQrDataUrl(booking.qrCodePayload),
    },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId)) {
    return Response.json({ error: "Invalid booking ID" }, { status: 400 });
  }

  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    return Response.json({ error: "Booking not found" }, { status: 404 });
  }

  if (
    booking.userId !== auth.user.id &&
    auth.user.role !== "admin" &&
    auth.user.role !== "superadmin"
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = patchBookingSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid action" }, { status: 400 });
  }

  if (parsed.data.action === "cancel") {
    if (booking.status !== "confirmed" && booking.status !== "pending") {
      return Response.json(
        { error: `Cannot cancel a booking in '${booking.status}' state.` },
        { status: 400 }
      );
    }

    const [updated] = await db.transaction(async (tx) => {
      const res = await tx
        .update(bookings)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(bookings.id, bookingId))
        .returning();

      await tx
        .update(parkingSlots)
        .set({ status: "available", currentBookingId: null, updatedAt: new Date() })
        .where(eq(parkingSlots.id, booking.slotId));

      await tx.insert(parkingEvents).values({
        eventType: "booking_cancelled",
        lotId: booking.lotId,
        slotId: booking.slotId,
        bookingId: booking.id,
        actorId: auth.user.id,
        actorRole: auth.user.role,
        details: { bookingCode: booking.bookingCode },
      });

      return res;
    });

    await logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: "BOOKING_CANCELLED",
      entityType: "booking",
      entityId: bookingId,
    });

    return Response.json({ booking: updated });
  }

  const nextVal =
    parsed.data.autoExtendEnabled ?? !booking.autoExtendEnabled;
  const [updated] = await db
    .update(bookings)
    .set({ autoExtendEnabled: nextVal, updatedAt: new Date() })
    .where(eq(bookings.id, bookingId))
    .returning();

  return Response.json({ booking: updated });
}
