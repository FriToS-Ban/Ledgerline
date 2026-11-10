import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { defaultOrgId } from "@/lib/db/org";
import { authEnabled, type Role } from "./roles";
import type { OrgRole } from "./users";

/**
 * The signed-in caller. `orgId` / `orgRole` are the active organization and the caller's role in it
 * (verified against memberships on every request). `role` is the legacy clerk/approver/admin role,
 * still used for approval limits and admin-only routes until org roles replace it.
 */
export type Actor = { userId: string; email: string; name: string; orgId: string; orgRole: OrgRole; role: Role };

/** The signed-in user, or null. Every call re-validates the JWT (revocation, absolute expiry, membership). */
export async function getActor(): Promise<Actor | null> {
  if (!authEnabled()) {
    return { userId: "auth-disabled", email: "auth-disabled@local", name: "Local (auth off)", orgId: await defaultOrgId(), orgRole: "owner", role: "admin" };
  }
  const s = await auth();
  if (!s?.userId || !s.activeOrgId || !s.user?.email) return null;
  return { userId: s.userId, email: s.user.email, name: s.user.name ?? "", orgId: s.activeOrgId, orgRole: s.orgRole, role: s.role };
}

/** Route-level session check. Returns a 401 response to send, or null when signed in. */
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
