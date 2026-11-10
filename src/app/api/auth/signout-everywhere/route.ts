import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/cookies";
import { getActor } from "@/lib/auth/guard";
import { bumpTokenVersion } from "@/lib/auth/users";

/**
 * "Sign out everywhere": bumps users.token_version, so every JWT this user holds (this browser
 * included) fails the next jwt-callback check, and clears this browser's cookie.
 */
export async function POST() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  if (actor.userId === "auth-disabled") return NextResponse.json({ error: "Sign-in is turned off (AUTH_DISABLED=1)" }, { status: 400 });
  await bumpTokenVersion(actor.userId);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
