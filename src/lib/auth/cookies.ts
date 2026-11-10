import { encode } from "next-auth/jwt";
import type { NextResponse } from "next/server";
import { authSecret } from "./secret";
import { initialClaims, SESSION_MAX_AGE_S } from "./token";

const prod = () => process.env.NODE_ENV === "production";

/**
 * In production the cookie uses the __Host- prefix: the browser then insists on Secure, Path=/ and
 * no Domain, so a sibling subdomain can't set or shadow it. (Auth.js's own CSRF cookie is
 * __Host- in production too, via useSecureCookies.)
 */
export const SESSION_COOKIE = prod() ? "__Host-ledgerline_session" : "ledgerline_session";

export const sessionCookieOptions = (maxAge = SESSION_MAX_AGE_S) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: prod(),
  path: "/",
  maxAge,
});

/**
 * Signs a user in without going through the credentials callback: puts a freshly minted Auth.js JWT
 * on `res`. Used by registration and password change, where the caller has just proven who they are.
 */
export async function setSessionCookie(
  res: NextResponse,
  u: { id: string; email: string; name: string; tokenVersion: number },
) {
  const jwt = await encode({
    token: initialClaims(u),
    secret: authSecret(),
    salt: SESSION_COOKIE,
    maxAge: SESSION_MAX_AGE_S,
  });
  res.cookies.set(SESSION_COOKIE, jwt, sessionCookieOptions());
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
}
