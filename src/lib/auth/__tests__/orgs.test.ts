import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { seedDatabase } from "@/lib/db/seed";
import { getStorage } from "@/lib/storage";
import { makeMember, makeOrg } from "@/test/orgs";

const session = vi.hoisted(() => ({ current: null as null | Record<string, unknown>, switched: [] as unknown[] }));
vi.mock("@/auth", () => ({
  auth: async () => session.current,
  unstable_update: async (d: unknown) => void session.switched.push(d),
}));

type Member = Awaited<ReturnType<typeof makeMember>>;
const as = (m: Member | null) => {
  session.current = m && { userId: m.userId, activeOrgId: m.orgId, orgRole: m.orgRole, user: { email: m.email, name: m.email } };
};
const req = (p: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${p}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function invite(by: Member, email: string, role = "member") {
  const { POST } = await import("@/app/api/orgs/current/invites/route");
  as(by);
  const res = await POST(req("/api/orgs/current/invites", "POST", { email, role }));
  return { res, body: res.status === 201 ? await res.json() : await res.json().catch(() => ({})) };
}
const tokenOf = (path: string) => path.replace("/invite/", "");
async function accept(as_: Member, token: string) {
  const { POST } = await import("@/app/api/invites/accept/route");
  as(as_);
  return POST(req("/api/invites/accept", "POST", { token }));
}

describe("workspace invites", () => {
  it("stores only a hash, binds to the email, and is single use", async () => {
    const org = await makeOrg();
    const owner = await makeMember(org, "owner");
    const guest = await makeMember(await makeOrg(), "owner", "guest@corp.io");
    const { res, body } = await invite(owner, "Guest@Corp.io", "admin");
    expect(res.status).toBe(201);
    const token = tokenOf(body.path);
    const rows = await getDb().select().from(t.invites).where(eq(t.invites.orgId, org));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toContain(token);
    expect(rows[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86400_000);
    expect(JSON.stringify(await (await (await import("@/app/api/orgs/current/invites/route")).GET()).json())).not.toContain(token);

    const ok = await accept(guest, token);
    expect(ok.status).toBe(200);
    expect(session.switched.at(-1)).toEqual({ activeOrgId: org });
    const [m] = await getDb().select().from(t.memberships).where(eq(t.memberships.userId, guest.userId));
    expect(m).toBeTruthy();
    const mine = await getDb().select().from(t.memberships).where(eq(t.memberships.orgId, org));
    expect(mine.find((x) => x.userId === guest.userId)?.role).toBe("admin");
    // used token fails, with the generic message
    const again = await accept(guest, token);
    expect(again.status).toBe(404);
    expect((await again.json()).error).toMatch(/not valid or has expired/);
  });

  it("refuses the wrong email and leaves the invite usable by the right one", async () => {
    const org = await makeOrg();
    const owner = await makeMember(org, "owner");
    const right = await makeMember(await makeOrg(), "owner", "right@corp.io");
    const wrong = await makeMember(await makeOrg(), "owner", "wrong@corp.io");
    const token = tokenOf((await invite(owner, "right@corp.io")).body.path);
    const bad = await accept(wrong, token);
    expect(bad.status).toBe(403);
    expect((await bad.json()).error).toMatch(/different email/);
    expect(await getDb().select().from(t.memberships).where(eq(t.memberships.orgId, org))).toHaveLength(1);
    expect((await accept(right, token)).status).toBe(200);
  });

  it("rejects expired, revoked and garbage tokens identically", async () => {
    const org = await makeOrg();
    const owner = await makeMember(org, "owner");
    const guest = await makeMember(await makeOrg(), "owner", "late@corp.io");
    const a = await invite(owner, "late@corp.io");
    await getDb().update(t.invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(t.invites.orgId, org));
    const expired = await accept(guest, tokenOf(a.body.path));

    const b = await invite(owner, "late@corp.io");
    const { DELETE } = await import("@/app/api/orgs/current/invites/[id]/route");
    as(owner);
    expect((await DELETE(req("/x", "DELETE"), ctx(b.body.invite.id))).status).toBe(200);
    const revoked = await accept(guest, tokenOf(b.body.path));
    const garbage = await accept(guest, "x".repeat(43));
    for (const r of [expired, revoked, garbage]) {
      expect(r.status).toBe(404);
      expect((await r.clone().json()).error).toBe("That invite is not valid or has expired.");
    }
    expect(await getDb().select().from(t.memberships).where(eq(t.memberships.userId, guest.userId))).toHaveLength(1);
  });

  it("org B cannot list or revoke org A's invites", async () => {
    const a = await makeMember(await makeOrg(), "owner");
    const b = await makeMember(await makeOrg(), "owner");
    const made = await invite(a, "x@corp.io");
    const { GET } = await import("@/app/api/orgs/current/invites/route");
    const { DELETE } = await import("@/app/api/orgs/current/invites/[id]/route");
    as(b);
    expect((await (await GET()).json()).invites).toEqual([]);
    expect((await DELETE(req("/x", "DELETE"), ctx(made.body.invite.id))).status).toBe(404);
    expect(await getDb().select().from(t.invites).where(eq(t.invites.orgId, a.orgId))).toHaveLength(1);
  });

  it("members cannot invite; admins cannot invite owners; existing members are refused", async () => {
    const org = await makeOrg();
    const owner = await makeMember(org, "owner");
    const admin = await makeMember(org, "admin");
    const member = await makeMember(org, "member");
    expect((await invite(member, "n@corp.io")).res.status).toBe(403);
    expect((await invite(admin, "n@corp.io", "owner")).res.status).toBe(403);
    expect((await invite(admin, "n@corp.io", "member")).res.status).toBe(201);
    expect((await invite(owner, member.email)).res.status).toBe(409);
    expect((await invite(owner, "not-an-email")).res.status).toBe(400);
  });
});

describe("workspace management", () => {
  it("members cannot rename or delete; admins can rename but not delete", async () => {
    const org = await makeOrg();
    const owner = await makeMember(org, "owner");
    const admin = await makeMember(org, "admin");
    const member = await makeMember(org, "member");
    const { PATCH, DELETE } = await import("@/app/api/orgs/current/route");
    as(member);
    expect((await PATCH(req("/x", "PATCH", { name: "Nope" }))).status).toBe(403);
    expect((await DELETE(req("/x", "DELETE", { confirmName: org }))).status).toBe(403);
    as(admin);
    expect((await PATCH(req("/x", "PATCH", { name: "Renamed Co" }))).status).toBe(200);
    expect((await DELETE(req("/x", "DELETE", { confirmName: "Renamed Co" }))).status).toBe(403);
    as(owner);
    expect((await DELETE(req("/x", "DELETE", { confirmName: "wrong" }))).status).toBe(400);
    const [o] = await getDb().select().from(t.organizations).where(eq(t.organizations.id, org));
    expect(o.name).toBe("Renamed Co");
  });

  it("admins cannot touch owners; last owner cannot be removed or leave", async () => {
    const org = await makeOrg();
    const owner = await makeMember(org, "owner");
    const admin = await makeMember(org, "admin");
    const { DELETE: removeRoute, PATCH: roleRoute } = await import("@/app/api/auth/users/route");
    as(admin);
    expect((await removeRoute(req("/x", "DELETE", { email: owner.email }))).status).toBe(403);
    expect((await roleRoute(req("/x", "PATCH", { email: owner.email, role: "member" }))).status).toBe(403);
    expect((await roleRoute(req("/x", "PATCH", { email: admin.email, role: "owner" }))).status).toBe(403);
    as(owner);
    expect((await removeRoute(req("/x", "DELETE", { email: owner.email }))).status).toBe(409);
    const { POST: leave } = await import("@/app/api/orgs/current/leave/route");
    expect((await leave()).status).toBe(409);
    expect((await removeRoute(req("/x", "DELETE", { email: admin.email }))).status).toBe(200);
    // the removed admin is never left without a workspace
    expect((await getDb().select().from(t.memberships).where(eq(t.memberships.userId, admin.userId))).length).toBe(1);
  });

  it("switching requires membership", async () => {
    const mine = await makeMember(await makeOrg(), "owner");
    const other = await makeOrg();
    const { POST } = await import("@/app/api/orgs/switch/route");
    as(mine);
    session.switched.length = 0;
    expect((await POST(req("/x", "POST", { orgId: other }))).status).toBe(403);
    expect(session.switched).toEqual([]);
    expect((await POST(req("/x", "POST", { orgId: mine.orgId }))).status).toBe(200);
  });

  it("creates a seeded workspace owned by the caller", async () => {
    const u = await makeMember(await makeOrg(), "member");
    const { POST } = await import("@/app/api/orgs/route");
    as(u);
    const res = await POST(req("/x", "POST", { name: "  Acme   Payables " }));
    expect(res.status).toBe(201);
    const { org } = await res.json();
    expect(org.name).toBe("Acme Payables");
    expect(org.slug).toMatch(/^acme-payables-[0-9a-f]{6}$/);
    const [m] = await getDb().select().from(t.memberships).where(eq(t.memberships.orgId, org.orgId));
    expect(m).toMatchObject({ userId: u.userId, role: "owner" });
    expect((await getDb().select().from(t.policyRules).where(eq(t.policyRules.orgId, org.orgId))).length).toBeGreaterThan(0);
    expect((await POST(req("/x", "POST", { name: "  " }))).status).toBe(400);
  });

  it("deleting a workspace removes its data and files, and nobody else's", async () => {
    const a = await makeMember(await makeOrg(), "owner");
    const orgB = await makeOrg();
    const b = await makeMember(orgB, "owner");
    const colleague = await makeMember(a.orgId, "member");
    await seedDatabase(a.orgId, { pdfs: false });
    await seedDatabase(orgB, { pdfs: false });
    const keyA = `org/${a.orgId}/f.pdf`;
    const keyB = `org/${orgB}/f.pdf`;
    await getStorage().put(keyA, new Uint8Array([1]), "application/pdf");
    await getStorage().put(keyB, new Uint8Array([1]), "application/pdf");
    const [inv] = await getDb().select().from(t.invoices).where(eq(t.invoices.orgId, a.orgId)).limit(1);
    await getDb().update(t.invoices).set({ pdfPath: keyA }).where(eq(t.invoices.orgId, a.orgId));
    const countB = async () => (await getDb().select().from(t.invoices).where(eq(t.invoices.orgId, orgB))).length;
    const before = await countB();
    expect(inv).toBeTruthy();

    const { DELETE } = await import("@/app/api/orgs/current/route");
    as(a);
    const [aOrg] = await getDb().select().from(t.organizations).where(eq(t.organizations.id, a.orgId));
    const res = await DELETE(req("/x", "DELETE", { confirmName: aOrg.name }));
    expect(res.status).toBe(200);
    for (const table of [t.invoices, t.vendors, t.policyRules, t.fxRates, t.memberships] as const) {
      expect(await getDb().select().from(table).where(eq(table.orgId, a.orgId))).toEqual([]);
    }
    expect(await getStorage().exists(keyA)).toBe(false);
    expect(await getStorage().exists(keyB)).toBe(true);
    expect(await countB()).toBe(before);
    expect(before).toBeGreaterThan(0);
    // both former members still have a workspace to fall back to; the other org is untouched
    for (const u of [a, colleague]) expect((await getDb().select().from(t.memberships).where(eq(t.memberships.userId, u.userId))).length).toBe(1);
    expect((await getDb().select().from(t.memberships).where(eq(t.memberships.userId, b.userId))).length).toBe(1);
  });
});
