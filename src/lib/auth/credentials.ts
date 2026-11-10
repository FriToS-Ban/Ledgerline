import { attemptFailed, attemptSucceeded, reserveAttempt, throttleKeys } from "./rate-limit";
import { dummyPasswordHash, verifyPassword } from "./hash";
import { loginSchema } from "./schemas";
import { ensureMembership, findUser, normalizeEmail, type UserRecord } from "./users";

export const INVALID_CREDENTIALS = "Email or password is incorrect";

export type AuthResult =
  | { ok: true; user: UserRecord }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; retryAfterSeconds: number };

/**
 * The whole password sign-in decision, independent of Auth.js so it can be tested directly.
 * Count first, verify second: the attempt is reserved atomically BEFORE the password is checked, so
 * parallel guesses can't race past the 5-per-15-minutes limit (the 5th failure itself reports locked).
 * An unknown email costs the same scrypt work as a wrong password.
 */
export async function authenticate(raw: unknown, ip: string | null): Promise<AuthResult> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const email = normalizeEmail(parsed.data.email);
  const reservation = await reserveAttempt(throttleKeys("login", email, ip));
  if (!reservation.ok) return { ok: false, reason: "locked", retryAfterSeconds: reservation.retryAfterSeconds };

  const user = await findUser(email);
  const ok = (await verifyPassword(parsed.data.password, user?.hash ?? (await dummyPasswordHash()))) && !!user;
  if (!ok || !user) {
    const lockedNow = await attemptFailed(reservation);
    return lockedNow ? { ok: false, reason: "locked", retryAfterSeconds: lockedNow } : { ok: false, reason: "invalid" };
  }
  await attemptSucceeded(reservation, [`login:email:${email}`]);
  await ensureMembership(user.id, user.name || user.email);
  return { ok: true, user };
}
