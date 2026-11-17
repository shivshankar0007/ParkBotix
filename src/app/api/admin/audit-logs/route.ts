import { desc } from "drizzle-orm";
import { db, auditLogs, parkingEvents } from "@/db";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  const [audits, events] = await Promise.all([
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(80),
    db.select().from(parkingEvents).orderBy(desc(parkingEvents.createdAt)).limit(80),
  ]);

  return Response.json({ auditLogs: audits, parkingEvents: events });
}
