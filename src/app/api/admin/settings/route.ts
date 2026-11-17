import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, settings } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { requireRole, logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

const upsertSettingSchema = z.object({
  key: z.string().trim().min(2).max(80),
  value: z.string().trim().min(1).max(400),
  category: z.string().trim().max(40).default("general"),
  description: z.string().trim().max(250).optional(),
});

export async function GET() {
  await ensureSeeded();
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  const rows = await db.select().from(settings).orderBy(asc(settings.key));
  return Response.json({ settings: rows });
}

export async function PATCH(request: Request) {
  const auth = await requireRole(["superadmin", "admin"]);
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = upsertSettingSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid setting payload" }, { status: 400 });
  }

  const { key, value, category, description } = parsed.data;
  const [existing] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  let saved;
  if (existing) {
    [saved] = await db
      .update(settings)
      .set({
        value,
        category,
        description: description ?? existing.description,
        updatedById: auth.user.id,
        updatedAt: new Date(),
      })
      .where(eq(settings.id, existing.id))
      .returning();
  } else {
    [saved] = await db
      .insert(settings)
      .values({
        key,
        value,
        category,
        description: description ?? null,
        updatedById: auth.user.id,
      })
      .returning();
  }

  await logAudit({
    actorId: auth.user.id,
    actorRole: auth.user.role,
    action: "SETTING_UPDATED",
    entityType: "setting",
    entityId: key,
    metadata: { key, value },
  });

  return Response.json({ setting: saved });
}
