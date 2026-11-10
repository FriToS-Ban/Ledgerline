import { NextResponse } from "next/server";
import { demoUsersEnabled, getActor } from "@/lib/auth/users";

/** Open route: `user` is null when not signed in (or the session was revoked/expired). */
export async function GET() {
  return NextResponse.json(
    { user: await getActor(), demoAccounts: demoUsersEnabled() },
    { headers: { "cache-control": "no-store" } },
  );
}
