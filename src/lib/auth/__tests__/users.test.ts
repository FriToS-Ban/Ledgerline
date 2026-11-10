import { afterEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../hash";
import { getDb } from "@/lib/db/client";
import { invites, memberships } from "@/lib/db/schema";
import {
  bootstrapTokenAccepted,
  bumpTokenVersion,
  changeRole,
  createUser,
  findInvite,
  findUser,
  hashInviteToken,
  listMemberships,
  listUsers,
  realAdminCount,
  setPassword,
} from "../users";
import { useTempCwd } from "./helpers";

describe("users, roles and demo accounts", () => {
  useTempCwd("auth-users-");
  afterEach(() => {
    delete process.env.DEMO_USERS;
    delete process.env.BOOTSTRAP_ADMIN_TOKEN;
  });

  it("never demotes the last admin", async () => {
    await createUser({ email: "boss@corp.io", name: "Boss", password: "p-unique-9876", role: "admin" });
    const r = await changeRole("boss@corp.io", "clerk");
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((await findUser("boss@corp.io"))?.role).toBe("admin");

    await createUser({ email: "second@corp.io", name: "Second", password: "p-unique-9876", role: "clerk" });
    expect(await changeRole("second@corp.io", "admin")).toMatchObject({ ok: true });
    expect(await changeRole("BOSS@corp.io", "approver")).toMatchObject({ ok: true, user: { role: "approver" } });
    // now "second" is the only admin
    expect(await changeRole("second@corp.io", "clerk")).toMatchObject({ ok: false, status: 409 });
    // re-asserting admin on the last admin is fine
    expect(await changeRole("second@corp.io", "admin")).toMatchObject({ ok: true });
  });

  it("returns 404 for an unknown user", async () => {
    expect(await changeRole("ghost@corp.io", "clerk")).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses a duplicate email and stores a salted hash", async () => {
    expect(await createUser({ email: "Dup@Corp.io", name: "D", password: "first-pass-xyz", role: "clerk" })).not.toBeNull();
    expect(await createUser({ email: "dup@corp.io", name: "D2", password: "other-pass-xyz", role: "clerk" })).toBeNull();
    const u = await findUser("DUP@corp.io");
    expect(u?.hash).not.toContain("first-pass-xyz");
    expect(await verifyPassword("first-pass-xyz", u!.hash)).toBe(true);
  });

  it("only seeds and admits demo accounts with DEMO_USERS=1", async () => {
    expect(await findUser("admin@ledgerline.demo")).toBeNull();
    process.env.DEMO_USERS = "1";
    expect((await findUser("admin@ledgerline.demo"))?.role).toBe("admin");
    expect((await listUsers()).some((u) => u.email === "admin@ledgerline.demo")).toBe(true);
    delete process.env.DEMO_USERS;
    // rows still exist, but are invisible and cannot sign in
    expect(await findUser("admin@ledgerline.demo")).toBeNull();
    expect((await listUsers()).some((u) => u.email.endsWith("@ledgerline.demo"))).toBe(false);
  });

  it("does not count hidden demo admins when protecting the last admin", async () => {
    process.env.DEMO_USERS = "1";
    expect((await findUser("admin@ledgerline.demo"))?.role).toBe("admin"); // seeded
    // demote every real admin but one
    for (const u of await listUsers()) {
      if (u.role === "admin" && !u.email.endsWith("@ledgerline.demo") && u.email !== "second@corp.io") {
        await changeRole(u.email, "clerk");
      }
    }
    delete process.env.DEMO_USERS;
    expect(await realAdminCount()).toBe(1);
    // the demo admin row still exists, but can't sign in: "second" is the last usable admin
    expect(await changeRole("second@corp.io", "clerk")).toMatchObject({ ok: false, status: 409 });
  });

  it("bootstrap token: constant-time match, min length, and only while no real admin exists", async () => {
    process.env.BOOTSTRAP_ADMIN_TOKEN = "short";
    expect(await bootstrapTokenAccepted("short")).toBe(false); // too short to honour
    process.env.BOOTSTRAP_ADMIN_TOKEN = "a".repeat(32);
    expect(await bootstrapTokenAccepted("a".repeat(31))).toBe(false);
    expect(await bootstrapTokenAccepted("a".repeat(32))).toBe(false); // "second" is a real admin
    await changeRole("second@corp.io", "admin");
  });

  it("gives a new user a personal organization with an owner membership", async () => {
    const u = (await createUser({ email: "solo@corp.io", name: "Solo", password: "p-unique-9876", role: "clerk" }))!;
    const ms = await listMemberships(u.id);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ orgRole: "owner" });
    expect(ms[0].slug).toMatch(/^personal-/);
  });

  it("joins the inviting org with the invited role when a valid invite is used, once", async () => {
    const owner = (await createUser({ email: "own@corp.io", name: "Own", password: "p-unique-9876", role: "clerk" }))!;
    const [org] = await listMemberships(owner.id);
    const token = "invite-token-123";
    await getDb().insert(invites).values({
      orgId: org.orgId,
      email: "guest@corp.io",
      role: "admin",
      tokenHash: hashInviteToken(token),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    expect(await findInvite(token, "someone-else@corp.io")).toBeNull(); // wrong email
    expect(await findInvite("nope", "guest@corp.io")).toBeNull();
    const invite = (await findInvite(token, "GUEST@corp.io"))!;
    const g = (await createUser({ email: "guest@corp.io", name: "Guest", password: "p-unique-9876", role: "clerk", invite }))!;
    expect(await listMemberships(g.id)).toMatchObject([{ orgId: org.orgId, orgRole: "admin" }]);
    expect(await findInvite(token, "guest@corp.io")).toBeNull(); // consumed
    expect((await getDb().select().from(memberships)).filter((m) => m.userId === g.id)).toHaveLength(1);
  });

  it("bumps tokenVersion on password change and sign-out-everywhere", async () => {
    const u = (await createUser({ email: "ver@corp.io", name: "Ver", password: "p-unique-9876", role: "clerk" }))!;
    expect(u.tokenVersion).toBe(0);
    expect(await setPassword("ver@corp.io", "another-pass-4321")).toBe(1);
    expect(await bumpTokenVersion(u.id)).toBe(2);
    expect((await findUser("ver@corp.io"))?.tokenVersion).toBe(2);
  });
});
