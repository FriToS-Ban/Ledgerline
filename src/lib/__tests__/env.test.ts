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
  APP_ORIGINS: "https://app.example.com",
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
  });
  it("refuses demo users with the default or a short password", () => {
    expect(errs({ ...good, DEMO_USERS: "1" })).toContain("DEMO_USERS");
    expect(errs({ ...good, DEMO_USERS: "1", DEMO_PASSWORD: "ledgerline" })).toContain("DEMO_USERS");
    expect(errs({ ...good, DEMO_USERS: "1", DEMO_PASSWORD: "short" })).toContain("DEMO_USERS");
    expect(validateEnv({ ...good, DEMO_USERS: "1", DEMO_PASSWORD: "a-long-demo-pass" })).toEqual({ ok: true });
  });
  it("requires https AUTH_URL and APP_ORIGINS or TRUST_PROXY", () => {
    expect(errs({ ...good, AUTH_URL: "http://app.example.com" })).toContain("AUTH_URL");
    expect(validateEnv({ ...good, AUTH_URL: "http://app.example.com", AUTH_ALLOW_HTTP: "1" })).toEqual({ ok: true });
    expect(errs({ ...good, APP_ORIGINS: undefined })).toContain("APP_ORIGINS");
    expect(validateEnv({ ...good, APP_ORIGINS: undefined, TRUST_PROXY: "1" })).toEqual({ ok: true });
  });
  it("refuses default database credentials and plain-http S3", () => {
    expect(errs({ ...good, DATABASE_URL: "postgres://postgres:postgres@db:5432/x" })).toContain("DATABASE_URL");
    expect(errs({ ...good, S3_ENDPOINT: "http://s3.internal:9000" })).toContain("S3_ENDPOINT");
    expect(validateEnv({ ...good, S3_ENDPOINT: "http://s3:9090", S3_ALLOW_INSECURE: "1" })).toEqual({ ok: true });
    expect(validateEnv({ ...good, S3_ENDPOINT: "https://s3.example.com" })).toEqual({ ok: true });
  });
  it("requires a long INTAKE_SECRET when set", () => {
    expect(errs({ ...good, INTAKE_SECRET: "short" })).toContain("INTAKE_SECRET");
    expect(validateEnv({ ...good, INTAKE_SECRET: "i".repeat(24) })).toEqual({ ok: true });
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
