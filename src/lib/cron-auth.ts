import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { secretsEqual } from "@/lib/auth/secret";

/**
 * Who may trigger the scheduled worker (/api/cron/tick):
 *  1. a GitHub Actions OIDC token from this repository's cron workflow on main: no shared secret
 *     to store or leak; GitHub signs a short-lived JWT per run and we check it against GitHub's
 *     published keys, or
 *  2. `Authorization: Bearer $CRON_SECRET` (>= 24 chars), e.g. for Vercel Cron or another scheduler.
 */

export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;

export function cronOidcConfig() {
  const repository = process.env.CRON_GITHUB_REPOSITORY || "FriToS-Ban/Ledgerline";
  return {
    repository,
    audience: process.env.CRON_OIDC_AUDIENCE || "ledgerline-cron",
    workflowRef: `${repository}/.github/workflows/cron.yml@refs/heads/main`,
  };
}

type Jwks = { keys: (JsonWebKey & { kid?: string })[] };
let jwksCache: { at: number; jwks: Jwks } | null = null;

async function githubKeys(force = false): Promise<Jwks> {
  if (!force && jwksCache && Date.now() - jwksCache.at < 60 * 60_000) return jwksCache.jwks;
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`GitHub JWKS answered ${res.status}`);
  const jwks = (await res.json()) as Jwks;
  jwksCache = { at: Date.now(), jwks };
  return jwks;
}

/** Test hook. */
export function resetJwksCache() {
  jwksCache = null;
}

const b64json = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

export type OidcResult = { ok: true; claims: Record<string, unknown> } | { ok: false; reason: string };

export async function verifyGithubOidc(token: string, now = Date.now()): Promise<OidcResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "not a JWT" };
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = b64json(parts[0]);
    claims = b64json(parts[1]);
  } catch {
    return { ok: false, reason: "malformed JWT" };
  }
  if (header.alg !== "RS256" || !header.kid) return { ok: false, reason: "unexpected JWT algorithm" };

  let jwks = await githubKeys();
  let jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    jwks = await githubKeys(true); // GitHub rotated its keys since we cached them
    jwk = jwks.keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return { ok: false, reason: "unknown signing key" };
  const signed = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  if (!signed) return { ok: false, reason: "bad signature" };

  const cfg = cronOidcConfig();
  const t = Math.floor(now / 1000);
  const aud = claims.aud;
  if (claims.iss !== GITHUB_OIDC_ISSUER) return { ok: false, reason: "wrong issuer" };
  if (!(aud === cfg.audience || (Array.isArray(aud) && aud.includes(cfg.audience)))) return { ok: false, reason: "wrong audience" };
  if (typeof claims.exp !== "number" || claims.exp < t - 30) return { ok: false, reason: "expired" };
  if (typeof claims.nbf === "number" && claims.nbf > t + 30) return { ok: false, reason: "not yet valid" };
  if (claims.repository !== cfg.repository) return { ok: false, reason: "wrong repository" };
  if (claims.ref !== "refs/heads/main") return { ok: false, reason: "not the main branch" };
  if (claims.workflow_ref !== cfg.workflowRef) return { ok: false, reason: "not the cron workflow" };
  return { ok: true, claims };
}

/** True when the request carries a valid CRON_SECRET or GitHub OIDC token. */
export async function authorizeCron(req: Request): Promise<{ ok: boolean; via?: "secret" | "github-oidc"; reason?: string }> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? "";
  if (!bearer) return { ok: false, reason: "no bearer token" };
  const secret = process.env.CRON_SECRET;
  if (secret && secret.length >= 24 && secretsEqual(bearer, secret)) return { ok: true, via: "secret" };
  if (bearer.split(".").length === 3) {
    try {
      const r = await verifyGithubOidc(bearer);
      return r.ok ? { ok: true, via: "github-oidc" } : { ok: false, reason: r.reason };
    } catch (e) {
      console.error("[cron] could not verify GitHub OIDC token", e);
      return { ok: false, reason: "could not verify token" };
    }
  }
  return { ok: false, reason: "invalid credentials" };
}
