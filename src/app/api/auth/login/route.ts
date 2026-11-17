import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { createSession, verifyPassword, logAudit } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  await ensureSeeded();
  const ip = getClientIp(request);
  const rl = checkRateLimit(`login:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return Response.json(
      { error: "Too many login attempts. Please wait a minute." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Please provide a valid email and password." },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const user = rows[0];
    if (!user || !user.isActive) {
      return Response.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await logAudit({
        actorId: user.id,
        actorRole: user.role,
        action: "LOGIN_FAILED",
        entityType: "session",
        entityId: user.id,
        outcome: "denied",
        ipAddress: ip,
      });
      return Response.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    await createSession(user.id, {
      userAgent: request.headers.get("user-agent"),
      ipAddress: ip,
    });

    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: "LOGIN_SUCCESS",
      entityType: "session",
      entityId: user.id,
      ipAddress: ip,
    });

    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        assignedLotId: user.assignedLotId,
        vehicleNumber: user.vehicleNumber,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Login failed" },
      { status: 500 }
    );
  }
}
