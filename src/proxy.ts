import { NextResponse, type NextRequest } from "next/server";
import { authEnabled, COOKIE, readToken } from "@/lib/auth/session";

// Routes that authenticate themselves (webhook secret) or must stay open.
const OPEN = [/^\/login/, /^\/api\/auth\//, /^\/api\/intake\/email$/, /^\/api\/inngest/];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Never trust identity headers that arrive from the client.
  const forward = new Headers(req.headers);
  for (const h of ["x-user-email", "x-user-role", "x-user-name"]) forward.delete(h);

  if (!authEnabled() || OPEN.some((r) => r.test(pathname))) {
    return NextResponse.next({ request: { headers: forward } });
  }

  const session = readToken(req.cookies.get(COOKIE)?.value);
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "sign in required" }, { status: 401 });
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  forward.set("x-user-email", session.email);
  forward.set("x-user-role", session.role);
  forward.set("x-user-name", session.name);
  return NextResponse.next({ request: { headers: forward } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|demos/).*)"],
};
