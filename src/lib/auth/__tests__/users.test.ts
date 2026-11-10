import { afterEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../session";
import { changeRole, createUser, findUser, listUsers, roleForNewUser } from "../users";
import { useTempCwd } from "./helpers";

describe("users, roles and demo accounts", () => {
  useTempCwd("auth-users-");
  afterEach(() => {
    delete process.env.DEMO_USERS;
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
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
    expect(verifyPassword("first-pass-xyz", u!.hash)).toBe(true);
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

  it("makes BOOTSTRAP_ADMIN_EMAIL an admin only while no admin exists", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = "Founder@Corp.io";
    expect(await roleForNewUser("someone@corp.io")).toBe("clerk");
    // admins already exist in this db from earlier tests
    expect(await roleForNewUser("founder@corp.io")).toBe("clerk");
  });
});
