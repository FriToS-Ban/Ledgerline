import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attemptFailed,
  attemptSucceeded,
  clientIp,
  LOCK_MS,
  lockedFor,
  MAX_FAILURES,
  recordFailure,
  reserveAttempt,
  throttleKeys,
  WINDOW_MS,
} from "../rate-limit";
import { freezeClock, useTempCwd } from "./helpers";

describe("login rate limit and lockout", () => {
  useTempCwd("auth-rl-");
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TRUST_PROXY;
    delete process.env.TRUSTED_PROXY_HOPS;
  });

  it("locks an email after 5 failures in 15 minutes, for 15 minutes", async () => {
    const clock = freezeClock();
    const keys = throttleKeys("login", "Victim@Example.com", "10.0.0.1");
    expect(keys).toEqual(["login:email:victim@example.com", "login:ip:10.0.0.1"]);
    for (let i = 0; i < 4; i++) expect(await recordFailure(keys)).toBe(0);
    expect(await lockedFor(keys)).toBe(0);
    expect(await recordFailure(keys)).toBe(LOCK_MS / 1000);
    expect(await lockedFor(keys)).toBe(900);
    expect(await reserveAttempt(keys)).toEqual({ ok: false, retryAfterSeconds: 900 });

    clock.advance(10 * 60 * 1000);
    expect(await lockedFor(keys)).toBe(300);
    clock.advance(5 * 60 * 1000 + 1000);
    expect(await lockedFor(keys)).toBe(0);
    // fresh budget after the lock ends
    expect(await recordFailure(keys)).toBe(0);
  });

  it("refuses all but MAX_FAILURES of 20 concurrent attempts (no check-then-act race)", async () => {
    freezeClock();
    const keys = throttleKeys("login", "burst@x.io", null);
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveAttempt(keys)));
    expect(results.filter((r) => r.ok)).toHaveLength(MAX_FAILURES);
    expect(results.filter((r) => !r.ok)).toHaveLength(20 - MAX_FAILURES);
    expect(await lockedFor(keys)).toBeGreaterThan(0);
  });

  it("locks by IP across different emails", async () => {
    freezeClock();
    const ip = "10.0.0.2";
    for (let i = 0; i < 4; i++) expect(await recordFailure(throttleKeys("login", `user${i}@x.io`, ip))).toBe(0);
    expect(await recordFailure(throttleKeys("login", "user9@x.io", ip))).toBeGreaterThan(0);
    expect(await lockedFor(throttleKeys("login", "someone-else@x.io", ip))).toBeGreaterThan(0);
    expect(await lockedFor(throttleKeys("login", "someone-else@x.io", "10.0.0.3"))).toBe(0);
  });

  it("uses only the email key when the IP is not trusted", () => {
    expect(throttleKeys("login", "a@x.io", null)).toEqual(["login:email:a@x.io"]);
  });

  it("forgets failures older than the window", async () => {
    const clock = freezeClock();
    const keys = throttleKeys("login", "slow@x.io", "10.0.0.4");
    for (let i = 0; i < 4; i++) await recordFailure(keys);
    clock.advance(WINDOW_MS + 1000);
    expect(await recordFailure(keys)).toBe(0); // count restarted at 1
    expect(await lockedFor(keys)).toBe(0);
  });

  it("success clears the email key and refunds the IP key", async () => {
    freezeClock();
    const keys = throttleKeys("login", "ok@x.io", "10.0.0.5");
    for (let i = 0; i < 4; i++) await recordFailure(keys);
    const r = await reserveAttempt(keys); // 5th attempt, then it succeeds
    expect(r.ok).toBe(true);
    await attemptSucceeded(r, [keys[0]]);
    // email budget is fresh; IP is back to 4, so one more failure from that IP locks it
    expect(await recordFailure([keys[0]])).toBe(0);
    expect(await attemptFailed(await reserveAttempt([keys[1]]))).toBeGreaterThan(0);
  });

  it("trusts forwarding headers only with TRUST_PROXY=1, reading from the right", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" });
    expect(clientIp(h)).toBeNull();
    process.env.TRUST_PROXY = "1";
    expect(clientIp(h)).toBe("1.2.3.4"); // the entry our proxy appended, not the spoofable left one
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(clientIp(h)).toBe("6.6.6.6");
    expect(clientIp(new Headers({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers())).toBeNull();
  });
});
