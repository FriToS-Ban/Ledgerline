import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

let cached: string | null = null;

/** Where the generated development secret lives (gitignored via /data/*.secret). */
export const devSecretPath = () => path.join(process.cwd(), "data", "auth.secret");

/**
 * The HMAC key for session cookies.
 * - AUTH_SECRET wins when set (required in production, at least 32 characters).
 * - Otherwise (development / tests) a random 32-byte secret is generated once and persisted to
 *   data/auth.secret so sessions survive restarts. There is no hardcoded fallback.
 */
export function authSecret(): string {
  if (cached) return cached;
  const env = process.env.AUTH_SECRET?.trim();
  if (env) {
    if (process.env.NODE_ENV === "production" && env.length < 32) {
      throw new Error("AUTH_SECRET must be at least 32 characters in production");
    }
    return (cached = env);
  }
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set in production");
  const file = devSecretPath();
  let existing: string | null = null;
  try {
    existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 32) return (cached = existing);
  } catch {
    /* not created yet */
  }
  const fresh = randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    // A file that exists but is too short (truncated / hand-edited) is replaced ("w").
    // A missing file is created with "wx" so two processes racing on first start don't clobber each other.
    fs.writeFileSync(file, fresh, { mode: 0o600, flag: existing === null ? "wx" : "w" });
    return (cached = fresh);
  } catch {
    const raced = fs.readFileSync(file, "utf8").trim();
    if (raced.length < 32) throw new Error(`${file} holds a secret shorter than 32 characters; delete it and restart`);
    return (cached = raced);
  }
}

/** Constant-time string comparison (over sha256 digests, so differing lengths leak nothing). */
export function secretsEqual(given: string | null | undefined, expected: string): boolean {
  const d = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(d(given ?? ""), d(expected)) && given != null && expected.length > 0;
}

/** Test hook: forget the cached secret. */
export function resetAuthSecretCache() {
  cached = null;
}
