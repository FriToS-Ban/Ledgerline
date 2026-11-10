/**
 * Proxy trust. Headers like X-Forwarded-For / X-Forwarded-Host / X-Real-IP are written by the
 * client unless a reverse proxy in front of the app overwrites or appends them, so they are only
 * believed when TRUST_PROXY=1. Edge/Node agnostic.
 */
export const trustProxy = () => process.env.TRUST_PROXY === "1";

/** How many proxies append to X-Forwarded-For in front of the app (TRUSTED_PROXY_HOPS, default 1). */
function proxyHops() {
  const n = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * The client IP, or null when it can't be trusted. With TRUST_PROXY=1: X-Real-IP if the platform
 * sets it, else the entry `hops` places from the RIGHT of X-Forwarded-For (proxies append, so the
 * left-most entries are client-written). Without it: null, and callers skip per-IP limits instead
 * of lumping every client into one shared bucket.
 */
export function clientIp(h: Headers): string | null {
  if (!trustProxy()) return null;
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const chain = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return chain.length ? chain[Math.max(0, chain.length - proxyHops())] : null;
}
