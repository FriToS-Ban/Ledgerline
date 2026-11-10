import { NextRequest, type NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { memberships, organizations } from "@/lib/db/schema";
import { SESSION_COOKIE } from "../cookies";
import { authSecret } from "../secret";
import { initialClaims, refreshClaims, SESSION_MAX_AGE_S } from "../token";
import { bumpTokenVersion, createUser, listMemberships, setPassword, type CreatedUser } from "../users";
import { freezeClock, useTempCwd } from "./helpers";

// The password route reads the caller through guard.getActor() (Auth.js needs a request context).
let actor: unknown = null;
vi.mock("../guard", () => ({ getActor: async () => actor }));

const claimsOf = (u: CreatedUser) => initialClaims({ id: u.id, email: u.email, name: u.name, tokenVersion: u.tokenVersion });

describe("JWT revocation and active organization", () => {
  useTempCwd("auth-token-");
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.DEMO_USERS;
  });

  it("accepts a fresh token and resolves role, org and org role from the database", async () => {
    const u = (await createUser({ email: "a@corp.io", name: "A", password: "p-unique-9876", role: "approver" }))!;
    const c = await refreshClaims(claimsOf(u));
    const [m] = await listMemberships(u.id);
    expect(c).toMatchObject({ userId: u.id, role: "approver", activeOrgId: m.orgId, orgRole: "owner" });
  });

  it("rejects a token whose tokenVersion is stale (sign out everywhere)", async () => {
    const u = (await createUser({ email: "b@corp.io", name: "B", password: "p-unique-9876", role: "clerk" }))!;
    const old = claimsOf(u);
    expect(await refreshClaims(old)).not.toBeNull();
    await bumpTokenVersion(u.id);
    expect(await refreshClaims(old)).toBeNull();
    // a token minted at the new version works
    expect(await refreshClaims({ ...old, tokenVersion: 1 })).not.toBeNull();
  });

  it("rejects old tokens after a password change", async () => {
    const u = (await createUser({ email: "c@corp.io", name: "C", password: "p-unique-9876", role: "clerk" }))!;
    const old = claimsOf(u);
    await setPassword(u.email, "brand-new-pass-77");
    expect(await refreshClaims(old)).toBeNull();
  });

  it("rejects a token for a deleted user, a malformed one, and one past the absolute lifetime", async () => {
    expect(await refreshClaims({ userId: "00000000-0000-0000-0000-000000000000", tokenVersion: 0, authAt: Date.now() })).toBeNull();
    expect(await refreshClaims({})).toBeNull();
    const u = (await createUser({ email: "d@corp.io", name: "D", password: "p-unique-9876", role: "clerk" }))!;
    const clock = freezeClock();
    const c = claimsOf(u);
    clock.advance((SESSION_MAX_AGE_S - 60) * 1000);
    expect(await refreshClaims(c)).not.toBeNull();
    clock.advance(120 * 1000);
    expect(await refreshClaims(c)).toBeNull();
  });

  it("kills demo sessions as soon as DEMO_USERS is switched off", async () => {
    process.env.DEMO_USERS = "1";
    const { findUser } = await import("../users");
    const demo = (await findUser("admin@ledgerline.demo"))!;
    const c = initialClaims(demo);
    expect(await refreshClaims(c)).not.toBeNull();
    delete process.env.DEMO_USERS;
    expect(await refreshClaims(c)).toBeNull();
  });

  it("switches the active org only into orgs the user belongs to (never trusts the client)", async () => {
    const u = (await createUser({ email: "e@corp.io", name: "E", password: "p-unique-9876", role: "clerk" }))!;
    const other = (await createUser({ email: "f@corp.io", name: "F", password: "p-unique-9876", role: "clerk" }))!;
    const [mine] = await listMemberships(u.id);
    const [theirs] = await listMemberships(other.id);
    const c0 = (await refreshClaims(claimsOf(u)))!;
    // an org the user is NOT in is ignored; the active org stays
    expect((await refreshClaims(c0, theirs.orgId))?.activeOrgId).toBe(mine.orgId);
    expect((await refreshClaims(c0, "not-a-uuid"))?.activeOrgId).toBe(mine.orgId);
    expect((await refreshClaims(c0, { $ne: null }))?.activeOrgId).toBe(mine.orgId);
    // a forged activeOrgId already inside the token is not trusted either
    expect((await refreshClaims({ ...c0, activeOrgId: theirs.orgId, orgRole: "owner" }))?.activeOrgId).toBe(mine.orgId);
    // add a second membership: now switching works, with the role from the membership
    const [org2] = await getDb().insert(organizations).values({ name: "Second", slug: "second-org" }).returning();
    await getDb().insert(memberships).values({ orgId: org2.id, userId: u.id, role: "member" });
    expect(await refreshClaims(c0, org2.id)).toMatchObject({ activeOrgId: org2.id, orgRole: "member" });
    // losing the membership falls back to the first one
    await getDb().delete(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.orgId, org2.id)));
    expect((await refreshClaims({ ...c0, activeOrgId: org2.id }))?.activeOrgId).toBe(mine.orgId);
  });
});

describe("password change route", () => {
  useTempCwd("auth-pw-");

  it("rotates tokenVersion: other sessions die, the caller gets a working new JWT cookie", async () => {
    const { POST } = await import("@/app/api/auth/password/route");
    const u = (await createUser({ email: "pw@corp.io", name: "Pw", password: "old-passphrase-12", role: "clerk" }))!;
    const oldClaims = claimsOf(u);
    actor = { userId: u.id, email: u.email, name: u.name, orgId: "x", orgRole: "owner", role: "clerk" };
    const res = await POST(
      new NextRequest("http://localhost/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ currentPassword: "old-passphrase-12", newPassword: "fresh-passphrase-88" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await refreshClaims(oldClaims)).toBeNull();
    const cookie = (res as NextResponse).cookies.get(SESSION_COOKIE)!.value;
    const jwt = await decode({ token: cookie, secret: authSecret(), salt: SESSION_COOKIE });
    expect(jwt?.tokenVersion).toBe(1);
    expect(await refreshClaims(jwt as never)).toMatchObject({ userId: u.id });
    // a wrong current password is refused and does not bump anything
    const bad = await POST(
      new NextRequest("http://localhost/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ currentPassword: "nope-nope-nope", newPassword: "another-pass-9911" }),
      }),
    );
    expect(bad.status).toBe(400);
    expect(await refreshClaims(jwt as never)).not.toBeNull();
  });
});
