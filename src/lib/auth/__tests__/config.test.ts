import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authSecret, devSecretPath, resetAuthSecretCache, secretsEqual } from "../secret";
import { authEnabled } from "../roles";
import { useTempCwd } from "./helpers";

describe("secret and auth configuration", () => {
  useTempCwd("auth-cfg-");
  const savedSecret = process.env.AUTH_SECRET;
  afterEach(() => {
    vi.unstubAllEnvs();
    resetAuthSecretCache();
    if (savedSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = savedSecret;
  });

  it("generates and persists a random dev secret, and replaces a too-short one", () => {
    delete process.env.AUTH_SECRET;
    const s1 = authSecret();
    expect(s1).toHaveLength(64);
    expect(fs.readFileSync(devSecretPath(), "utf8")).toBe(s1);
    resetAuthSecretCache();
    expect(authSecret()).toBe(s1); // persisted

    fs.writeFileSync(path.join(process.cwd(), "data", "auth.secret"), "tooshort");
    resetAuthSecretCache();
    const s2 = authSecret();
    expect(s2).toHaveLength(64);
    expect(s2).not.toBe(s1);
    expect(fs.readFileSync(devSecretPath(), "utf8")).toBe(s2);
  });

  it("requires a long AUTH_SECRET in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.AUTH_SECRET;
    expect(() => authSecret()).toThrow(/must be set/);
    process.env.AUTH_SECRET = "short";
    expect(() => authSecret()).toThrow(/at least 32/);
  });

  it("refuses AUTH_DISABLED=1 in production", () => {
    vi.stubEnv("AUTH_DISABLED", "1");
    expect(authEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => authEnabled()).toThrow(/not allowed in production/);
  });

  it("compares secrets in constant time and never matches an empty expected value", () => {
    expect(secretsEqual("abc", "abc")).toBe(true);
    expect(secretsEqual("abd", "abc")).toBe(false);
    expect(secretsEqual(null, "abc")).toBe(false);
    expect(secretsEqual("", "")).toBe(false);
  });
});
