import { NextRequest, NextResponse } from "next/server";
import { passwordProblem } from "@/lib/auth/passwords";
import { clearFailures, clientIp, lockedFor, lockoutMessage, recordFailure } from "@/lib/auth/rate-limit";
import { changePasswordSchema, readJson, validationError } from "@/lib/auth/schemas";
import { authEnabled, verifyPassword } from "@/lib/auth/session";
import { revokeUserSessions } from "@/lib/auth/sessions";
import { findUser, getSession, setPassword } from "@/lib/auth/users";

/**
 * Change your own password. Needs the current one; wrong guesses count toward the same
 * 5-per-15-minutes lockout as sign-in. On success every OTHER session of the user is revoked.
 */
export async function POST(req: NextRequest) {
  if (!authEnabled()) return NextResponse.json({ error: "Sign-in is turned off (AUTH_DISABLED=1)" }, { status: 400 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const parsed = changePasswordSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  const { currentPassword, newPassword } = parsed.data;

  const keys = [`password:email:${session.email}`, `password:ip:${clientIp(req.headers)}`];
  const wait = await lockedFor(keys);
  if (wait) {
    return NextResponse.json(
      { error: lockoutMessage(wait), retryAfterSeconds: wait },
      { status: 429, headers: { "retry-after": String(wait) } },
    );
  }

  const user = await findUser(session.email);
  if (!user || !verifyPassword(currentPassword, user.hash)) {
    const lockedNow = await recordFailure(keys);
    if (lockedNow) {
      return NextResponse.json(
        { error: lockoutMessage(lockedNow), retryAfterSeconds: lockedNow },
        { status: 429, headers: { "retry-after": String(lockedNow) } },
      );
    }
    const msg = "Current password is incorrect.";
    return NextResponse.json({ error: msg, fields: { currentPassword: msg } }, { status: 400 });
  }
  await clearFailures(keys.slice(0, 1));

  const problem =
    newPassword === currentPassword
      ? "Choose a password different from your current one."
      : passwordProblem(newPassword, { email: user.email, name: user.name });
  if (problem) return NextResponse.json({ error: problem, fields: { newPassword: problem } }, { status: 400 });

  await setPassword(user.email, newPassword);
  const revokedSessions = await revokeUserSessions(user.email, session.sid);
  return NextResponse.json({ ok: true, revokedSessions });
}
