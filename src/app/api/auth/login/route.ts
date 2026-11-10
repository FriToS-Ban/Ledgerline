import { NextRequest, NextResponse } from "next/server";
import { attemptFailed, attemptSucceeded, clientIp, lockoutResponse, reserveAttempt, throttleKeys } from "@/lib/auth/rate-limit";
import { loginSchema, readJson, validationError } from "@/lib/auth/schemas";
import { COOKIE, dummyPasswordHash, readToken, sessionCookieOptions, verifyPassword } from "@/lib/auth/session";
import { createSession, revokeSession } from "@/lib/auth/sessions";
import { findUser, normalizeEmail } from "@/lib/auth/users";

const INVALID = "Email or password is incorrect";

export async function POST(req: NextRequest) {
  const parsed = loginSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  const email = normalizeEmail(parsed.data.email);
  const { password } = parsed.data;
  const ip = clientIp(req.headers);
  const emailKey = `login:email:${email}`;

  // Count the attempt BEFORE checking the password, atomically, so parallel guesses can't race past the limit.
  const reservation = await reserveAttempt(throttleKeys("login", email, ip));
  if (!reservation.ok) return lockoutResponse(reservation.retryAfterSeconds);

  const user = await findUser(email);
  // Always run scrypt once, so an unknown email takes as long as a wrong password.
  const ok = (await verifyPassword(password, user?.hash ?? (await dummyPasswordHash()))) && !!user;
  if (!ok || !user) {
    const lockedNow = await attemptFailed(reservation);
    if (lockedNow) return lockoutResponse(lockedNow);
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  await attemptSucceeded(reservation, [emailKey]);
  // Signing in again replaces (revokes) whatever session this browser had.
  const previous = readToken(req.cookies.get(COOKIE)?.value)?.sid;
  if (previous) await revokeSession(previous);
  const { token } = await createSession(user, { ip: ip ?? undefined, userAgent: req.headers.get("user-agent") ?? undefined });
  const res = NextResponse.json({ user: { email: user.email, name: user.name, role: user.role } });
  res.cookies.set(COOKIE, token, sessionCookieOptions());
  return res;
}
