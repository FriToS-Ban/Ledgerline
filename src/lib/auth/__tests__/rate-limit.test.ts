import { afterEach, describe, expect, it, vi } from "vitest";
import { clearFailures, clientIp, LOCK_MS, lockedFor, recordFailure, throttleKeys, WINDOW_MS } from "../rate-limit";
import { freezeClock, useTempCwd } from "./helpers";

describe("login rate limit and lockout", () => {
  useTempCwd("auth-rl-");
  afterEach(() => vi.useRealTimers());

  it("locks an email after 5 failures in 15 minutes, for 15 minutes", async () => {
    const clock = freezeClock();
    const keys = throttleKeys("login", "Victim@Example.com", "10.0.0.1");
    expect(keys).toEqual(["login:email:victim@example.com", "login:ip:10.0.0.1"]);
    for (let i = 0; i < 4; i++) expect(await recordFailure(keys)).toBe(0);
    expect(await lockedFor(keys)).toBe(0);
    expect(await recordFailure(keys)).toBe(LOCK_MS / 1000);
    expect(await lockedFor(keys)).toBe(900);

    clock.advance(10 * 60 * 1000);
    expect(await lockedFor(keys)).toBe(300);
    clock.advance(5 * 60 * 1000 + 1000);
    expect(await lockedFor(keys)).toBe(0);
    // fresh budget after the lock ends
    expect(await recordFailure(keys)).toBe(0);
  });

  it("locks by IP across different emails", async () => {
    freezeClock();
    const ip = "10.0.0.2";
    for (let i = 0; i < 4; i++) expect(await recordFailure(throttleKeys("login", `user${i}@x.io`, ip))).toBe(0);
    expect(await recordFailure(throttleKeys("login", "user9@x.io", ip))).toBeGreaterThan(0);
    // a brand-new email from the same IP is blocked too
    expect(await lockedFor(throttleKeys("login", "someone-else@x.io", ip))).toBeGreaterThan(0);
    // but that email from another IP is fine
    expect(await lockedFor(throttleKeys("login", "someone-else@x.io", "10.0.0.3"))).toBe(0);
  });

  it("forgets failures older than the window", async () => {
    const clock = freezeClock();
    const keys = throttleKeys("login", "slow@x.io", "10.0.0.4");
    for (let i = 0; i < 4; i++) await recordFailure(keys);
    clock.advance(WINDOW_MS + 1000);
    expect(await recordFailure(keys)).toBe(0); // count restarted at 1
    expect(await lockedFor(keys)).toBe(0);
  });

  it("clears an email's failures after a successful sign-in", async () => {
    freezeClock();
    const keys = throttleKeys("login", "ok@x.io", "10.0.0.5");
    for (let i = 0; i < 4; i++) await recordFailure(keys);
    await clearFailures(keys.slice(0, 1));
    // email budget is fresh; only the IP key (now at 4) would lock on the next failure
    expect(await recordFailure([keys[0]])).toBe(0);
  });

  it("reads the client IP from proxy headers", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
