import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, notLike, sql } from "drizzle-orm";
import { getDb, databaseUrl, query } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEMO_DOMAIN, DEMO_ORGS, DEMO_USERS } from "./demo-users";
import { hashPassword } from "./hash";
import { DEFAULT_LIMITS, isRole, type Role } from "./roles";

export type OrgRole = "owner" | "admin" | "member";

/** The legacy app role (clerk / approver / admin) on users.role. Informational only: authorization uses memberships.role. */
export type UserSummary = { email: string; name: string; role: Role };

/** Demo accounts exist (and can sign in) only with DEMO_USERS=1, in every environment. */
export const demoUsersEnabled = () => process.env.DEMO_USERS === "1";
export const isDemoEmail = (email: string) => email.trim().toLowerCase().endsWith(DEMO_DOMAIN);

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const seeded = new Set<string>();

export async function ensureUsers() {
  if (!demoUsersEnabled()) return;
  const key = databaseUrl();
  if (seeded.has(key)) return;
  const db = getDb();
  const pw = process.env.DEMO_PASSWORD || "ledgerline";
  const orgIds: Record<string, string> = {};
  for (const o of DEMO_ORGS) {
    await db.insert(t.organizations).values(o).onConflictDoNothing({ target: t.organizations.slug });
    const [row] = await db.select({ id: t.organizations.id }).from(t.organizations).where(eq(t.organizations.slug, o.slug));
    orgIds[o.slug] = row.id;
  }
  for (const u of DEMO_USERS) {
    await db
      .insert(t.users)
      .values({ email: u.email, name: u.name, role: u.role, passwordHash: await hashPassword(pw), emailVerified: new Date() })
      .onConflictDoNothing({ target: t.users.email });
    const [row] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, u.email));
    await db
      .insert(t.memberships)
      .values({ orgId: orgIds[u.org], userId: row.id, role: u.membership })
      .onConflictDoNothing({ target: [t.memberships.orgId, t.memberships.userId] });
  }
  seeded.add(key);
}

export type UserRecord = UserSummary & { id: string; hash: string; tokenVersion: number };

/** Looks a user up for sign-in. Demo accounts are invisible unless DEMO_USERS=1. */
export async function findUser(email: string): Promise<UserRecord | null> {
  await ensureUsers();
  const e = normalizeEmail(email);
  if (isDemoEmail(e) && !demoUsersEnabled()) return null;
  const [r] = await getDb().select().from(t.users).where(eq(t.users.email, e));
  if (!r || !isRole(r.role)) return null;
  return { id: r.id, email: r.email, name: r.name ?? "", role: r.role, hash: r.passwordHash ?? "", tokenVersion: r.tokenVersion };
}

/* ------------------------------------------------------------- memberships */

export type Membership = { orgId: string; orgRole: OrgRole };

/** The user's membership of `orgId`, or null. This is the only place an active org is authorised. */
export async function membershipFor(userId: string, orgId: string): Promise<Membership | null> {
  const [m] = await getDb()
    .select({ orgId: t.memberships.orgId, orgRole: t.memberships.role })
    .from(t.memberships)
    .where(and(eq(t.memberships.userId, userId), eq(t.memberships.orgId, orgId)));
  return m ?? null;
}

/** The default active org: the user's earliest membership. */
export async function firstMembership(userId: string): Promise<Membership | null> {
  const [m] = await getDb()
    .select({ orgId: t.memberships.orgId, orgRole: t.memberships.role })
    .from(t.memberships)
    .where(eq(t.memberships.userId, userId))
    .orderBy(asc(t.memberships.createdAt), asc(t.memberships.orgId))
    .limit(1);
  return m ?? null;
}

export async function listMemberships(userId: string) {
  return getDb()
    .select({ orgId: t.memberships.orgId, orgRole: t.memberships.role, name: t.organizations.name, slug: t.organizations.slug })
    .from(t.memberships)
    .innerJoin(t.organizations, eq(t.organizations.id, t.memberships.orgId))
    .where(eq(t.memberships.userId, userId))
    .orderBy(asc(t.memberships.createdAt), asc(t.memberships.orgId));
}

/* ----------------------------------------------------------------- invites */

export const hashInviteToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type ValidInvite = { id: string; orgId: string; role: OrgRole };

/** An unaccepted, unexpired invite for exactly this email, looked up by the sha256 of its token. */
export async function findInvite(token: string, email: string): Promise<ValidInvite | null> {
  const [inv] = await getDb()
    .select({ id: t.invites.id, orgId: t.invites.orgId, role: t.invites.role })
    .from(t.invites)
    .where(
      and(
        eq(t.invites.tokenHash, hashInviteToken(token)),
        eq(t.invites.email, normalizeEmail(email)),
        isNull(t.invites.acceptedAt),
        gt(t.invites.expiresAt, new Date()),
      ),
    );
  return inv ?? null;
}

/* ------------------------------------------------------------------- users */

export type CreatedUser = UserSummary & { id: string; tokenVersion: number };

class InviteTaken extends Error {}

/**
 * Creates a user and its tenancy in one transaction. Without an invite the user gets a personal
 * organization and an `owner` membership; with a valid invite they join that organization with the
 * invited role (the invite is consumed atomically). Returns null when the email is already taken or
 * the invite was used up by someone else in the meantime.
 */
export async function createUser(u: {
  email: string;
  name: string;
  password: string;
  role: Role;
  invite?: ValidInvite;
}): Promise<CreatedUser | null> {
  await ensureUsers();
  const email = normalizeEmail(u.email);
  const passwordHash = await hashPassword(u.password);
  try {
    return await getDb().transaction(async (tx) => {
      const rows = await tx
        .insert(t.users)
        .values({ email, name: u.name, role: u.role, passwordHash, passwordChangedAt: new Date() })
        .onConflictDoNothing({ target: t.users.email })
        .returning({ id: t.users.id, tokenVersion: t.users.tokenVersion });
      if (rows.length !== 1) return null;
      const { id, tokenVersion } = rows[0];
      if (u.invite) {
        const used = await tx
          .update(t.invites)
          .set({ acceptedAt: new Date() })
          .where(and(eq(t.invites.id, u.invite.id), isNull(t.invites.acceptedAt)))
          .returning({ id: t.invites.id });
        if (used.length !== 1) throw new InviteTaken();
        await tx.insert(t.memberships).values({ orgId: u.invite.orgId, userId: id, role: u.invite.role });
      } else {
        const [org] = await tx
          .insert(t.organizations)
          .values({ name: `${u.name.trim() || email}'s workspace`, slug: `personal-${randomBytes(6).toString("hex")}` })
          .returning({ id: t.organizations.id });
        await tx.insert(t.memberships).values({ orgId: org.id, userId: id, role: "owner" });
      }
      return { id, email, name: u.name, role: u.role, tokenVersion };
    });
  } catch (e) {
    if (e instanceof InviteTaken) return null;
    throw e;
  }
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

/**
 * Sets a new password and bumps tokenVersion in one statement, so every JWT issued before this
 * moment is rejected. Returns the new version (callers re-issue the caller's own token with it).
 */
export async function setPassword(email: string, password: string): Promise<number> {
  const [r] = await getDb()
    .update(t.users)
    .set({ passwordHash: await hashPassword(password), passwordChangedAt: new Date(), tokenVersion: sql`${t.users.tokenVersion} + 1` })
    .where(eq(t.users.email, normalizeEmail(email)))
    .returning({ v: t.users.tokenVersion });
  return r.v;
}

/** "Sign out everywhere": invalidates every JWT of this user. Returns the new version. */
export async function bumpTokenVersion(userId: string): Promise<number> {
  const [r] = await getDb()
    .update(t.users)
    .set({ tokenVersion: sql`${t.users.tokenVersion} + 1` })
    .where(eq(t.users.id, userId))
    .returning({ v: t.users.tokenVersion });
  return r.v;
}

/** Members of one organization (nobody outside it), with their org role. */
export async function listOrgMembers(orgId: string) {
  await ensureUsers();
  const rows = await getDb()
    .select({ email: t.users.email, name: t.users.name, role: t.memberships.role, createdAt: t.memberships.createdAt })
    .from(t.memberships)
    .innerJoin(t.users, eq(t.users.id, t.memberships.userId))
    .where(eq(t.memberships.orgId, orgId))
    .orderBy(asc(t.memberships.createdAt), asc(t.users.email));
  return rows
    .filter((r) => demoUsersEnabled() || !isDemoEmail(r.email))
    .map((r) => ({ email: r.email, name: r.name ?? "", role: r.role as OrgRole, createdAt: r.createdAt.toISOString() }));
}

export type RoleChange =
  | { ok: true; user: { email: string; name: string; role: OrgRole } }
  | { ok: false; status: 403 | 404 | 409; error: string };

/**
 * Changes a member's role in `orgId` (the caller's active org; someone who is not a member there
 * is a 404, never touched). Admins cannot grant or remove `owner`; the last owner of an org cannot be
 * demoted (the guard is inside the UPDATE, so two concurrent demotions can't both succeed).
 */
export async function changeMemberRole(orgId: string, actorRole: OrgRole, email: string, role: OrgRole): Promise<RoleChange> {
  const e = normalizeEmail(email);
  const [target] = await getDb()
    .select({ userId: t.users.id, name: t.users.name, role: t.memberships.role })
    .from(t.memberships)
    .innerJoin(t.users, eq(t.users.id, t.memberships.userId))
    .where(and(eq(t.memberships.orgId, orgId), eq(t.users.email, e)));
  if (!target || (isDemoEmail(e) && !demoUsersEnabled())) return { ok: false, status: 404, error: "No member with that email" };
  if (actorRole !== "owner" && (role === "owner" || target.role === "owner")) {
    return { ok: false, status: 403, error: "Only an owner can grant or change the owner role." };
  }
  const rows = await query(
    `UPDATE memberships SET role = $1::membership_role
     WHERE org_id = $2 AND user_id = $3
       AND (role <> 'owner' OR $1::text = 'owner' OR (SELECT COUNT(*) FROM memberships WHERE org_id = $2 AND role = 'owner') > 1)
     RETURNING user_id`,
    [role, orgId, target.userId],
  );
  if (rows.length !== 1) return { ok: false, status: 409, error: "Cannot remove the last owner. Make someone else an owner first." };
  return { ok: true, user: { email: e, name: target.name ?? "", role } };
}

/** Dollar ceiling an org role may release without a more senior person: owners unlimited, admins the approver limit, members the (lower) member limit. */
export async function approvalLimit(orgId: string, orgRole: OrgRole): Promise<number> {
  if (orgRole === "owner") return Infinity;
  const rows = await getDb()
    .select({ key: t.policyRules.key, value: t.policyRules.value })
    .from(t.policyRules)
    .where(and(eq(t.policyRules.orgId, orgId), inArray(t.policyRules.key, ["clerkLimit", "approverLimit"])));
  const get = (k: string, d: number) => {
    const row = rows.find((r) => r.key === k);
    return row ? Number(row.value) : d;
  };
  return orgRole === "admin" ? get("approverLimit", DEFAULT_LIMITS.approver) : get("clerkLimit", DEFAULT_LIMITS.clerk);
}

/** Gives a user with no membership (legacy rows) a personal organization, so every session has an active org. */
export async function ensureMembership(userId: string, label: string): Promise<Membership> {
  const existing = await firstMembership(userId);
  if (existing) return existing;
  const db = getDb();
  const [org] = await db
    .insert(t.organizations)
    .values({ name: `${label}'s workspace`, slug: `personal-${randomBytes(6).toString("hex")}` })
    .returning({ id: t.organizations.id });
  await db.insert(t.memberships).values({ orgId: org.id, userId, role: "owner" }).onConflictDoNothing();
  return (await firstMembership(userId))!;
}
