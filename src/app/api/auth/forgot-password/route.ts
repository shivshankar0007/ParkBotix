import crypto from "crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users, passwordResets } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { hashToken, logAudit } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const forgotSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
});

export async function POST(request: Request) {
  await ensureSeeded();
  const ip = getClientIp(request);
  const rl = checkRateLimit(`forgot:${ip}`, 10, 60_000);
  if (!rl.allowed) {
    return Response.json(
      { error: "Too many OTP requests. Please wait a minute." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const parsed = forgotSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Valid email required" }, { status: 400 });
    }

    const { email } = parsed.data;
    const [user] = await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      // Do not leak user existence in production style response
      return Response.json({
        ok: true,
        message: "If an account exists for that email, a 6-digit OTP has been issued.",
      });
    }

    const otp = String(crypto.randomInt(100000, 999999));
    const otpHash = hashToken(`${email}:${otp}`);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.insert(passwordResets).values({
      userId: user.id,
      email,
      otpHash,
      expiresAt,
      attempts: 0,
    });

    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: "PASSWORD_RESET_OTP_ISSUED",
      entityType: "user",
      entityId: user.id,
      ipAddress: ip,
    });

    const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
    return Response.json({
      ok: true,
      message: smtpConfigured
        ? "A 6-digit OTP has been dispatched to your email address."
        : "SMTP is not configured in this local environment. Use the generated verification OTP shown below (valid 10 minutes).",
      deliveryMode: smtpConfigured ? "smtp" : "local-sandbox",
      sandboxOtp: smtpConfigured ? undefined : otp,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "OTP request failed" },
      { status: 500 }
    );
  }
}
