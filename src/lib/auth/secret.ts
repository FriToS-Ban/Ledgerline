import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

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
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 32) return (cached = existing);
  } catch {
    /* not created yet */
  }
  const fresh = randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    // "wx" so two processes racing on first start don't clobber each other.
    fs.writeFileSync(file, fresh, { mode: 0o600, flag: "wx" });
    return (cached = fresh);
  } catch {
    return (cached = fs.readFileSync(file, "utf8").trim());
  }
}

/** Test hook: forget the cached secret. */
export function resetAuthSecretCache() {
  cached = null;
}
