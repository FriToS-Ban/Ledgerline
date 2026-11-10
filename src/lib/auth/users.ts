import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, asc, eq, inArray, notLike, sql } from "drizzle-orm";
import { getDb, databaseUrl, query } from "@/lib/db/client";
import { defaultOrgId } from "@/lib/db/org";
import * as t from "@/lib/db/schema";
import { DEMO_DOMAIN, DEMO_USERS } from "./demo-users";
import { authEnabled, COOKIE, DEFAULT_LIMITS, hashPassword, isRole, type Role } from "./session";
import { resolveSession, type Actor } from "./sessions";

export type { Actor } from "./sessions";

/** Demo accounts exist (and can sign in) only with DEMO_USERS=1, in every environment. */
export const demoUsersEnabled = () => process.env.DEMO_USERS === "1";
export const isDemoEmail = (email: string) => email.trim().toLowerCase().endsWith(DEMO_DOMAIN);

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const seeded = new Set<string>();

export async function ensureUsers() {
  if (!demoUsersEnabled()) return;
  const key = databaseUrl();
  if (seeded.has(key)) return;
  const pw = process.env.DEMO_PASSWORD || "ledgerline";
  for (const u of DEMO_USERS) {
    await getDb()
      .insert(t.users)
      .values({ email: u.email, name: u.name, role: u.role, passwordHash: await hashPassword(pw) })
      .onConflictDoNothing({ target: t.users.email });
  }
  seeded.add(key);
}

export type UserRecord = Actor & { hash: string };

/** Looks a user up for sign-in. Demo accounts are invisible unless DEMO_USERS=1. */
export async function findUser(email: string): Promise<UserRecord | null> {
  await ensureUsers();
  const e = normalizeEmail(email);
  if (isDemoEmail(e) && !demoUsersEnabled()) return null;
  const [r] = await getDb().select().from(t.users).where(eq(t.users.email, e));
  if (!r || !isRole(r.role)) return null;
  return { email: r.email, name: r.name ?? "", role: r.role, hash: r.passwordHash ?? "" };
}

/** Creates a user. Returns null when the email is already taken. */
export async function createUser(u: { email: string; name: string; password: string; role: Role }): Promise<Actor | null> {
  await ensureUsers();
  const email = normalizeEmail(u.email);
  const rows = await getDb()
    .insert(t.users)
    .values({ email, name: u.name, role: u.role, passwordHash: await hashPassword(u.password), passwordChangedAt: new Date() })
    .onConflictDoNothing({ target: t.users.email })
    .returning({ id: t.users.id });
  return rows.length === 1 ? { email, name: u.name, role: u.role } : null;
}

/**
 * Condition for admins who can actually sign in. Demo rows stay in the table after
 * DEMO_USERS is switched off, so they must not count then. `includeDemo: false` never counts them.
 */
function usableAdmin(includeDemo = demoUsersEnabled()) {
  return includeDemo
    ? eq(t.users.role, "admin")
    : and(eq(t.users.role, "admin"), notLike(t.users.email, `%${DEMO_DOMAIN}`));
}

/** Admins that are not demo accounts. */
export async function realAdminCount(): Promise<number> {
  await ensureUsers();
  const [r] = await getDb().select({ c: sql<number>`count(*)::int` }).from(t.users).where(usableAdmin(false));
  return r.c;
}

export const MIN_BOOTSTRAP_TOKEN_LENGTH = 24;

/**
 * True when `token` equals BOOTSTRAP_ADMIN_TOKEN (constant-time, over sha256 digests so lengths
 * never leak) AND no real (non-demo) admin exists yet. Tokens shorter than 24 chars are ignored.
 */
export async function bootstrapTokenAccepted(token: string): Promise<boolean> {
  const expected = process.env.BOOTSTRAP_ADMIN_TOKEN?.trim() ?? "";
  const digest = (v: string) => createHash("sha256").update(v).digest();
  const match = timingSafeEqual(digest(token), digest(expected));
  if (!match || expected.length < MIN_BOOTSTRAP_TOKEN_LENGTH) return false;
  return (await realAdminCount()) === 0;
}

export async function setPassword(email: string, password: string) {
  await getDb()
    .update(t.users)
    .set({ passwordHash: await hashPassword(password), passwordChangedAt: new Date() })
    .where(eq(t.users.email, normalizeEmail(email)));
}

export async function listUsers() {
  await ensureUsers();
  const rows = await getDb().select().from(t.users).orderBy(asc(t.users.createdAt), asc(t.users.email));
  return rows
    .filter((r) => demoUsersEnabled() || !isDemoEmail(r.email))
    .map((r) => ({
      email: r.email,
      name: r.name ?? "",
      role: r.role as Role,
      createdAt: r.createdAt.toISOString(),
    }));
}

export type RoleChange =
  | { ok: true; user: Actor }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Changes a user's role. Refuses (409) to demote the last remaining admin; the guard is inside
 * the UPDATE itself so two concurrent demotions can't both succeed.
 */
export async function changeRole(email: string, role: Role): Promise<RoleChange> {
  await ensureUsers();
  const e = normalizeEmail(email);
  const [existing] = await getDb().select().from(t.users).where(eq(t.users.email, e));
  if (!existing || (isDemoEmail(e) && !demoUsersEnabled())) return { ok: false, status: 404, error: "No user with that email" };
  const demoClause = demoUsersEnabled() ? "" : `AND email NOT LIKE '%${DEMO_DOMAIN}'`;
  const rows = await query(
    `UPDATE users SET role = $1::text
     WHERE email = $2
       AND (role != 'admin' OR $1::text = 'admin' OR (SELECT COUNT(*) FROM users WHERE role = 'admin' ${demoClause}) > 1)
     RETURNING id`,
    [role, e],
  );
  if (rows.length !== 1) return { ok: false, status: 409, error: "Cannot remove the last admin. Make someone else an admin first." };
  return { ok: true, user: { email: e, name: existing.name ?? "", role } };
}

/** The signed-in user and session id, verified against the sessions table (not request headers). */
export async function getSession(): Promise<(Actor & { sid: string }) | null> {
  if (!authEnabled()) return { email: "auth-disabled@local", name: "Local (auth off)", role: "admin", sid: "" };
  const token = (await cookies()).get(COOKIE)?.value;
  const s = await resolveSession(token);
  // A demo session minted while DEMO_USERS=1 dies as soon as demo accounts are switched off.
  if (s && isDemoEmail(s.email) && !demoUsersEnabled()) return null;
  return s;
}

/** The signed-in user, or null. Every call checks the DB session (revocation, idle/absolute expiry). */
export async function getActor(): Promise<Actor | null> {
  const s = await getSession();
  return s ? { email: s.email, name: s.name, role: s.role } : null;
}

export async function approvalLimit(role: Role): Promise<number> {
  const rows = await getDb()
    .select({ key: t.policyRules.key, value: t.policyRules.value })
    .from(t.policyRules)
    .where(and(eq(t.policyRules.orgId, await defaultOrgId()), inArray(t.policyRules.key, ["clerkLimit", "approverLimit"])));
  const get = (k: string, d: number) => {
    const row = rows.find((r) => r.key === k);
    return row ? Number(row.value) : d;
  };
  if (role === "clerk") return get("clerkLimit", DEFAULT_LIMITS.clerk);
  if (role === "approver") return get("approverLimit", DEFAULT_LIMITS.approver);
  return Infinity;
}


/**
 * Route-level session check for handlers that any signed-in role may use. proxy.ts only checks
 * the cookie signature, so every API handler must call this (or denyUnless/getActor) to honour
 * revocation, idle timeout and sign-out. Returns a 401 response to send, or null when signed in.
 */
export async function requireSignedIn(): Promise<NextResponse | null> {
  return (await getActor()) ? null : NextResponse.json({ error: "sign in required" }, { status: 401 });
}

/** Returns a 403-style message when the actor's role is not in `allowed`, else null. */
export async function denyUnless(allowed: Role[]): Promise<{ status: number; error: string } | null> {
  const actor = await getActor();
  if (!actor) return { status: 401, error: "sign in required" };
  if (!allowed.includes(actor.role)) return { status: 403, error: `requires role: ${allowed.join(" or ")}` };
  return null;
}
