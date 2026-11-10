import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth/cookies";
import { getActor } from "@/lib/auth/guard";
import { verifyPassword } from "@/lib/auth/hash";
import { passwordProblem } from "@/lib/auth/passwords";
import { attemptFailed, attemptSucceeded, clientIp, lockoutResponse, reserveAttempt, throttleKeys } from "@/lib/auth/rate-limit";
import { authEnabled } from "@/lib/auth/roles";
import { changePasswordSchema, readJson, validationError } from "@/lib/auth/schemas";
import { findUser, setPassword } from "@/lib/auth/users";

/**
 * Change your own password. Needs the current one; guesses are counted before checking (same
 * 5-per-15-minutes lockout as sign-in). On success users.token_version is bumped, which kills EVERY
 * JWT of the user (other devices), and this browser is handed a freshly minted one, so only the
 * caller stays signed in.
 */
export async function POST(req: NextRequest) {
  if (!authEnabled()) return NextResponse.json({ error: "Sign-in is turned off (AUTH_DISABLED=1)" }, { status: 400 });
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const parsed = changePasswordSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  const { currentPassword, newPassword } = parsed.data;

  const emailKey = `password:email:${actor.email}`;
  const reservation = await reserveAttempt(throttleKeys("password", actor.email, clientIp(req.headers)));
  if (!reservation.ok) return lockoutResponse(reservation.retryAfterSeconds);

  const user = await findUser(actor.email);
  if (!user || !(await verifyPassword(currentPassword, user.hash))) {
    const lockedNow = await attemptFailed(reservation);
    if (lockedNow) return lockoutResponse(lockedNow);
    const msg = "Current password is incorrect.";
    return NextResponse.json({ error: msg, fields: { currentPassword: msg } }, { status: 400 });
  }
  await attemptSucceeded(reservation, [emailKey]);

  const problem =
    newPassword === currentPassword
      ? "Choose a password different from your current one."
      : passwordProblem(newPassword, { email: user.email, name: user.name });
  if (problem) return NextResponse.json({ error: problem, fields: { newPassword: problem } }, { status: 400 });

  const tokenVersion = await setPassword(user.email, newPassword);
  const res = NextResponse.json({ ok: true });
  await setSessionCookie(res, { ...user, tokenVersion });
  return res;
}
