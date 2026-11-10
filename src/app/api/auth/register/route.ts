import { NextRequest, NextResponse } from "next/server";
import { clientIp, lockoutResponse, reserveAttempt, throttleKeys } from "@/lib/auth/rate-limit";
import { readJson, registerSchema, validationError } from "@/lib/auth/schemas";
import { COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { createSession } from "@/lib/auth/sessions";
import { bootstrapTokenAccepted, createUser, isDemoEmail } from "@/lib/auth/users";

/**
 * Self sign-up. Creates a `clerk` and signs them in. With a valid `bootstrapToken`
 * (== BOOTSTRAP_ADMIN_TOKEN, compared in constant time) while no real admin exists, it creates
 * the first admin instead. Every well-formed attempt counts (never refunded) against a budget of
 * 5 per 15 minutes per email and, when TRUST_PROXY=1, per client IP.
 */
export async function POST(req: NextRequest) {
  const parsed = registerSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  const { email, name, password, bootstrapToken } = parsed.data;

  const reservation = await reserveAttempt(throttleKeys("register", email, clientIp(req.headers)));
  if (!reservation.ok) return lockoutResponse(reservation.retryAfterSeconds);

  if (isDemoEmail(email)) {
    return NextResponse.json({ error: "That email domain is reserved.", fields: { email: "That email domain is reserved." } }, { status: 400 });
  }

  let role: "clerk" | "admin" = "clerk";
  if (bootstrapToken !== undefined && bootstrapToken !== "") {
    if (!(await bootstrapTokenAccepted(bootstrapToken))) {
      const msg = "Setup token is not valid, or an admin already exists.";
      return NextResponse.json({ error: msg, fields: { bootstrapToken: msg } }, { status: 403 });
    }
    role = "admin";
  }

  const user = await createUser({ email, name, password, role });
  if (!user) {
    const msg = "An account with this email already exists. Sign in instead.";
    return NextResponse.json({ error: msg, fields: { email: msg } }, { status: 409 });
  }
  const { token } = await createSession(user, {
    ip: clientIp(req.headers) ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  const res = NextResponse.json({ user }, { status: 201 });
  res.cookies.set(COOKIE, token, sessionCookieOptions());
  return res;
}
