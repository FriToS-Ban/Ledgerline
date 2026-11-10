import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth/cookies";
import { clientIp, lockoutResponse, reserveAttempt, throttleKeys } from "@/lib/auth/rate-limit";
import { readJson, registerSchema, validationError } from "@/lib/auth/schemas";
import { createUser, findInvite, isDemoEmail } from "@/lib/auth/users";

/**
 * Self sign-up. Creates a `clerk` with a personal organization (owner membership) and signs them
 * in. With a valid `inviteToken` for exactly this email it joins the inviting organization instead.
 * Every well-formed attempt counts (never refunded)
 * against a budget of 5 per 15 minutes per email and, when TRUST_PROXY=1, per client IP.
 */
export async function POST(req: NextRequest) {
  const parsed = registerSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  const { email, name, password, inviteToken } = parsed.data;

  const reservation = await reserveAttempt(throttleKeys("register", email, clientIp(req.headers)));
  if (!reservation.ok) return lockoutResponse(reservation.retryAfterSeconds);

  if (isDemoEmail(email)) {
    return NextResponse.json({ error: "That email domain is reserved.", fields: { email: "That email domain is reserved." } }, { status: 400 });
  }

  let invite;
  if (inviteToken) {
    invite = (await findInvite(inviteToken, email)) ?? undefined;
    if (!invite) {
      const msg = "That invite is not valid, has expired, or was sent to a different email.";
      return NextResponse.json({ error: msg, fields: { inviteToken: msg } }, { status: 403 });
    }
  }

  const user = await createUser({ email, name, password, role: "clerk", invite });
  if (!user) {
    const msg = "An account with this email already exists. Sign in instead.";
    return NextResponse.json({ error: msg, fields: { email: msg } }, { status: 409 });
  }
  const res = NextResponse.json({ user: { email: user.email, name: user.name, role: user.role } }, { status: 201 });
  await setSessionCookie(res, user);
  return res;
}
