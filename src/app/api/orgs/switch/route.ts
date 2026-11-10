import { NextRequest, NextResponse } from "next/server";
import { isRealUser, noRealUser, setActiveOrg } from "@/lib/auth/active-org";
import { requireActor } from "@/lib/auth/guard";
import { readJson } from "@/lib/auth/schemas";
import { membershipFor } from "@/lib/auth/users";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `{ orgId }` makes that workspace active, but only when the caller is a member (checked here and again in the jwt callback). */
export async function POST(req: NextRequest) {
  const g = await requireActor();
  if (g.deny) return g.deny;
  if (!isRealUser(g.actor)) return noRealUser();
  const { orgId } = (await readJson(req)) as { orgId?: unknown };
  const m = typeof orgId === "string" && UUID.test(orgId) ? await membershipFor(g.actor.userId, orgId) : null;
  if (!m) return NextResponse.json({ error: "You are not a member of that workspace." }, { status: 403 });
  await setActiveOrg(m.orgId);
  return NextResponse.json({ ok: true, orgId: m.orgId, role: m.orgRole });
}
