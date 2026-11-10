import { NextResponse } from "next/server";
import { unstable_update } from "@/auth";
import type { Actor } from "./guard";

/** Org management needs a real signed-in user (the AUTH_DISABLED dev actor has no users row). */
export const isRealUser = (a: Actor) => a.userId !== "auth-disabled";

export const noRealUser = () => NextResponse.json({ error: "Workspaces are unavailable while sign-in is turned off." }, { status: 400 });

/**
 * Re-issues the session cookie with `orgId` as the active org. The request is client-influenced, so
 * refreshClaims() re-verifies the membership inside the jwt callback; callers check it as well so a
 * non-member gets a 403 rather than a silent no-op.
 */
export async function setActiveOrg(orgId: string) {
  await unstable_update({ activeOrgId: orgId });
}
