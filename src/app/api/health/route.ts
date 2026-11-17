import { db, parkingLots, parkingSlots, bookings, users } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { count, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    await ensureSeeded();

    const [lotRes, slotRes, bookingRes, userRes] = await Promise.all([
      db.select({ value: count() }).from(parkingLots),
      db.select({ value: count() }).from(parkingSlots),
      db.select({ value: count() }).from(bookings),
      db.select({ value: count() }).from(users),
    ]);

    return Response.json({
      ok: true,
      service: "ParkBotix Smart Parking API",
      version: "2.0.0",
      timestamp: new Date().toISOString(),
      database: "postgresql",
      aiProviders: {
        groqConfigured: Boolean(process.env.GROQ_API_KEY),
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      },
      counts: {
        lots: lotRes[0]?.value ?? 0,
        slots: slotRes[0]?.value ?? 0,
        bookings: bookingRes[0]?.value ?? 0,
        users: userRes[0]?.value ?? 0,
      },
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Database unavailable" },
      { status: 500 }
    );
  }
}
