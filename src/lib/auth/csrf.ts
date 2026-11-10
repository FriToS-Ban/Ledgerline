/**
 * CSRF guard for cookie-authenticated API calls. Edge/Node agnostic (only uses Headers + URL).
 *
 * A mutating request (anything but GET/HEAD/OPTIONS) is allowed when:
 *  - its Origin header matches the request's own host (or an entry in APP_ORIGINS), or
 *  - it has no Origin but its Referer is same-host, or
 *  - it carries neither and no Sec-Fetch-Site other than same-origin/none (a non-browser client
 *    such as curl or a server job; browsers always send Origin on cross-site POST/PUT/PATCH/DELETE).
 * Webhook routes that authenticate with their own shared secret are exempt.
 */
export const CSRF_EXEMPT = [/^\/api\/intake\/email\/?$/, /^\/api\/inngest(\/|$)/];
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export const isCsrfExempt = (pathname: string) => CSRF_EXEMPT.some((r) => r.test(pathname));

function allowedHosts(h: Headers): Set<string> {
  const hosts = new Set<string>();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host");
  if (host) hosts.add(host.toLowerCase());
  for (const o of (process.env.APP_ORIGINS ?? "").split(",")) {
    try {
      if (o.trim()) hosts.add(new URL(o.trim()).host.toLowerCase());
    } catch {
      /* ignore malformed entries */
    }
  }
  return hosts;
}

function hostOf(url: string | null): string | null {
  if (!url || url === "null") return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Returns a reason string when the request must be rejected, else null. */
export function csrfProblem(method: string, pathname: string, h: Headers): string | null {
  if (SAFE.has(method.toUpperCase()) || isCsrfExempt(pathname)) return null;
  const hosts = allowedHosts(h);
  const origin = h.get("origin");
  if (origin) {
    const oh = hostOf(origin);
    return oh && hosts.has(oh) ? null : "cross-origin request blocked";
  }
  const referer = h.get("referer");
  if (referer) {
    const rh = hostOf(referer);
    return rh && hosts.has(rh) ? null : "cross-origin request blocked";
  }
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "cross-origin request blocked";
  return null;
}
