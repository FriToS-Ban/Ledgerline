import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type Role = "clerk" | "approver" | "admin";
export type Session = { email: string; name: string; role: Role; exp: number };

export const COOKIE = "ledgerline_session";
const TTL_MS = 8 * 60 * 60 * 1000;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set in production");
  return s ?? "dev-only-secret-change-me";
}

export const authEnabled = () => process.env.AUTH_DISABLED === "1" ? false : true;

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(pw, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export function createToken(u: { email: string; name: string; role: Role }) {
  const body = b64(JSON.stringify({ ...u, exp: Date.now() + TTL_MS } satisfies Session));
  return `${body}.${sign(body)}`;
}

export function readToken(token: string | undefined | null): Session | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

/** Dollar ceiling a role may approve without a more senior person. */
export const DEFAULT_LIMITS: Record<Role, number> = { clerk: 5_000, approver: 100_000, admin: Infinity };
