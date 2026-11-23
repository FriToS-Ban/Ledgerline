/**
 * Applies pending database migrations during `vercel-build`, so every deploy that adds a table or
 * column also updates the database it runs against. Vercel exposes the project's env vars at build
 * time; without DATABASE_URL (e.g. a fork building without secrets) it skips instead of failing.
 *
 * No advisory lock here (unlike scripts/migrate-deploy.ts for Docker): hosted Postgres URLs often go
 * through a transaction-mode pooler, where a session lock and its unlock can land on different
 * backends and leak. Migrations must stay additive (new tables, nullable or defaulted columns) so
 * the previous deployment keeps working against the migrated schema until the new one is live.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { normalizeDatabaseUrl } from "../src/lib/db/client";

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.warn("[migrate] DATABASE_URL is not set at build time; skipping migrations");
    return;
  }
  const pool = new Pool({ connectionString: normalizeDatabaseUrl(raw), max: 1, statement_timeout: 60_000 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    console.log("[migrate] migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[migrate] MIGRATION FAILED:", e);
  process.exit(1);
});
