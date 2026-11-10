import { afterEach, describe, expect, it, vi } from "vitest";
import { rawDbClient } from "@/lib/db/client";
import { createToken, hashSessionId, IDLE_TTL_MS, readToken } from "../session";
import { activeSessionCount, createSession, resolveSession, revokeSession, revokeUserSessions } from "../sessions";
import { changeRole, createUser } from "../users";
import { freezeClock, useTempCwd } from "./helpers";

const alice = { email: "alice@corp.io", name: "Alice", role: "clerk" as const };

describe("DB-backed sessions", () => {
  useTempCwd("auth-sess-");
  afterEach(() => vi.useRealTimers());

  it("creates a session, stores only the hash of its id, and resolves it", async () => {
    await createUser({ ...alice, password: "a-strong-passphrase" });
    const { token, sid } = await createSession(alice);
    expect(readToken(token)?.sid).toBe(sid);
    const rows = (await rawDbClient().execute("SELECT id_hash FROM auth_sessions")).rows.map((r) => String(r.id_hash));
    expect(rows).toContain(hashSessionId(sid));
    expect(rows).not.toContain(sid);
    expect(await resolveSession(token)).toMatchObject({ email: alice.email, role: "clerk" });
  });

  it("rejects a token whose id has no DB row, a tampered token, and a missing one", async () => {
    expect(await resolveSession(createToken({ ...alice, sid: "made-up" }))).toBeNull();
    const { token } = await createSession(alice);
    expect(await resolveSession(token.slice(0, -2) + "xx")).toBeNull();
    expect(await resolveSession(undefined)).toBeNull();
  });

  it("revokes one session on logout", async () => {
    const { token, sid } = await createSession(alice);
    await revokeSession(sid);
    expect(await resolveSession(token)).toBeNull();
  });

  it("signs out everywhere, optionally keeping the caller's session", async () => {
    const a = await createSession(alice);
    const b = await createSession(alice);
    const c = await createSession(alice);
    expect(await revokeUserSessions(alice.email, c.sid)).toBeGreaterThanOrEqual(2);
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
    expect(await resolveSession(c.token)).not.toBeNull();
    await revokeUserSessions(alice.email);
    expect(await resolveSession(c.token)).toBeNull();
    expect(await activeSessionCount(alice.email)).toBe(0);
  });

  it("expires after the idle timeout", async () => {
    const clock = freezeClock();
    const { token } = await createSession(alice);
    clock.advance(IDLE_TTL_MS - 60_000);
    expect(await resolveSession(token)).not.toBeNull(); // slides the window
    clock.advance(IDLE_TTL_MS - 60_000);
    expect(await resolveSession(token)).not.toBeNull();
    clock.advance(IDLE_TTL_MS + 1000);
    expect(await resolveSession(token)).toBeNull();
  });

  it("expires at the absolute limit even when used constantly", async () => {
    const clock = freezeClock();
    const { token } = await createSession(alice);
    for (let h = 1; h < 8; h++) {
      clock.advance(60 * 60 * 1000);
      expect(await resolveSession(token)).not.toBeNull();
    }
    clock.advance(60 * 60 * 1000 + 1000);
    expect(await resolveSession(token)).toBeNull();
  });

  it("reads the role from the users table, so a role change applies at once", async () => {
    const { token } = await createSession(alice); // cookie says clerk
    await changeRole(alice.email, "approver");
    expect((await resolveSession(token))?.role).toBe("approver");
  });
});
