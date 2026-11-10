import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as register } from "@/app/api/auth/register/route";
import { MAX_FAILURES } from "../rate-limit";
import { createUser } from "../users";
import { useTempCwd } from "./helpers";

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });

describe("auth routes", () => {
  useTempCwd("auth-routes-");
  afterEach(() => delete process.env.BOOTSTRAP_ADMIN_TOKEN);

  it("a burst of 20 parallel wrong passwords gets at most 5 password checks, then a lockout", async () => {
    await createUser({ email: "target@corp.io", name: "T", password: "real-secret-pass-1", role: "clerk" });
    const res = await Promise.all(
      Array.from({ length: 20 }, () => login(post("/api/auth/login", { email: "target@corp.io", password: "guess-guess-1" }))),
    );
    const statuses = res.map((r) => r.status);
    // 401 = password checked and wrong; the 5th checked failure itself answers 429.
    expect(statuses.filter((s) => s === 401).length).toBe(MAX_FAILURES - 1);
    expect(statuses.filter((s) => s === 429).length).toBe(20 - (MAX_FAILURES - 1));
    const body = await res.find((r) => r.status === 429)!.json();
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    // even the right password is refused while locked (no oracle)
    expect((await login(post("/api/auth/login", { email: "target@corp.io", password: "real-secret-pass-1" }))).status).toBe(429);
  });

  it("answers an unknown email exactly like a wrong password", async () => {
    const r = await login(post("/api/auth/login", { email: "nobody@corp.io", password: "whatever-123" }));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Email or password is incorrect" });
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
    // an admin now exists: the token no longer works
    expect((await register(post("/api/auth/register", body("f4@corp.io", "t0k3n-".repeat(5))))).status).toBe(403);
    // without a token, sign-up makes a clerk
    const clerk = await register(post("/api/auth/register", body("f5@corp.io")));
    expect((await clerk.json()).user.role).toBe("clerk");
  });
});
