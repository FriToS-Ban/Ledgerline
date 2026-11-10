import { describe, expect, it } from "vitest";
import { validateEnv } from "../env";
import { inngestDevBlocked } from "@/inngest/dev-guard";

const good = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://u:p@db:5432/x",
  AUTH_SECRET: "a".repeat(32),
  AUTH_URL: "https://app.example.com",
  S3_BUCKET: "b",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
  INNGEST_SIGNING_KEY: "signkey-prod-1",
};
const errs = (e: Record<string, string | undefined>) => {
  const r = validateEnv(e);
  return r.ok ? [] : r.errors.join("\n");
};

describe("validateEnv", () => {
  it("requires nothing outside production", () => {
    expect(validateEnv({ NODE_ENV: "development" })).toEqual({ ok: true });
  });
  it("accepts a complete production env", () => {
    expect(validateEnv(good)).toEqual({ ok: true });
    expect(validateEnv({ ...good, AUTH_URL: undefined, AUTH_TRUST_HOST: "1" })).toEqual({ ok: true });
  });
  it("lists every problem", () => {
    const out = errs({ NODE_ENV: "production" }) as string;
    for (const k of ["DATABASE_URL", "AUTH_SECRET", "AUTH_URL", "S3_BUCKET", "INNGEST_SIGNING_KEY"]) expect(out).toContain(k);
  });
  it("rejects weak or unsafe values", () => {
    expect(errs({ ...good, AUTH_SECRET: "short" })).toContain("AUTH_SECRET");
    expect(errs({ ...good, AUTH_DISABLED: "1" })).toContain("AUTH_DISABLED");
    expect(errs({ ...good, STORAGE_DRIVER: "memory" })).toContain("STORAGE_DRIVER");
    expect(errs({ ...good, BOOTSTRAP_ADMIN_TOKEN: "tooshort" })).toContain("BOOTSTRAP_ADMIN_TOKEN");
    expect(validateEnv({ ...good, BOOTSTRAP_ADMIN_TOKEN: "x".repeat(24) })).toEqual({ ok: true });
  });
});

describe("inngestDevBlocked", () => {
  const h = (o: Record<string, string> = {}) => new Headers(o);
  it("refuses unsigned mutating calls in dev unless INNGEST_DEV=1", () => {
    expect(inngestDevBlocked("POST", h(), { NODE_ENV: "development" })).toBe(true);
    expect(inngestDevBlocked("POST", h(), { NODE_ENV: "development", INNGEST_DEV: "1" })).toBe(false);
    expect(inngestDevBlocked("POST", h({ "x-inngest-signature": "t=1&s=x" }), { NODE_ENV: "development" })).toBe(false);
    expect(inngestDevBlocked("GET", h(), { NODE_ENV: "development" })).toBe(false);
  });
  it("leaves production to the SDK signature check", () => {
    expect(inngestDevBlocked("POST", h(), { NODE_ENV: "production" })).toBe(false);
  });
});
