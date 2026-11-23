import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type QueryResultRow } from "pg";
import * as schema from "./schema";

export const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/ledgerline";

type Cache = { pool?: Pool; url?: string; db?: NodePgDatabase<typeof schema> };
// Kept on globalThis so dev HMR reloads reuse one pool instead of leaking connections.
const g = globalThis as typeof globalThis & { __ledgerlineDb?: Cache };
const cache = (g.__ledgerlineDb ??= {});

/**
 * node-postgres already treats sslmode=prefer/require/verify-ca as verify-full, and logs a long
 * SECURITY WARNING on every cold start when it sees them (hosted Postgres URLs use sslmode=require).
 * Spelling out verify-full keeps the exact same behaviour without the log noise.
 */
export function normalizeDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    const mode = u.searchParams.get("sslmode");
    if (mode && ["prefer", "require", "verify-ca"].includes(mode) && !u.searchParams.has("uselibpqcompat")) {
      u.searchParams.set("sslmode", "verify-full");
      return u.toString();
    }
  } catch {
    /* not a URL pg can parse either; leave it for pg to report */
  }
  return url;
}

export const databaseUrl = () => normalizeDatabaseUrl(process.env.DATABASE_URL || DEFAULT_DATABASE_URL);

/** The shared node-postgres pool (re-created if DATABASE_URL changed, e.g. between test files). */
export function getPool(): Pool {
  const url = databaseUrl();
  if (!cache.pool || cache.url !== url) {
    void cache.pool?.end().catch(() => {});
    cache.pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
    cache.pool.on("error", (e) => console.error("postgres pool error", e.message));
    cache.url = url;
    cache.db = undefined;
  }
  return cache.pool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  const pool = getPool();
  return (cache.db ??= drizzle(pool, { schema }));
}

/** Parameterised raw SQL ($1, $2, ...) returning plain rows with snake_case column names. */
export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await getPool().query<T>(text, params)).rows;
}

export async function closeDb() {
  const p = cache.pool;
  cache.pool = undefined;
  cache.db = undefined;
  await p?.end();
}
