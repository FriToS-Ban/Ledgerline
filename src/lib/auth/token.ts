import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { isRole, type Role } from "./roles";
import { demoUsersEnabled, firstMembership, isDemoEmail, membershipFor, type OrgRole } from "./users";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Absolute lifetime of a sign-in; JWTs slide, so this is enforced separately via `authAt`. */
export const SESSION_MAX_AGE_S = 8 * 60 * 60;

/** Claims we keep in the Auth.js JWT. Everything except userId/tokenVersion/authAt is re-derived from the DB on every read. */
export type AppClaims = {
  userId?: string;
  tokenVersion?: number;
  authAt?: number;
  activeOrgId?: string;
  orgRole?: OrgRole;
  role?: Role;
  email?: string | null;
  name?: string | null;
};

/** Claims for a fresh sign-in. The org is resolved by refreshClaims() right after. */
export const initialClaims = (u: { id: string; email: string; name: string; tokenVersion: number }): AppClaims => ({
  userId: u.id,
  tokenVersion: u.tokenVersion,
  authAt: Date.now(),
  email: u.email,
  name: u.name,
});

/**
 * Runs on every session read (the Auth.js `jwt` callback). Returns the claims to keep, or null to
 * kill the session. This is where revocation lives:
 *  - the user must still exist and the JWT's tokenVersion must equal users.token_version
 *    (password change / "sign out everywhere" bump it), and the sign-in must be under 8 hours old;
 *  - demo accounts die as soon as DEMO_USERS is switched off;
 *  - role and org role are re-read, so role changes apply at once;
 *  - the active org is never taken on trust: `requestedOrgId` (from a session update, i.e. client
 *    influenced) is only honoured when the user has a membership there; otherwise the previously
 *    active org is kept if still valid, else the earliest membership.
 */
export async function refreshClaims(claims: AppClaims, requestedOrgId?: unknown, now = Date.now()): Promise<AppClaims | null> {
  if (!isUuid(claims.userId) || typeof claims.tokenVersion !== "number") return null;
  if (typeof claims.authAt !== "number" || now - claims.authAt > SESSION_MAX_AGE_S * 1000) return null;
  const [u] = await getDb().select().from(users).where(eq(users.id, claims.userId));
  if (!u || u.tokenVersion !== claims.tokenVersion || !isRole(u.role)) return null;
  if (isDemoEmail(u.email) && !demoUsersEnabled()) return null;

  let m = isUuid(requestedOrgId) ? await membershipFor(u.id, requestedOrgId) : null;
  if (!m && isUuid(claims.activeOrgId)) m = await membershipFor(u.id, claims.activeOrgId);
  m ??= await firstMembership(u.id);
  if (!m) return null;
  return { ...claims, email: u.email, name: u.name, role: u.role, activeOrgId: m.orgId, orgRole: m.orgRole };
}
