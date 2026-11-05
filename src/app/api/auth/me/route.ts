import { NextResponse } from "next/server";
import { demoUsersEnabled, getActor } from "@/lib/auth/users";

export async function GET() {
  return NextResponse.json({ user: await getActor(), demoAccounts: demoUsersEnabled() });
}
