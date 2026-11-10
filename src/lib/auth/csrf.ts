import { trustProxy } from "./net";

/**
 * CSRF guard for cookie-authenticated API calls. Edge/Node agnostic (only uses Headers + URL).
 *
 * A mutating request (anything but GET/HEAD/OPTIONS) is allowed when:
 *  - its Origin header matches the request's own Host (X-Forwarded-Host/-Proto only with
 *    TRUST_PROXY=1) or exactly equals an origin listed in APP_ORIGINS, or
 *  - it has no Origin but its Referer is same-host, or
 *  - it carries neither and no Sec-Fetch-Site other than same-origin/none (a non-browser client
 *    such as curl or a server job; browsers always send Origin on cross-site POST/PUT/PATCH/DELETE).
 * Webhook routes that authenticate with their own shared secret are exempt.
 */
export const CSRF_EXEMPT = [/^\/api\/intake\/email\/?$/, /^\/api\/inngest(\/|$)/];
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export const isCsrfExempt = (pathname: string) => CSRF_EXEMPT.some((r) => r.test(pathname));

/** True when `url` is this app: an exact APP_ORIGINS entry (scheme+host+port), or the request's own host. */
function isSelf(url: string | null, h: Headers): boolean {
  if (!url || url === "null") return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  for (const o of (process.env.APP_ORIGINS ?? "").split(",")) {
    try {
      if (o.trim() && new URL(o.trim()).origin === u.origin) return true;
    } catch {
      /* ignore malformed entries */
    }
  }
  // X-Forwarded-Host / -Proto are client-writable unless a trusted proxy sets them.
  const host = (trustProxy() && h.get("x-forwarded-host")?.split(",")[0]?.trim()) || h.get("host");
  if (!host || u.host.toLowerCase() !== host.toLowerCase()) return false;
  const proto = trustProxy() ? h.get("x-forwarded-proto")?.split(",")[0]?.trim() : null;
  return !proto || u.protocol === `${proto.toLowerCase()}:`;
}

/** Returns a reason string when the request must be rejected, else null. */
export function csrfProblem(method: string, pathname: string, h: Headers): string | null {
  if (SAFE.has(method.toUpperCase()) || isCsrfExempt(pathname)) return null;
  const origin = h.get("origin");
  if (origin) return isSelf(origin, h) ? null : "cross-origin request blocked";
  const referer = h.get("referer");
  if (referer) return isSelf(referer, h) ? null : "cross-origin request blocked";
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "cross-origin request blocked";
  return null;
}
