import { randomBytes } from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/ledgerline_test";

const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};
const baseName = () => decodeURIComponent(new URL(TEST_DATABASE_URL).pathname.slice(1));
export const templateName = () => `${baseName()}_template`;
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** A connection to the maintenance database of the same server. */
export async function adminClient() {
  const c = new Client({ connectionString: withDb(TEST_DATABASE_URL, "postgres") });
  await c.connect();
  return c;
}

/** Drops and recreates the template database and applies every committed migration to it. */
export async function buildTemplate() {
  const admin = await adminClient();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${ident(templateName())} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${ident(templateName())}`);
  } finally {
    await admin.end();
  }
  const pool = new Pool({ connectionString: withDb(TEST_DATABASE_URL, templateName()) });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  } finally {
    await pool.end();
  }
}

export async function dropTemplate() {
  const admin = await adminClient();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${ident(templateName())} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/** A fresh, fully migrated database cloned from the template. Returns its URL and a drop function. */
export async function createTestDatabase() {
  const name = `${baseName()}_${randomBytes(5).toString("hex")}`;
  const admin = await adminClient();
  try {
    // Cloning a template needs exclusive use of it; serialise concurrent test files.
    await admin.query("SELECT pg_advisory_lock(7351)");
    await admin.query(`CREATE DATABASE ${ident(name)} TEMPLATE ${ident(templateName())}`);
    await admin.query("SELECT pg_advisory_unlock(7351)");
  } finally {
    await admin.end();
  }
  return {
    url: withDb(TEST_DATABASE_URL, name),
    drop: async () => {
      const a = await adminClient();
      try {
        await a.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`);
      } finally {
        await a.end();
      }
    },
  };
}
