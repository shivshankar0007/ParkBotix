import crypto from "crypto";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, apiKeys } from "@/db";
import { requireRole, hashToken, logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

const createKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.string()).default(["read:lots", "read:ai", "write:edge"]),
});

export async function GET() {
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      isActive: apiKeys.isActive,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt));

  return Response.json({ apiKeys: keys });
}

export async function POST(request: Request) {
  const auth = await requireRole(["superadmin"]);
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "API key name required" }, { status: 400 });
  }

  const rawKey = `pbx_live_${crypto.randomBytes(20).toString("hex")}`;
  const keyPrefix = rawKey.slice(0, 16);
  const keyHash = hashToken(rawKey);

  const [created] = await db
    .insert(apiKeys)
    .values({
      name: parsed.data.name,
      keyPrefix,
      keyHash,
      scopes: parsed.data.scopes,
      createdById: auth.user.id,
      isActive: true,
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      isActive: apiKeys.isActive,
      createdAt: apiKeys.createdAt,
    });

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "API_KEY_CREATED",
    entityType: "api_key",
    entityId: created.id,
    metadata: { name: created.name, keyPrefix },
  });

  return Response.json(
    {
      apiKey: created,
      plainTextKeyOnce: rawKey,
      warning: "Store this secret key securely now. It will never be displayed again.",
    },
    { status: 201 }
  );
}

export async function DELETE(request: Request) {
  const auth = await requireRole(["superadmin"]);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Valid API key id required" }, { status: 400 });
  }

  const [deleted] = await db
    .delete(apiKeys)
    .where(eq(apiKeys.id, id))
    .returning();

  if (!deleted) {
    return Response.json({ error: "API key not found" }, { status: 404 });
  }

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "API_KEY_REVOKED",
    entityType: "api_key",
    entityId: id,
    metadata: { name: deleted.name },
  });

  return Response.json({ ok: true });
}
