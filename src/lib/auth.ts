import crypto from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { eq, and, gt } from "drizzle-orm";
import { db, users, sessions, auditLogs } from "@/db";

export const SESSION_COOKIE_NAME = "parkbotix_session";
const SESSION_TTL_DAYS = 7;

export type UserRole = "superadmin" | "admin" | "owner" | "employee" | "customer";

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  assignedLotId: number | null;
  vehicleNumber: string | null;
  isActive: boolean;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: number,
  meta?: { userAgent?: string | null; ipAddress?: string | null }
): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    tokenHash,
    userId,
    expiresAt,
    userAgent: meta?.userAgent ?? null,
    ipAddress: meta?.ipAddress ?? null,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires: expiresAt,
  });

  return rawToken;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (rawToken) {
    const tokenHash = hashToken(rawToken);
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!rawToken) return null;

    const tokenHash = hashToken(rawToken);
    const now = new Date();

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        assignedLotId: users.assignedLotId,
        vehicleNumber: users.vehicleNumber,
        isActive: users.isActive,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
      .limit(1);

    const user = rows[0];
    if (!user || !user.isActive) return null;

    return {
      ...user,
      role: user.role as UserRole,
    };
  } catch {
    return null;
  }
}

export async function requireAuth(): Promise<
  { user: SessionUser; error?: never } | { user?: never; error: Response }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      error: Response.json(
        { error: "Authentication required. Please log in to continue." },
        { status: 401 }
      ),
    };
  }
  return { user };
}

export async function requireRole(
  allowedRoles: UserRole[]
): Promise<{ user: SessionUser; error?: never } | { user?: never; error: Response }> {
  const auth = await requireAuth();
  if (auth.error) return auth;

  if (!allowedRoles.includes(auth.user.role)) {
    return {
      error: Response.json(
        {
          error: `Forbidden: requires role [${allowedRoles.join(", ")}]. Current role: ${auth.user.role}`,
        },
        { status: 403 }
      ),
    };
  }

  return { user: auth.user };
}

export async function logAudit(params: {
  actorId?: number | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  outcome?: "success" | "denied" | "error";
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorId: params.actorId ?? null,
      actorRole: params.actorRole,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId !== undefined && params.entityId !== null ? String(params.entityId) : null,
      outcome: params.outcome ?? "success",
      metadata: params.metadata ?? {},
      ipAddress: params.ipAddress ?? null,
    });
  } catch {
    // Do not crash caller if audit insert fails
  }
}
