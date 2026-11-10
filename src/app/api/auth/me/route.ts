import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/guard";
import { demoUsersEnabled } from "@/lib/auth/users";

/** Open route: `user` is null when not signed in (or the session was revoked/expired). */
export async function GET() {
  const a = await getActor();
  return NextResponse.json(
    {
      user: a && { email: a.email, name: a.name, role: a.role, orgId: a.orgId, orgRole: a.orgRole },
      demoAccounts: demoUsersEnabled(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
