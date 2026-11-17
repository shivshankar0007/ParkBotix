import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users, userLoyalty } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { createSession, hashPassword, logAudit } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().trim().email("Valid email address required").toLowerCase(),
  phone: z.string().trim().max(25).optional(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100),
  vehicleNumber: z.string().trim().max(30).optional(),
});

export async function POST(request: Request) {
  await ensureSeeded();
  const ip = getClientIp(request);
  const rl = checkRateLimit(`register:${ip}`, 15, 60_000);
  if (!rl.allowed) {
    return Response.json(
      { error: "Too many registration attempts. Please try again shortly." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const { name, email, phone, password, vehicleNumber } = parsed.data;
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return Response.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);
    // Always enforce customer role on public registration — never trust client role
    const [created] = await db
      .insert(users)
      .values({
        name,
        email,
        phone: phone || null,
        passwordHash,
        role: "customer",
        vehicleNumber: vehicleNumber ? vehicleNumber.toUpperCase() : null,
      })
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        vehicleNumber: users.vehicleNumber,
      });

    // Welcome loyalty account (100 points = ₹50 value)
    await db.insert(userLoyalty).values({
      userId: created.id,
      pointsBalance: 100,
      totalEarned: 100,
      totalRedeemed: 0,
      tier: "Bronze",
      lastTransactionNote: "Welcome registration bonus (100 pts)",
    });

    await createSession(created.id, {
      userAgent: request.headers.get("user-agent"),
      ipAddress: ip,
    });

    await logAudit({
      actorId: created.id,
      actorRole: "customer",
      action: "USER_REGISTERED",
      entityType: "user",
      entityId: created.id,
      ipAddress: ip,
    });

    return Response.json({ user: created, message: "Registration successful" }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Registration failed" },
      { status: 500 }
    );
  }
}
