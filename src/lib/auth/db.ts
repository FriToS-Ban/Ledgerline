import { dbConfig, rawDbClient } from "@/lib/db/client";

const ready = new Map<string, Promise<void>>();

/** Creates the users / sessions / throttle tables once per database per process. */
export function ensureAuthSchema(): Promise<void> {
  const key = dbConfig().url;
  let p = ready.get(key);
  if (!p) {
    p = migrate().catch((e) => {
      ready.delete(key);
      throw e;
    });
    ready.set(key, p);
  }
  return p;
}

async function migrate() {
  const db = rawDbClient();
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_email ON auth_sessions (email);
    CREATE INDEX IF NOT EXISTS auth_sessions_expires ON auth_sessions (expires_at);
    CREATE TABLE IF NOT EXISTS auth_throttle (
      key TEXT PRIMARY KEY,
      failures INTEGER NOT NULL,
      first_at INTEGER NOT NULL,
      locked_until INTEGER
    );
    CREATE INDEX IF NOT EXISTS auth_throttle_first_at ON auth_throttle (first_at);
  `);
  for (const col of ["created_at INTEGER", "password_changed_at INTEGER"]) {
    try {
      await db.execute(`ALTER TABLE users ADD COLUMN ${col}`);
    } catch {
      /* column already exists */
    }
  }
}
