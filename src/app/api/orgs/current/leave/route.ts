import { NextResponse } from "next/server";
import { isRealUser, noRealUser } from "@/lib/auth/active-org";
import { requireActor } from "@/lib/auth/guard";
import { leaveOrg } from "@/lib/auth/orgs";

/** Leave the active workspace. The last owner cannot leave (409). */
export async function POST() {
  const g = await requireActor();
  if (g.deny) return g.deny;
  if (!isRealUser(g.actor)) return noRealUser();
  const r = await leaveOrg(g.actor.orgId, g.actor.userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
