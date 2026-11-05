import { headers } from "next/headers";
import { ensureSchema, rawDbClient } from "@/lib/db/client";
import { authEnabled, DEFAULT_LIMITS, hashPassword, type Role } from "./session";

const DEMO = [
  { email: "clerk@ledgerline.demo", name: "Casey Clerk", role: "clerk" as Role },
  { email: "approver@ledgerline.demo", name: "Avery Approver", role: "approver" as Role },
  { email: "admin@ledgerline.demo", name: "Alex Admin", role: "admin" as Role },
];

export const demoUsersEnabled = () => process.env.NODE_ENV !== "production" || process.env.DEMO_USERS === "1";

export async function ensureUsers() {
  await ensureSchema();
  const db = rawDbClient();
  await db.execute(
    "CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL)",
  );
  if (!demoUsersEnabled()) return;
  const n = Number((await db.execute("SELECT COUNT(*) c FROM users")).rows[0].c);
  if (n > 0) return;
  const pw = process.env.DEMO_PASSWORD ?? "ledgerline";
  for (const u of DEMO) {
    await db.execute({
      sql: "INSERT INTO users (email,name,role,password_hash) VALUES (?,?,?,?)",
      args: [u.email, u.name, u.role, hashPassword(pw)],
    });
  }
}

export async function findUser(email: string) {
  await ensureUsers();
  const r = (await rawDbClient().execute({ sql: "SELECT * FROM users WHERE email = ?", args: [email.toLowerCase()] })).rows[0];
  return r
    ? { email: String(r.email), name: String(r.name), role: String(r.role) as Role, hash: String(r.password_hash) }
    : null;
}

/** The signed-in user, as verified by proxy.ts (which strips client-supplied x-user-* headers). */
export async function getActor(): Promise<{ email: string; name: string; role: Role } | null> {
  if (!authEnabled()) return { email: "auth-disabled@local", name: "Local (auth off)", role: "admin" };
  const h = await headers();
  const email = h.get("x-user-email");
  const role = h.get("x-user-role") as Role | null;
  return email && role ? { email, name: h.get("x-user-name") ?? email, role } : null;
}

export async function approvalLimit(role: Role): Promise<number> {
  const rows = (
    await rawDbClient().execute("SELECT key,value FROM policy_rules WHERE key IN ('clerkLimit','approverLimit')")
  ).rows;
  const get = (k: string, d: number) => {
    const row = rows.find((r) => r.key === k);
    return row ? Number(row.value) : d;
  };
  if (role === "clerk") return get("clerkLimit", DEFAULT_LIMITS.clerk);
  if (role === "approver") return get("approverLimit", DEFAULT_LIMITS.approver);
  return Infinity;
}

/** Returns a 403-style message when the actor's role is not in `allowed`, else null. */
export async function denyUnless(allowed: Role[]): Promise<{ status: number; error: string } | null> {
  const actor = await getActor();
  if (!actor) return { status: 401, error: "sign in required" };
  if (!allowed.includes(actor.role)) return { status: 403, error: `requires role: ${allowed.join(" or ")}` };
  return null;
}
