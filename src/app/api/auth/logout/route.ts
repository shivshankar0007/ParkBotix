import { destroySession, getCurrentUser, logAudit } from "@/lib/auth";
import { getClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  await destroySession();
  if (user) {
    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: "LOGOUT",
      entityType: "session",
      entityId: user.id,
      ipAddress: getClientIp(request),
    });
  }
  return Response.json({ ok: true, message: "Logged out successfully" });
}
