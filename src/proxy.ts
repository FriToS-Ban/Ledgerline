import { NextResponse, type NextRequest } from "next/server";
import { csrfProblem, isCsrfExempt } from "@/lib/auth/csrf";
import { authEnabled, COOKIE, readToken } from "@/lib/auth/session";

/**
 * The gate in front of every page and API route. Deliberately DB-free: it checks only that the
 * session cookie is present, HMAC-signed with AUTH_SECRET and not past its absolute expiry, and
 * redirects/401s otherwise. The authoritative check (session row exists, not revoked, not idle,
 * current role from the users table) happens in getActor() inside each route, so revocation and
 * role changes take effect on the very next request.
 *
 * It also rejects cross-origin mutating API requests (CSRF), except for the webhook routes that
 * authenticate with their own shared secret.
 */

// Pages and APIs reachable without a session.
const OPEN = [
  /^\/login(\/|$)/,
  /^\/register(\/|$)/,
  /^\/api\/auth\/(login|register|logout|me)$/,
];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Identity is never taken from request headers; strip legacy ones anyway so nothing can rely on them.
  const forward = new Headers(req.headers);
  for (const h of ["x-user-email", "x-user-role", "x-user-name"]) forward.delete(h);
  const next = () => NextResponse.next({ request: { headers: forward } });

  if (pathname.startsWith("/api/")) {
    const bad = csrfProblem(req.method, pathname, req.headers);
    if (bad) return NextResponse.json({ error: bad }, { status: 403 });
  }

  if (!authEnabled() || isCsrfExempt(pathname) || OPEN.some((r) => r.test(pathname))) return next();

  // `sid` is required: cookies minted before DB sessions existed carry none and are refused.
  if (!readToken(req.cookies.get(COOKIE)?.value)?.sid) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "sign in required" }, { status: 401 });
    const url = new URL("/login", req.url);
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|demos/).*)"],
};
