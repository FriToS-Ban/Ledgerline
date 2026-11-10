/**
 * Container migration entrypoint. Bundled by esbuild into dist/migrate.cjs (see Dockerfile) so the
 * runtime image needs no dev dependencies. Idempotent (drizzle tracks applied migrations) and safe
 * with several replicas starting at once (a Postgres advisory lock serialises them). Exits non-zero
 * on any failure so the container does not start against an unmigrated database.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const LOCK_ID = 727_001;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    await migrate(drizzle(client), { migrationsFolder: process.env.MIGRATIONS_DIR || path.join(process.cwd(), "drizzle") });
    console.log("migrations applied");
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("MIGRATION FAILED:", e);
  process.exit(1);
});
