import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { getDb, query } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { seedOrgDefaults } from "@/lib/db/seed";
import { getStorage, keyBelongsToOrg } from "@/lib/storage";
import { ensureMembership, hashInviteToken, normalizeEmail, type OrgRole } from "./users";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ORG_NAME = 60;

export type Failure = { ok: false; status: 400 | 403 | 404 | 409; error: string };
const fail = (status: Failure["status"], error: string): Failure => ({ ok: false, status, error });

export const cleanOrgName = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "workspace";
}

/** Creates a workspace with a unique slug; `userId` becomes its owner; guard policy and FX defaults are seeded. */
export async function createOrg(userId: string, rawName: string): Promise<({ ok: true; orgId: string; slug: string; name: string }) | Failure> {
  const name = cleanOrgName(rawName);
  if (!name) return fail(400, "Enter a workspace name.");
  if (name.length > MAX_ORG_NAME) return fail(400, `Workspace name is too long (${MAX_ORG_NAME} characters max).`);
  const base = slugify(name);
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? `${base}-${randomBytes(3).toString("hex")}` : `${base}-${randomBytes(5).toString("hex")}`;
    const made = await getDb().transaction(async (tx) => {
      const rows = await tx.insert(t.organizations).values({ name, slug }).onConflictDoNothing({ target: t.organizations.slug }).returning({ id: t.organizations.id });
      if (rows.length !== 1) return null;
      await tx.insert(t.memberships).values({ orgId: rows[0].id, userId, role: "owner" });
      return rows[0].id;
    });
    if (made) {
      await seedOrgDefaults(made);
      return { ok: true, orgId: made, slug, name };
    }
  }
  return fail(409, "Could not allocate a workspace address. Try again.");
}

export async function getOrg(orgId: string) {
  const [o] = await getDb().select({ id: t.organizations.id, name: t.organizations.name, slug: t.organizations.slug }).from(t.organizations).where(eq(t.organizations.id, orgId));
  return o ?? null;
}

export async function renameOrg(orgId: string, rawName: string) {
  const name = cleanOrgName(rawName);
  if (!name) return fail(400, "Enter a workspace name.");
  if (name.length > MAX_ORG_NAME) return fail(400, `Workspace name is too long (${MAX_ORG_NAME} characters max).`);
  await getDb().update(t.organizations).set({ name }).where(eq(t.organizations.id, orgId));
  return { ok: true as const, name };
}

/* ------------------------------------------------------------------ members */

/** Removes a member of `orgId` (the caller's active org). Admins cannot remove owners; the last owner can never be removed. */
export async function removeMember(orgId: string, actorRole: OrgRole, email: string): Promise<{ ok: true; userId: string } | Failure> {
  const e = normalizeEmail(email);
  const [target] = await getDb()
    .select({ userId: t.users.id, role: t.memberships.role })
    .from(t.memberships)
    .innerJoin(t.users, eq(t.users.id, t.memberships.userId))
    .where(and(eq(t.memberships.orgId, orgId), eq(t.users.email, e)));
  if (!target) return fail(404, "No member with that email");
  if (actorRole !== "owner" && target.role === "owner") return fail(403, "Only an owner can remove an owner.");
  return dropMembership(orgId, target.userId);
}

/** A member leaves `orgId`. The last owner cannot leave (transfer ownership or delete the workspace instead). */
export async function leaveOrg(orgId: string, userId: string) {
  return dropMembership(orgId, userId);
}

async function dropMembership(orgId: string, userId: string): Promise<{ ok: true; userId: string } | Failure> {
  // The last-owner guard lives inside the DELETE, so two concurrent removals can't both succeed.
  const rows = await query(
    `DELETE FROM memberships WHERE org_id = $1 AND user_id = $2
       AND (role <> 'owner' OR (SELECT COUNT(*) FROM memberships WHERE org_id = $1 AND role = 'owner') > 1)
     RETURNING user_id`,
    [orgId, userId],
  );
  if (rows.length !== 1) return fail(409, "Cannot remove the last owner. Make someone else an owner first.");
  const [u] = await getDb().select({ name: t.users.name }).from(t.users).where(eq(t.users.id, userId));
  await ensureMembership(userId, u?.name || "Personal");
  return { ok: true, userId };
}

/**
 * Deletes a workspace and all of its data in one transaction (every tenant table cascades from
 * organizations), then removes its uploaded files. Members left with no workspace get a personal one.
 * The caller must already have checked the actor is an owner and the typed name matched.
 */
export async function deleteOrg(orgId: string): Promise<{ ok: true; filesRemoved: number } | Failure> {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [org] = await tx.select({ id: t.organizations.id }).from(t.organizations).where(eq(t.organizations.id, orgId)).for("update");
    if (!org) return null;
    const files = await tx.select({ key: t.invoices.pdfPath }).from(t.invoices).where(and(eq(t.invoices.orgId, orgId), isNotNull(t.invoices.pdfPath)));
    const members = await tx.select({ userId: t.memberships.userId }).from(t.memberships).where(eq(t.memberships.orgId, orgId));
    await tx.delete(t.organizations).where(eq(t.organizations.id, orgId));
    return { keys: files.map((f) => f.key as string).filter((k) => keyBelongsToOrg(k, orgId)), members: members.map((m) => m.userId) };
  });
  if (!result) return fail(404, "Workspace not found");
  let removed = 0;
  for (const key of result.keys) {
    try {
      await getStorage().delete(key);
      removed++;
    } catch {
      /* orphaned object: tenant data is already gone from the database */
    }
  }
  for (const userId of result.members) {
    const [u] = await db.select({ name: t.users.name }).from(t.users).where(eq(t.users.id, userId));
    await ensureMembership(userId, u?.name || "Personal");
  }
  return { ok: true, filesRemoved: removed };
}

/* ------------------------------------------------------------------ invites */

export type InviteRow = { id: string; email: string; role: OrgRole; expiresAt: string; createdAt: string; expired: boolean };

export async function listInvites(orgId: string): Promise<InviteRow[]> {
  const rows = await getDb()
    .select({ id: t.invites.id, email: t.invites.email, role: t.invites.role, expiresAt: t.invites.expiresAt, createdAt: t.invites.createdAt })
    .from(t.invites)
    .where(and(eq(t.invites.orgId, orgId), isNull(t.invites.acceptedAt)))
    .orderBy(asc(t.invites.createdAt));
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role as OrgRole,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    expired: r.expiresAt.getTime() <= now,
  }));
}

/**
 * Creates an invite bound to `email`. The raw token is returned once and only its sha256 is stored.
 * Admins cannot invite owners. A newer invite for the same email replaces the older pending one.
 */
export async function createInvite(orgId: string, actorRole: OrgRole, rawEmail: string, role: OrgRole): Promise<{ ok: true; token: string; invite: InviteRow } | Failure> {
  const email = normalizeEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return fail(400, "Enter a valid email address.");
  if (!["owner", "admin", "member"].includes(role)) return fail(400, "Choose a role.");
  if (actorRole !== "owner" && role === "owner") return fail(403, "Only an owner can invite someone as an owner.");
  const db = getDb();
  const [already] = await db
    .select({ id: t.memberships.id })
    .from(t.memberships)
    .innerJoin(t.users, eq(t.users.id, t.memberships.userId))
    .where(and(eq(t.memberships.orgId, orgId), eq(t.users.email, email)));
  if (already) return fail(409, "That person is already a member of this workspace.");
  const token = randomBytes(32).toString("base64url");
  const row = await db.transaction(async (tx) => {
    await tx.delete(t.invites).where(and(eq(t.invites.orgId, orgId), eq(t.invites.email, email), isNull(t.invites.acceptedAt)));
    const [r] = await tx
      .insert(t.invites)
      .values({ orgId, email, role, tokenHash: hashInviteToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
      .returning();
    return r;
  });
  return {
    ok: true,
    token,
    invite: { id: row.id, email, role, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), expired: false },
  };
}

/** Revokes a pending invite of `orgId`. An id from another org (or an accepted invite) is a 404. */
export async function revokeInvite(orgId: string, id: string): Promise<{ ok: true } | Failure> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "Invite not found");
  const rows = await getDb()
    .delete(t.invites)
    .where(and(eq(t.invites.id, id), eq(t.invites.orgId, orgId), isNull(t.invites.acceptedAt)))
    .returning({ id: t.invites.id });
  return rows.length ? { ok: true } : fail(404, "Invite not found");
}

export const INVALID_INVITE = "That invite is not valid or has expired.";

/** Public preview of an invite for the accept page (token holders only; generic null otherwise). */
export async function previewInvite(token: string) {
  const [r] = await getDb()
    .select({ orgName: t.organizations.name, email: t.invites.email, role: t.invites.role })
    .from(t.invites)
    .innerJoin(t.organizations, eq(t.organizations.id, t.invites.orgId))
    .where(and(eq(t.invites.tokenHash, hashInviteToken(token)), isNull(t.invites.acceptedAt), gt(t.invites.expiresAt, new Date())));
  return r ? { orgName: r.orgName, email: r.email, role: r.role as OrgRole } : null;
}

/**
 * A signed-in user accepts an invite. The invite must be pending, unexpired and addressed to this
 * user's email; it is consumed atomically (single use). Joining adds a membership with the invited
 * role (an existing membership keeps its role).
 */
export async function acceptInvite(user: { id: string; email: string }, token: string): Promise<{ ok: true; orgId: string; orgName: string } | Failure> {
  const [inv] = await getDb()
    .select({ id: t.invites.id, orgId: t.invites.orgId, role: t.invites.role, email: t.invites.email, orgName: t.organizations.name })
    .from(t.invites)
    .innerJoin(t.organizations, eq(t.organizations.id, t.invites.orgId))
    .where(and(eq(t.invites.tokenHash, hashInviteToken(token)), isNull(t.invites.acceptedAt), gt(t.invites.expiresAt, new Date())));
  if (!inv) return fail(404, INVALID_INVITE);
  if (inv.email !== normalizeEmail(user.email)) {
    return fail(403, `This invite was sent to a different email address. Sign in with the invited address (you are signed in as ${normalizeEmail(user.email)}).`);
  }
  const ok = await getDb().transaction(async (tx) => {
    const used = await tx
      .update(t.invites)
      .set({ acceptedAt: new Date() })
      .where(and(eq(t.invites.id, inv.id), isNull(t.invites.acceptedAt), gt(t.invites.expiresAt, new Date())))
      .returning({ id: t.invites.id });
    if (used.length !== 1) return false;
    await tx.insert(t.memberships).values({ orgId: inv.orgId, userId: user.id, role: inv.role }).onConflictDoNothing({ target: [t.memberships.orgId, t.memberships.userId] });
    return true;
  });
  return ok ? { ok: true, orgId: inv.orgId, orgName: inv.orgName } : fail(404, INVALID_INVITE);
}
