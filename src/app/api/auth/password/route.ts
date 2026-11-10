import { NextRequest, NextResponse } from "next/server";
import { passwordProblem } from "@/lib/auth/passwords";
import { attemptFailed, attemptSucceeded, clientIp, lockoutResponse, reserveAttempt, throttleKeys } from "@/lib/auth/rate-limit";
import { changePasswordSchema, readJson, validationError } from "@/lib/auth/schemas";
import { authEnabled, COOKIE, sessionCookieOptions, verifyPassword } from "@/lib/auth/session";
import { createSession, revokeUserSessions } from "@/lib/auth/sessions";
import { findUser, getSession, setPassword } from "@/lib/auth/users";

/**
 * Change your own password. Needs the current one; guesses are counted before checking (same
 * 5-per-15-minutes lockout as sign-in). On success EVERY session of the user is revoked and this
 * browser gets a fresh session id (rotation), so only the caller stays signed in.
 */
export async function POST(req: NextRequest) {
  if (!authEnabled()) return NextResponse.json({ error: "Sign-in is turned off (AUTH_DISABLED=1)" }, { status: 400 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const parsed = changePasswordSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  const { currentPassword, newPassword } = parsed.data;

  const emailKey = `password:email:${session.email}`;
  const reservation = await reserveAttempt(throttleKeys("password", session.email, clientIp(req.headers)));
  if (!reservation.ok) return lockoutResponse(reservation.retryAfterSeconds);

  const user = await findUser(session.email);
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

  await setPassword(user.email, newPassword);
  // Revoke everything (including the current sid), then hand this browser a brand-new session.
  const revoked = await revokeUserSessions(user.email);
  const { token } = await createSession(user, {
    ip: clientIp(req.headers) ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  const res = NextResponse.json({ ok: true, revokedSessions: Math.max(0, revoked - 1) });
  res.cookies.set(COOKIE, token, sessionCookieOptions());
  return res;
}
