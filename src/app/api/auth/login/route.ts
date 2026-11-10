import { NextRequest, NextResponse } from "next/server";
import { clearFailures, clientIp, lockedFor, lockoutMessage, recordFailure, throttleKeys } from "@/lib/auth/rate-limit";
import { loginSchema, readJson, validationError } from "@/lib/auth/schemas";
import { COOKIE, dummyPasswordHash, sessionCookieOptions, verifyPassword } from "@/lib/auth/session";
import { createSession } from "@/lib/auth/sessions";
import { findUser, normalizeEmail } from "@/lib/auth/users";

const INVALID = "Email or password is incorrect";

function locked(seconds: number) {
  return NextResponse.json(
    { error: lockoutMessage(seconds), retryAfterSeconds: seconds },
    { status: 429, headers: { "retry-after": String(seconds) } },
  );
}

export async function POST(req: NextRequest) {
  const parsed = loginSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  const email = normalizeEmail(parsed.data.email);
  const { password } = parsed.data;
  const ip = clientIp(req.headers);
  const keys = throttleKeys("login", email, ip);

  const wait = await lockedFor(keys);
  if (wait) return locked(wait);

  const user = await findUser(email);
  // Always run scrypt once, so an unknown email takes as long as a wrong password.
  const ok = verifyPassword(password, user?.hash ?? dummyPasswordHash()) && !!user;
  if (!ok || !user) {
    const lockedNow = await recordFailure(keys);
    if (lockedNow) return locked(lockedNow);
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  await clearFailures(keys.slice(0, 1)); // the email key; the IP key decays on its own
  const { token } = await createSession(user, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
  const res = NextResponse.json({ user: { email: user.email, name: user.name, role: user.role } });
  res.cookies.set(COOKIE, token, sessionCookieOptions());
  return res;
}
