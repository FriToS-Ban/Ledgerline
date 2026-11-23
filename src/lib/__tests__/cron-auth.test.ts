import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeCron, GITHUB_OIDC_ISSUER, resetJwksCache, verifyGithubOidc } from "../cron-auth";

const github = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...github.publicKey.export({ format: "jwk" }), kid: "gh-1", alg: "RS256", use: "sig" };

const now = Math.floor(Date.now() / 1000);
const goodClaims = {
  iss: GITHUB_OIDC_ISSUER,
  aud: "ledgerline-cron",
  repository: "FriToS-Ban/Ledgerline",
  ref: "refs/heads/main",
  workflow_ref: "FriToS-Ban/Ledgerline/.github/workflows/cron.yml@refs/heads/main",
  event_name: "schedule",
  iat: now,
  nbf: now - 5,
  exp: now + 300,
};

function jwt(claims: Record<string, unknown>, key = github.privateKey, kid = "gh-1") {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "RS256", typ: "JWT", kid });
  const body = enc(claims);
  const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url");
  return `${head}.${body}.${sig}`;
}

const req = (auth?: string) => new Request("http://localhost/api/cron/tick", { headers: auth ? { authorization: auth } : {} });

describe("cron auth: GitHub Actions OIDC (no shared secret)", () => {
  beforeEach(() => {
    resetJwksCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(String(url)).toBe("https://token.actions.githubusercontent.com/.well-known/jwks");
        return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CRON_SECRET;
  });

  it("accepts a token GitHub signed for this repo's cron workflow on main", async () => {
    expect(await verifyGithubOidc(jwt(goodClaims))).toMatchObject({ ok: true });
    expect(await authorizeCron(req(`Bearer ${jwt(goodClaims)}`))).toEqual({ ok: true, via: "github-oidc" });
  });

  it.each([
    ["a forged signature", jwt(goodClaims, attacker.privateKey), "bad signature"],
    ["an unknown key id", jwt(goodClaims, github.privateKey, "nope"), "unknown signing key"],
    ["another repository (a fork)", jwt({ ...goodClaims, repository: "evil/Ledgerline", workflow_ref: "evil/Ledgerline/.github/workflows/cron.yml@refs/heads/main" }), "wrong repository"],
    ["another branch", jwt({ ...goodClaims, ref: "refs/heads/feature" }), "not the main branch"],
    ["another workflow in the repo", jwt({ ...goodClaims, workflow_ref: "FriToS-Ban/Ledgerline/.github/workflows/ci.yml@refs/heads/main" }), "not the cron workflow"],
    ["a token for another audience", jwt({ ...goodClaims, aud: "sts.amazonaws.com" }), "wrong audience"],
    ["an expired token", jwt({ ...goodClaims, exp: now - 600 }), "expired"],
    ["another issuer", jwt({ ...goodClaims, iss: "https://example.com" }), "wrong issuer"],
  ])("refuses %s", async (_label, token, reason) => {
    expect(await verifyGithubOidc(token)).toEqual({ ok: false, reason });
    expect((await authorizeCron(req(`Bearer ${token}`))).ok).toBe(false);
  });

  it("refuses an alg=none token without checking keys", async () => {
    const none = `${Buffer.from(JSON.stringify({ alg: "none", kid: "gh-1" })).toString("base64url")}.${Buffer.from(JSON.stringify(goodClaims)).toString("base64url")}.`;
    expect(await verifyGithubOidc(none)).toEqual({ ok: false, reason: "unexpected JWT algorithm" });
  });

  it("still accepts CRON_SECRET when one is configured, and nothing without credentials", async () => {
    process.env.CRON_SECRET = "a-very-long-cron-secret-123456";
    expect(await authorizeCron(req("Bearer a-very-long-cron-secret-123456"))).toEqual({ ok: true, via: "secret" });
    expect((await authorizeCron(req("Bearer wrong"))).ok).toBe(false);
    expect((await authorizeCron(req())).ok).toBe(false);
  });
});
