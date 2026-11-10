import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { authSecret } from "./secret";

export type Role = "clerk" | "approver" | "admin";
export const ROLES: Role[] = ["clerk", "approver", "admin"];
export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as string[]).includes(v);

/** What the signed cookie carries. `sid` is the random session id; the DB stores only its sha256. */
export type Session = { sid?: string; email: string; name: string; role: Role; exp: number };

/**
 * In production the cookie uses the __Host- prefix: the browser then insists on Secure, Path=/ and
 * no Domain, so a sibling subdomain can't set or shadow it.
 */
export const COOKIE = process.env.NODE_ENV === "production" ? "__Host-ledgerline_session" : "ledgerline_session";
/** Absolute lifetime of a session, from sign-in. */
export const ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;
/** Idle timeout: a session unused for this long is dead (sliding window, tracked in the DB). */
export const IDLE_TTL_MS = 2 * 60 * 60 * 1000;

/** AUTH_DISABLED=1 turns sign-in off (everyone is admin). Refused outright in production. */
export function authEnabled() {
  if (process.env.AUTH_DISABLED !== "1") return true;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_DISABLED=1 is not allowed in production");
  return false;
}

export { MAX_PASSWORD_LENGTH } from "./passwords";

// Async scrypt runs on the libuv threadpool, so password hashing never blocks the event loop.
const scryptAsync = promisify(scrypt) as (pw: string, salt: string, keylen: number) => Promise<Buffer>;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await scryptAsync(pw, salt, 32)).toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = await scryptAsync(pw, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

let dummy: Promise<string> | null = null;
/** A real hash of nothing in particular, so an unknown email costs the same scrypt work as a wrong password. */
export function dummyPasswordHash(): Promise<string> {
  return (dummy ??= hashPassword(randomBytes(16).toString("hex")));
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string) => createHmac("sha256", authSecret()).update(body).digest("base64url");

/** A fresh random session id (32 bytes) for the cookie. */
export const newSessionId = () => randomBytes(32).toString("base64url");
/** What the sessions table stores: never the raw id. */
export const hashSessionId = (sid: string) => createHash("sha256").update(sid).digest("hex");

export function createToken(u: { email: string; name: string; role: Role; sid?: string }, exp = Date.now() + ABSOLUTE_TTL_MS) {
  const body = b64(JSON.stringify({ sid: u.sid, email: u.email, name: u.name, role: u.role, exp } satisfies Session));
  return `${body}.${sign(body)}`;
}

/** Checks signature and expiry only (no DB): cheap enough for proxy.ts. getActor() does the DB check. */
export function readToken(token: string | undefined | null): Session | null {
  if (!token || token.length > 4096) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    return typeof s.exp === "number" && s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds = ABSOLUTE_TTL_MS / 1000) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Dollar ceiling a role may approve without a more senior person. */
export const DEFAULT_LIMITS: Record<Role, number> = { clerk: 5_000, approver: 100_000, admin: Infinity };
