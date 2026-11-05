import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const dbPath = () => path.join(process.cwd(), "data", "app.db");

function fileUrl(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return `file:${p.replace(/\\/g, "/")}`;
}

/**
 * Local SQLite file by default. Set DATABASE_URL (libsql://..., a hosted Turso/libSQL database)
 * plus DATABASE_AUTH_TOKEN to run the same code against a shared, hosted database instead.
 */
export function dbConfig() {
  const url = process.env.DATABASE_URL;
  if (url) return { url, authToken: process.env.DATABASE_AUTH_TOKEN };
  return { url: fileUrl(dbPath()) };
}

export const usingHostedDb = () => !!process.env.DATABASE_URL;

export function rawDbClient() {
  return createClient(dbConfig());
}

export function getDb() {
  return drizzle(createClient(dbConfig()), { schema });
}

export async function ensureSchema() {
  const client = createClient(dbConfig());
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      legal_name TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 1,
      currency TEXT NOT NULL DEFAULT 'USD',
      payment_terms TEXT NOT NULL DEFAULT 'Net 30'
    );
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      vendor_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'open',
      issue_date TEXT NOT NULL,
      description TEXT NOT NULL,
      goods_received INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS po_lines (
      id TEXT PRIMARY KEY,
      po_id TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      demo_id TEXT,
      vendor_id TEXT,
      invoice_number TEXT,
      invoice_date TEXT,
      currency TEXT,
      total REAL,
      pdf_path TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      run_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoice_lines (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      po_number TEXT
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      po_id TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS allocations (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fx_rates (
      id TEXT PRIMARY KEY,
      base TEXT NOT NULL,
      quote TEXT NOT NULL,
      rate REAL NOT NULL,
      as_of TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'seed'
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      final TEXT,
      confidence REAL NOT NULL,
      explanation TEXT NOT NULL,
      needs_human INTEGER NOT NULL,
      trace TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      step TEXT NOT NULL,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS policy_rules (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      label TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS decision_corrections (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      situation TEXT NOT NULL,
      original TEXT NOT NULL,
      human TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 4,
      run_at TEXT NOT NULL,
      locked_until TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_status_run_at ON jobs (status, run_at);
    CREATE TABLE IF NOT EXISTS email_messages (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL UNIQUE,
      sender TEXT,
      subject TEXT,
      received_at TEXT NOT NULL,
      attachments INTEGER NOT NULL DEFAULT 0,
      invoice_ids TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'webhook',
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS eval_cases (
      invoice_id TEXT PRIMARY KEY,
      scenario TEXT NOT NULL,
      expected TEXT NOT NULL,
      truth TEXT NOT NULL,
      batch TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS master_imports (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      signature TEXT,
      vendors INTEGER NOT NULL DEFAULT 0,
      pos INTEGER NOT NULL DEFAULT 0,
      po_lines INTEGER NOT NULL DEFAULT 0,
      errors TEXT NOT NULL DEFAULT '[]',
      at TEXT NOT NULL
    );
  `);
  for (const col of [
    "source TEXT NOT NULL DEFAULT 'upload'",
    "sender TEXT",
    "subject TEXT",
  ]) {
    try {
      await client.execute(`ALTER TABLE invoices ADD COLUMN ${col}`);
    } catch {
      /* column already exists */
    }
  }
}
