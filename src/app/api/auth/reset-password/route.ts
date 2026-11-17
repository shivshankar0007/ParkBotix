import { z } from "zod";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, users, passwordResets, sessions } from "@/db";
import { hashPassword, hashToken, logAudit } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const resetSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  otp: z.string().trim().regex(/^\d{6}$/, "OTP must be a 6-digit code"),
  newPassword: z.string().min(8, "New password must be at least 8 characters").max(100),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`reset:${ip}`, 15, 60_000);
  if (!rl.allowed) {
    return Response.json({ error: "Too many verification attempts." }, { status: 429 });
  }

  try {
    const body = await request.json();
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid reset input" },
        { status: 400 }
      );
    }

    const { email, otp, newPassword } = parsed.data;
    const now = new Date();

    const [record] = await db
      .select()
      .from(passwordResets)
      .where(
        and(
          eq(passwordResets.email, email),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, now)
        )
      )
      .orderBy(desc(passwordResets.createdAt))
      .limit(1);

    if (!record) {
      return Response.json(
        { error: "OTP expired or invalid. Please request a new OTP." },
        { status: 400 }
      );
    }

    if (record.attempts >= 5) {
      return Response.json(
        { error: "Maximum OTP attempts exceeded. Request a new code." },
        { status: 400 }
      );
    }

    const providedHash = hashToken(`${email}:${otp}`);
    if (providedHash !== record.otpHash) {
      await db
        .update(passwordResets)
        .set({ attempts: record.attempts + 1 })
        .where(eq(passwordResets.id, record.id));
      return Response.json({ error: "Incorrect OTP code." }, { status: 400 });
    }

    const passwordHash = await hashPassword(newPassword);

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, record.userId));

      await tx
        .update(passwordResets)
        .set({ usedAt: now })
        .where(eq(passwordResets.id, record.id));

      // Invalidate all prior active sessions after password reset
      await tx.delete(sessions).where(eq(sessions.userId, record.userId));
    });

    await logAudit({
      actorId: record.userId,
      actorRole: "user",
      action: "PASSWORD_RESET_COMPLETED",
      entityType: "user",
      entityId: record.userId,
      ipAddress: ip,
    });

    return Response.json({
      ok: true,
      message: "Password updated successfully. You can now sign in with your new password.",
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Password reset failed" },
      { status: 500 }
    );
  }
}
