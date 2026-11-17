import { desc } from "drizzle-orm";
import { db, autoExtensions } from "@/db";
import { requireRole, logAudit } from "@/lib/auth";
import { runAutoExtensionWorker } from "@/lib/auto-extension-worker";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  const logs = await db
    .select()
    .from(autoExtensions)
    .orderBy(desc(autoExtensions.createdAt))
    .limit(50);

  return Response.json({
    worker: "PostgreSQL Advisory-Locked Auto-Extension Scheduler",
    logs,
  });
}

export async function POST(request: Request) {
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  let windowMinutes = 25;
  let extensionMinutes = 30;
  try {
    const body = (await request.json()) as {
      windowMinutes?: number;
      extensionMinutes?: number;
    };
    if (body.windowMinutes && body.windowMinutes > 0 && body.windowMinutes <= 180) {
      windowMinutes = body.windowMinutes;
    }
    if (body.extensionMinutes && body.extensionMinutes >= 15 && body.extensionMinutes <= 120) {
      extensionMinutes = body.extensionMinutes;
    }
  } catch {
    // Use defaults if empty body
  }

  const result = await runAutoExtensionWorker({
    windowMinutes,
    extensionMinutes,
    actorId: auth.user.id,
  });

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "AUTO_EXTENSION_WORKER_RUN",
    entityType: "job",
    entityId: "auto-extend",
    metadata: {
      checkedCount: result.checkedCount,
      extendedCount: result.extendedCount,
      skippedCount: result.skippedCount,
    },
  });

  return Response.json(result);
}
