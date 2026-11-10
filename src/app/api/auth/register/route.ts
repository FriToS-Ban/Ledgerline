import { NextRequest, NextResponse } from "next/server";
import { clientIp, lockedFor, lockoutMessage, recordFailure } from "@/lib/auth/rate-limit";
import { readJson, registerSchema, validationError } from "@/lib/auth/schemas";
import { COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { createSession } from "@/lib/auth/sessions";
import { createUser, isDemoEmail, roleForNewUser } from "@/lib/auth/users";

/**
 * Self sign-up. Creates a `clerk` (or the first admin when the email equals BOOTSTRAP_ADMIN_EMAIL
 * and no admin exists yet) and signs them in. Every well-formed attempt counts against a per-IP
 * budget (5 per 15 minutes) so the endpoint can't be used to mass-create accounts or probe emails.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const keys = [`register:ip:${ip}`];
  const wait = await lockedFor(keys);
  if (wait) {
    return NextResponse.json(
      { error: lockoutMessage(wait), retryAfterSeconds: wait },
      { status: 429, headers: { "retry-after": String(wait) } },
    );
  }
  const parsed = registerSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  // Every well-formed attempt counts (successful or not): 5 per IP per 15 minutes.
  await recordFailure(keys);
  const { email, name, password } = parsed.data;
  if (isDemoEmail(email)) {
    return NextResponse.json({ error: "That email domain is reserved.", fields: { email: "That email domain is reserved." } }, { status: 400 });
  }

  const user = await createUser({ email, name, password, role: await roleForNewUser(email) });
  if (!user) {
    const msg = "An account with this email already exists. Sign in instead.";
    return NextResponse.json({ error: msg, fields: { email: msg } }, { status: 409 });
  }
  const { token } = await createSession(user, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
  const res = NextResponse.json({ user }, { status: 201 });
  res.cookies.set(COOKIE, token, sessionCookieOptions());
  return res;
}
