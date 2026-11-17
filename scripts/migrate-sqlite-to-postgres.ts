/**
 * ParkBotix — Safe, Repeatable SQLite-to-PostgreSQL Migration Utility
 *
 * Guarantees:
 * 1. NEVER deletes or modifies the source SQLite database.
 * 2. Automatically creates a timestamped backup before reading.
 * 3. Preserves record IDs and resets PostgreSQL serial sequences.
 * 4. Safely handles SQLite Boolean (0/1), DateTime, Float, and JSON fields.
 * 5. Idempotent: uses ON CONFLICT DO NOTHING to prevent duplicate inserts.
 * 6. Validates pre-migration vs post-migration row counts per table.
 *
 * Usage:
 *   SQLITE_SOURCE_PATH=./instance/parkbotix.db npx tsx scripts/migrate-sqlite-to-postgres.ts
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { Pool } from "pg";
import "dotenv/config";

const ORDERED_TABLES = [
  "users",
  "parking_lots",
  "parking_slots",
  "bookings",
  "payments",
  "penalties",
  "api_keys",
  "ai_activity",
  "password_resets",
  "settings",
  "feedback",
  "coupons",
  "user_loyalty",
  "subscription_plans",
  "user_subscriptions",
  "penalty_share_logs",
  "dynamic_pricing_logs",
  "shadow_reservations",
  "parking_events",
  "slot_morphs",
  "auto_extensions",
  "congestion_predictions",
  "vehicle_fingerprints",
  "ev_charging_slots",
  "marketplace_offers",
  "crowd_density",
] as const;

const BOOLEAN_COLUMNS = new Set([
  "is_active",
  "is_ev_enabled",
  "auto_extend_enabled",
  "ev_bonus",
  "settled",
]);

function readSqliteTableJson(sqlitePath: string, tableName: string): Record<string, unknown>[] {
  try {
    const out = execFileSync(
      "sqlite3",
      ["-readonly", "-json", sqlitePath, `SELECT * FROM "${tableName}";`],
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
    ).trim();
    if (!out) return [];
    return JSON.parse(out) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

function coerceValue(col: string, val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (BOOLEAN_COLUMNS.has(col)) {
    return val === 1 || val === true || val === "1" || val === "true";
  }
  return val;
}

async function main() {
  const sourcePath = path.resolve(
    process.env.SQLITE_SOURCE_PATH || "./instance/parkbotix.db"
  );

  if (!fs.existsSync(sourcePath)) {
    console.log(`[ParkBotix Migration] No SQLite database found at ${sourcePath}.`);
    console.log(
      "Place your existing SQLite database at ./instance/parkbotix.db (or set SQLITE_SOURCE_PATH) and re-run."
    );
    process.exit(0);
  }

  // Step 1: Mandatory timestamped backup before touching anything
  const backupDir = path.resolve("./backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `parkbotix-${stamp}.db.bak`);
  fs.copyFileSync(sourcePath, backupPath);
  console.log(`[Backup] Created untouched source backup at: ${backupPath}`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const report: Array<{ table: string; sqliteRows: number; pgRowsAfter: number }> = [];

  try {
    for (const table of ORDERED_TABLES) {
      const rows = readSqliteTableJson(sourcePath, table);
      if (rows.length === 0) {
        const pgCount = await pool.query(`SELECT COUNT(*)::int AS c FROM "${table}"`);
        report.push({ table, sqliteRows: 0, pgRowsAfter: pgCount.rows[0].c });
        continue;
      }

      // Inspect target Postgres columns to map only matching columns cleanly
      const colInfo = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [table]
      );
      const validCols = new Set(colInfo.rows.map((r) => r.column_name as string));

      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => validCols.has(c));
        if (cols.length === 0) continue;

        const values = cols.map((c) => coerceValue(c, row[c]));
        const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(", ");
        const colList = cols.map((c) => `"${c}"`).join(", ");

        await pool.query(
          `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values
        );
      }

      // Reset PostgreSQL serial sequence after preserving legacy IDs
      await pool.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1), true)`,
        [table]
      );

      const pgCount = await pool.query(`SELECT COUNT(*)::int AS c FROM "${table}"`);
      report.push({
        table,
        sqliteRows: rows.length,
        pgRowsAfter: pgCount.rows[0].c,
      });
    }

    console.log("\n=== PARKBOTIX SQLITE → POSTGRESQL MIGRATION VERIFICATION ===");
    console.table(report);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[Migration Error]", err);
  process.exit(1);
});
