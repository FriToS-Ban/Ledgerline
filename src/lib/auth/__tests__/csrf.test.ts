import { afterEach, describe, expect, it } from "vitest";
import { csrfProblem } from "../csrf";

const h = (o: Record<string, string>) => new Headers({ host: "app.example.com", ...o });

describe("CSRF origin check", () => {
  afterEach(() => delete process.env.APP_ORIGINS);

  it("lets safe methods through regardless of origin", () => {
    expect(csrfProblem("GET", "/api/invoices", h({ origin: "https://evil.example" }))).toBeNull();
    expect(csrfProblem("HEAD", "/api/invoices", h({ origin: "https://evil.example" }))).toBeNull();
  });

  it("allows same-origin and blocks cross-origin mutations", () => {
    expect(csrfProblem("POST", "/api/auth/login", h({ origin: "https://app.example.com" }))).toBeNull();
    expect(csrfProblem("POST", "/api/auth/login", h({ origin: "https://evil.example" }))).toMatch(/blocked/);
    expect(csrfProblem("PATCH", "/api/auth/users", h({ origin: "null" }))).toMatch(/blocked/);
    expect(csrfProblem("DELETE", "/api/x", h({ origin: "https://app.example.com.evil.example" }))).toMatch(/blocked/);
  });

  it("falls back to Referer, then Sec-Fetch-Site", () => {
    expect(csrfProblem("POST", "/api/policy", h({ referer: "https://app.example.com/policy" }))).toBeNull();
    expect(csrfProblem("POST", "/api/policy", h({ referer: "https://evil.example/x" }))).toMatch(/blocked/);
    expect(csrfProblem("POST", "/api/policy", h({ "sec-fetch-site": "cross-site" }))).toMatch(/blocked/);
    // non-browser client (curl, cron) with no browser headers at all
    expect(csrfProblem("POST", "/api/policy", h({}))).toBeNull();
  });

  it("honours x-forwarded-host and APP_ORIGINS", () => {
    expect(csrfProblem("POST", "/api/x", h({ "x-forwarded-host": "public.example.com", origin: "https://public.example.com" }))).toBeNull();
    process.env.APP_ORIGINS = "https://admin.example.com";
    expect(csrfProblem("POST", "/api/x", h({ origin: "https://admin.example.com" }))).toBeNull();
  });

  it("exempts the webhook routes that carry their own secret", () => {
    expect(csrfProblem("POST", "/api/intake/email", h({ origin: "https://mailer.example" }))).toBeNull();
    expect(csrfProblem("PUT", "/api/inngest", h({ origin: "https://inngest.example" }))).toBeNull();
    expect(csrfProblem("POST", "/api/intake/poll", h({ origin: "https://evil.example" }))).toMatch(/blocked/);
  });
});
