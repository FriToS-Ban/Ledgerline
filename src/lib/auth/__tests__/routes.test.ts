import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST as register } from "@/app/api/auth/register/route";
import { authenticate } from "../credentials";
import { MAX_FAILURES } from "../rate-limit";
import { createUser } from "../users";
import { useTempCwd } from "./helpers";

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });

describe("credentials sign-in and registration", () => {
  useTempCwd("auth-routes-");
  afterEach(() => delete process.env.BOOTSTRAP_ADMIN_TOKEN);

  it("a burst of 20 parallel wrong passwords gets at most 5 password checks, then a lockout", async () => {
    await createUser({ email: "target@corp.io", name: "T", password: "real-secret-pass-1", role: "clerk" });
    const res = await Promise.all(
      Array.from({ length: 20 }, () => authenticate({ email: "target@corp.io", password: "guess-guess-1" }, null)),
    );
    // "invalid" = password checked and wrong; the 5th checked failure itself reports locked.
    expect(res.filter((r) => !r.ok && r.reason === "invalid").length).toBe(MAX_FAILURES - 1);
    const locked = res.filter((r) => !r.ok && r.reason === "locked");
    expect(locked.length).toBe(20 - (MAX_FAILURES - 1));
    expect(locked.every((r) => !r.ok && r.reason === "locked" && r.retryAfterSeconds > 0)).toBe(true);
    // even the right password is refused while locked (no oracle)
    expect(await authenticate({ email: "target@corp.io", password: "real-secret-pass-1" }, null)).toMatchObject({
      ok: false,
      reason: "locked",
    });
  });

  it("signs in with the right password, resolving the user and giving them a membership", async () => {
    await createUser({ email: "good@corp.io", name: "G", password: "real-secret-pass-1", role: "clerk" });
    const r = await authenticate({ email: "GOOD@corp.io", password: "real-secret-pass-1" }, null);
    expect(r).toMatchObject({ ok: true, user: { email: "good@corp.io", tokenVersion: 0 } });
  });

  it("answers an unknown email exactly like a wrong password", async () => {
    expect(await authenticate({ email: "nobody@corp.io", password: "whatever-123" }, null)).toEqual({ ok: false, reason: "invalid" });
    expect(await authenticate({ email: "", password: "" }, null)).toEqual({ ok: false, reason: "invalid" });
  });

  it("only makes an admin with the right bootstrap token, and only once", async () => {
    const body = (email: string, bootstrapToken?: string) => ({ email, name: "Founder", password: "violet-anchor-881", bootstrapToken });
    // not configured -> any token is refused, nothing is created
    expect((await register(post("/api/auth/register", body("f1@corp.io", "x".repeat(30))))).status).toBe(403);
    process.env.BOOTSTRAP_ADMIN_TOKEN = "t0k3n-".repeat(5);
    expect((await register(post("/api/auth/register", body("f2@corp.io", "wrong-token-wrong-token-1")))).status).toBe(403);
    const ok = await register(post("/api/auth/register", body("f3@corp.io", "t0k3n-".repeat(5))));
    expect(ok.status).toBe(201);
    expect((await ok.json()).user.role).toBe("admin");
    expect(ok.headers.get("set-cookie")).toContain("ledgerline_session=");
    // an admin now exists: the token no longer works
    expect((await register(post("/api/auth/register", body("f4@corp.io", "t0k3n-".repeat(5))))).status).toBe(403);
    // without a token, sign-up makes a clerk
    const clerk = await register(post("/api/auth/register", body("f5@corp.io")));
    expect((await clerk.json()).user.role).toBe("clerk");
  });

  it("refuses an invalid invite token", async () => {
    const r = await register(post("/api/auth/register", { email: "inv@corp.io", name: "Inv", password: "violet-anchor-881", inviteToken: "bogus" }));
    expect(r.status).toBe(403);
  });
});
