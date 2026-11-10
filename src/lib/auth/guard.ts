import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { defaultOrgId } from "@/lib/db/org";
import { authEnabled } from "./roles";
import type { OrgRole } from "./users";

/**
 * The signed-in caller. `orgId` / `orgRole` are the active organization and the caller's role in it
 * (verified against memberships on every request). Authorization uses `orgRole` only; the legacy
 * users.role column plays no part.
 */
export type Actor = { userId: string; email: string; name: string; orgId: string; orgRole: OrgRole };

/** Roles that may approve / release payments and change organization-wide settings. */
export const ADMIN_ROLES: OrgRole[] = ["owner", "admin"];
export const isOrgAdmin = (r: OrgRole) => ADMIN_ROLES.includes(r);

/** The signed-in user, or null. Every call re-validates the JWT (revocation, absolute expiry, membership). */
export async function getActor(): Promise<Actor | null> {
  if (!authEnabled()) {
    return { userId: "auth-disabled", email: "auth-disabled@local", name: "Local (auth off)", orgId: await defaultOrgId(), orgRole: "owner" };
  }
  const s = await auth();
  if (!s?.userId || !s.activeOrgId || !s.user?.email) return null;
  return { userId: s.userId, email: s.user.email, name: s.user.name ?? "", orgId: s.activeOrgId, orgRole: s.orgRole };
}

/** Route-level session check. Returns a 401 response to send, or null when signed in. */
export async function requireSignedIn(): Promise<NextResponse | null> {
  return (await getActor()) ? null : NextResponse.json({ error: "sign in required" }, { status: 401 });
}

/** The actor, or the 401 response to send. */
export type Gate = { actor: Actor; deny?: undefined } | { actor?: undefined; deny: NextResponse };

export async function requireActor(): Promise<Gate> {
  const actor = await getActor();
  return actor ? { actor } : { deny: NextResponse.json({ error: "sign in required" }, { status: 401 }) };
}

/** The actor when their org role is in `allowed`, else the 401 / 403 response to send. */
export async function requireOrgRole(allowed: OrgRole[] = ADMIN_ROLES): Promise<Gate> {
  const r = await requireActor();
  if (r.deny) return r;
  if (!allowed.includes(r.actor.orgRole)) {
    return { deny: NextResponse.json({ error: `requires role: ${allowed.join(" or ")}` }, { status: 403 }) };
  }
  return r;
}
