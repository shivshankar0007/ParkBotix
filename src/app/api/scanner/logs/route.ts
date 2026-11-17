import { desc, eq, inArray } from "drizzle-orm";
import { db, parkingEvents } from "@/db";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRole(["employee", "admin", "superadmin"]);
  if (auth.error) return auth.error;

  const eventTypes = [
    "qr_entry_verified",
    "qr_exit_verified",
    "qr_scan_rejected",
  ];

  const logs =
    auth.user.role === "employee" && auth.user.assignedLotId
      ? await db
          .select()
          .from(parkingEvents)
          .where(eq(parkingEvents.lotId, auth.user.assignedLotId))
          .orderBy(desc(parkingEvents.createdAt))
          .limit(30)
      : await db
          .select()
          .from(parkingEvents)
          .where(inArray(parkingEvents.eventType, eventTypes))
          .orderBy(desc(parkingEvents.createdAt))
          .limit(40);

  return Response.json({ logs });
}
