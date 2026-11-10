import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { csrfProblem, isCsrfExempt } from "@/lib/auth/csrf";
import { authEnabled } from "@/lib/auth/roles";

/**
 * The gate in front of every page and API route. It wraps Auth.js's `auth`, which decodes the JWT
 * cookie and runs the `jwt` callback (lib/auth/token.ts): a revoked token (stale tokenVersion),
 * a deleted user or a session past its absolute lifetime therefore comes back as "signed out" here
 * and on the very next request, not only inside route handlers (which re-check through guard.ts).
 *
 * It also rejects cross-origin mutating API requests (CSRF) before anything else, except for the
 * webhook routes that authenticate with their own shared secret. Auth.js additionally protects its
 * own sign-in/sign-out routes with a CSRF token.
 */

// Pages and APIs reachable without a session. /api/auth/* here is Auth.js's own surface
// (session, csrf, providers, signin, callback, signout, error) plus register and me; password,
// users and signout-everywhere are NOT listed, so they require a session.
const OPEN = [
  /^\/login(\/|$)/,
  /^\/register(\/|$)/,
  /^\/invite\/[^/]+\/?$/,
  /^\/api\/invites\/preview\/?$/,
  /^\/api\/auth\/(register|me|session|csrf|providers|signin|signout|callback|error)(\/|$)/,
];

const gate = auth((req) => {
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

  if (!req.auth?.userId) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "sign in required" }, { status: 401 });
    const url = new URL("/login", req.url);
    url.search = "";
    url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return next();
});

type Gate = (req: NextRequest, ev: NextFetchEvent) => Promise<Response | undefined>;

/**
 * With a lazily built Auth.js config (our `NextAuth(() => ...)`), `auth(handler)` returns a Promise
 * of the wrapped handler rather than the handler itself (the types say otherwise), so resolve it
 * here; awaiting a plain function, should a future version return one, is harmless.
 */
export async function proxy(req: NextRequest, ev: NextFetchEvent) {
  return ((await gate) as unknown as Gate)(req, ev);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|demos/).*)"],
};
