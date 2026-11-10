import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

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
