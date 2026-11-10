import { NextRequest, NextResponse } from "next/server";
import { isRealUser, noRealUser, setActiveOrg } from "@/lib/auth/active-org";
import { requireActor } from "@/lib/auth/guard";
import { acceptInvite, INVALID_INVITE } from "@/lib/auth/orgs";
import { attemptSucceeded, clientIp, lockoutResponse, reserveAttempt, throttleKeys } from "@/lib/auth/rate-limit";
import { readJson } from "@/lib/auth/schemas";

/** Signed in: `{ token }` joins the inviting workspace with the invited role and makes it active. */
export async function POST(req: NextRequest) {
  const g = await requireActor();
  if (g.deny) return g.deny;
  if (!isRealUser(g.actor)) return noRealUser();
  const { token } = (await readJson(req)) as { token?: unknown };
  if (typeof token !== "string" || token.length < 20 || token.length > 200) {
    return NextResponse.json({ error: INVALID_INVITE }, { status: 404 });
  }
  const reservation = await reserveAttempt(throttleKeys("invite", g.actor.email, clientIp(req.headers)));
  if (!reservation.ok) return lockoutResponse(reservation.retryAfterSeconds);
  const r = await acceptInvite({ id: g.actor.userId, email: g.actor.email }, token);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  await attemptSucceeded(reservation);
  await setActiveOrg(r.orgId);
  return NextResponse.json({ ok: true, orgId: r.orgId, orgName: r.orgName });
}
