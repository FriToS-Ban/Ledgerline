import { afterEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../hash";
import { getDb } from "@/lib/db/client";
import { invites, memberships } from "@/lib/db/schema";
import {
  bumpTokenVersion,
  changeMemberRole,
  createUser,
  findInvite,
  findUser,
  hashInviteToken,
  listMemberships,
  listOrgMembers,
  realAdminCount,
  setPassword,
} from "../users";
import { useTempCwd } from "./helpers";

describe("users, roles and demo accounts", () => {
  useTempCwd("auth-users-");
  afterEach(() => {
    delete process.env.DEMO_USERS;
  });

  it("never demotes the last owner, and only owners touch the owner role", async () => {
    const boss = (await createUser({ email: "boss@corp.io", name: "Boss", password: "p-unique-9876", role: "clerk" }))!;
    const [org] = await listMemberships(boss.id);
    expect(await changeMemberRole(org.orgId, "owner", "boss@corp.io", "member")).toMatchObject({ ok: false, status: 409 });
    expect((await listOrgMembers(org.orgId))[0]).toMatchObject({ email: "boss@corp.io", role: "owner" });

    const second = (await createUser({ email: "second@corp.io", name: "Second", password: "p-unique-9876", role: "admin" }))!;
    await getDb().insert(memberships).values({ orgId: org.orgId, userId: second.id, role: "member" });
    expect(await changeMemberRole(org.orgId, "admin", "second@corp.io", "owner")).toMatchObject({ ok: false, status: 403 });
    expect(await changeMemberRole(org.orgId, "owner", "second@corp.io", "owner")).toMatchObject({ ok: true });
    expect(await changeMemberRole(org.orgId, "owner", "BOSS@corp.io", "admin")).toMatchObject({ ok: true, user: { role: "admin" } });
    // now "second" is the only owner
    expect(await changeMemberRole(org.orgId, "owner", "second@corp.io", "member")).toMatchObject({ ok: false, status: 409 });
    expect(await changeMemberRole(org.orgId, "owner", "second@corp.io", "owner")).toMatchObject({ ok: true });
  });

  it("returns 404 for someone who is not a member of the org", async () => {
    const [org] = await listMemberships((await findUser("boss@corp.io"))!.id);
    expect(await changeMemberRole(org.orgId, "owner", "ghost@corp.io", "member")).toMatchObject({ ok: false, status: 404 });
    const outsider = (await createUser({ email: "outsider@corp.io", name: "Out", password: "p-unique-9876", role: "clerk" }))!;
    expect(outsider.id).toBeTruthy();
    expect(await changeMemberRole(org.orgId, "owner", "outsider@corp.io", "admin")).toMatchObject({ ok: false, status: 404 });
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
    const demo = (await listMemberships((await findUser("admin@ledgerline.demo"))!.id))[0];
    expect((await listOrgMembers(demo.orgId)).some((u) => u.email === "admin@ledgerline.demo")).toBe(true);
    delete process.env.DEMO_USERS;
    // rows still exist, but are invisible and cannot sign in
    expect(await findUser("admin@ledgerline.demo")).toBeNull();
    expect((await listOrgMembers(demo.orgId)).some((u) => u.email.endsWith("@ledgerline.demo"))).toBe(false);
  });

  it("does not count hidden demo admins", async () => {
    process.env.DEMO_USERS = "1";
    await findUser("admin@ledgerline.demo"); // seeded
    delete process.env.DEMO_USERS;
    expect(await realAdminCount()).toBe(1); // only "second" (users.role = admin)
  });

  it("an org admin cannot see or change members of another org", async () => {
    const [a] = await listMemberships((await findUser("boss@corp.io"))!.id);
    const [b] = await listMemberships((await findUser("outsider@corp.io"))!.id);
    expect((await listOrgMembers(a.orgId)).map((m) => m.email)).not.toContain("outsider@corp.io");
    expect((await listOrgMembers(b.orgId)).map((m) => m.email)).toEqual(["outsider@corp.io"]);
    expect(await changeMemberRole(a.orgId, "owner", "outsider@corp.io", "member")).toMatchObject({ ok: false, status: 404 });
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
