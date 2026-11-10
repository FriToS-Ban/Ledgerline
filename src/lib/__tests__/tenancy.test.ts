import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { seedDatabase } from "@/lib/db/seed";
import { makeMember, makeOrg } from "@/test/orgs";

const session = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("@/auth", () => ({ auth: async () => session.current }));

type Member = Awaited<ReturnType<typeof makeMember>>;
const as = (m: Member | null) => {
  session.current = m && { userId: m.userId, activeOrgId: m.orgId, orgRole: m.orgRole, user: { email: m.email, name: m.email } };
};
const req = (p: string, init?: RequestInit) => new NextRequest(`http://localhost${p}`, init as never);
const post = (p: string, body: unknown) =>
  req(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
/** Runs a demo case through the process route and waits until its decision exists (another drain may be in flight). */
async function createCase(org: string, demoId: string) {
  const { POST } = await import("@/app/api/invoices/process/route");
  const { drainQueue } = await import("@/lib/queue/worker");
  const res = await POST(post("/api/invoices/process", { demoId }));
  const invoiceId = (await res.json()).invoiceId as string;
  for (let i = 0; i < 100; i++) {
    if ((await getDb().select().from(t.decisions).where(and(eq(t.decisions.orgId, org), eq(t.decisions.invoiceId, invoiceId)))).length) break;
    await drainQueue(50, org);
    await new Promise((r) => setTimeout(r, 50));
  }
  return invoiceId;
}
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const EML = (messageId: string) => {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  return Buffer.from(
    [
      "From: Billing <billing@vendor.test>",
      "To: ap@company.test",
      "Subject: Invoice",
      `Message-ID: <${messageId}>`,
      "Content-Type: multipart/mixed; boundary=B",
      "",
      "--B",
      "Content-Type: text/plain",
      "",
      "attached",
      "--B",
      'Content-Type: application/pdf; name="inv.pdf"',
      'Content-Disposition: attachment; filename="inv.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      pdf.toString("base64"),
      "--B--",
      "",
    ].join("\r\n"),
  );
};

describe("tenant isolation (zamp-demo vs acme)", () => {
  const origCwd = process.cwd();
  let orgA = "";
  let orgB = "";
  let aOwner: Member, aMember: Member, bOwner: Member;
  let suspendedId = "";
  let fileInvoiceId = "";

  beforeAll(async () => {
    process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "ap-tenancy-")));
    for (const k of ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "NVIDIA_API_KEY"]) delete process.env[k];
    orgA = await makeOrg("zamp-demo");
    orgB = await makeOrg("acme");
    aOwner = await makeMember(orgA, "owner");
    aMember = await makeMember(orgA, "member");
    bOwner = await makeMember(orgB, "owner");
    await seedDatabase(orgA, { pdfs: false });

    as(aOwner);
    suspendedId = await createCase(orgA, "low-confidence");
    const { ingestRawEmail } = await import("@/lib/email/ingest");
    fileInvoiceId = (await ingestRawEmail(orgA, EML("a-1@vendor.test"))).invoiceIds[0];
  });
  afterAll(() => {
    process.chdir(origCwd);
    session.current = null;
    vi.unstubAllEnvs();
  });

  it("org A has a suspended case waiting for a person", async () => {
    const [d] = await getDb().select().from(t.decisions).where(eq(t.decisions.invoiceId, suspendedId));
    expect(d.orgId).toBe(orgA);
    expect(d.needsHuman && !d.final).toBe(true);
  });

  it("lists, metrics, accuracy, queue and review only show the caller's own org", async () => {
    const { GET: list } = await import("@/app/api/invoices/route");
    const { GET: review } = await import("@/app/api/review/route");
    const { GET: metrics } = await import("@/app/api/metrics/route");
    const { GET: accuracy } = await import("@/app/api/accuracy/route");
    const { GET: queue } = await import("@/app/api/queue/route");
    as(aOwner);
    expect((await (await list()).json()).map((i: { id: string }) => i.id)).toContain(suspendedId);
    expect((await (await review()).json()).length).toBeGreaterThan(0);
    as(bOwner);
    expect(await (await list()).json()).toEqual([]);
    expect(await (await review()).json()).toEqual([]);
    expect((await (await metrics()).json()).total).toBe(0);
    expect((await (await accuracy()).json()).scored).toBe(0);
    expect((await (await queue()).json()).recent).toEqual([]);
  });

  it("guessing an org A invoice id returns 404 for org B on read, audit (json and csv)", async () => {
    const { GET: one } = await import("@/app/api/invoices/[id]/route");
    const { GET: audit } = await import("@/app/api/invoices/[id]/audit/route");
    as(aOwner);
    expect((await one(req("/"), idCtx(suspendedId))).status).toBe(200);
    expect((await audit(req("/"), idCtx(suspendedId))).status).toBe(200);
    as(bOwner);
    expect((await one(req("/"), idCtx(suspendedId))).status).toBe(404);
    expect((await audit(req("/?format=json"), idCtx(suspendedId))).status).toBe(404);
    expect((await audit(req("/?format=csv"), idCtx(suspendedId))).status).toBe(404);
    expect((await one(req("/"), idCtx(fileInvoiceId))).status).toBe(404);
  });

  it("org B cannot approve, reject or override org A's case, and nothing changes", async () => {
    const { POST: resume } = await import("@/app/api/invoices/resume/route");
    as(bOwner);
    for (const body of [
      { invoiceId: suspendedId, action: "approve" },
      { invoiceId: suspendedId, action: "reject" },
      { invoiceId: suspendedId, action: "override", override: "auto_approve" },
    ]) {
      expect((await resume(post("/api/invoices/resume", body))).status).toBe(404);
    }
    const [d] = await getDb().select().from(t.decisions).where(eq(t.decisions.invoiceId, suspendedId));
    expect(d.final).toBeNull();
    const events = await getDb().select().from(t.auditEvents).where(eq(t.auditEvents.invoiceId, suspendedId));
    expect(events.every((e) => e.orgId === orgA)).toBe(true);
    const { resumeCase, processCase } = await import("@/lib/process-case");
    await expect(resumeCase({ orgId: orgB, invoiceId: suspendedId, action: "approve" })).rejects.toThrow();
    await expect(processCase({ orgId: orgB, invoiceId: suspendedId })).rejects.toThrow("not found");
  });

  it("stored files are served only to the owning org", async () => {
    const { GET: file } = await import("@/app/api/files/[name]/route");
    const ctx = { params: Promise.resolve({ name: fileInvoiceId }) };
    as(aMember);
    const ok = await file(req("/"), ctx);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(ok.headers.get("content-disposition")).toMatch(/^inline; filename="[A-Za-z0-9-]+\.pdf"$/);
    expect(new TextDecoder().decode(new Uint8Array(await ok.arrayBuffer()).slice(0, 4))).toBe("%PDF");
    as(bOwner);
    expect((await file(req("/"), ctx)).status).toBe(404);
  });

  it("policy: org B edits its own rules only and cannot touch org A's", async () => {
    const { GET, PUT } = await import("@/app/api/policy/route");
    const put = (value: string) => req("/api/policy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "approvalThreshold", value }) });
    as(bOwner);
    const rowsB = await (await GET()).json();
    expect(rowsB.every((r: { orgId: string }) => r.orgId === orgB)).toBe(true);
    expect((await PUT(put("1"))).status).toBe(200);
    const read = async (org: string) =>
      (await getDb().select().from(t.policyRules).where(and(eq(t.policyRules.orgId, org), eq(t.policyRules.key, "approvalThreshold"))))[0].value;
    expect(await read(orgB)).toBe("1");
    expect(await read(orgA)).toBe("25000");
    const unknown = req("/api/policy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "nope", value: "1" }) });
    expect((await PUT(unknown)).status).toBe(400);
  });

  it("master data: org B sees none of org A's vendors, POs or imports and its upload stays in B", async () => {
    const { GET, POST } = await import("@/app/api/master/import/route");
    as(aOwner);
    expect((await (await GET()).json()).vendors.length).toBeGreaterThan(0);
    as(bOwner);
    const before = await (await GET()).json();
    expect(before.vendors).toEqual([]);
    expect(before.pos).toEqual([]);
    expect(before.imports).toEqual([]);
    const form = new FormData();
    form.append("file", new File(["name,approved,currency\nApex Industrial Supply,no,USD\n"], "vendors.csv"));
    expect((await POST(req("/api/master/import", { method: "POST", body: form }))).status).toBe(200);
    const [apexA] = await getDb().select().from(t.vendors).where(and(eq(t.vendors.orgId, orgA), eq(t.vendors.id, "v-apex")));
    expect(apexA.approved).toBe(true);
    const [apexB] = await getDb().select().from(t.vendors).where(and(eq(t.vendors.orgId, orgB), eq(t.vendors.id, "v-apex-industrial-supply")));
    expect(apexB.approved).toBe(false);
  });

  it("intake list shows only the caller's emails", async () => {
    const { GET } = await import("@/app/api/intake/email/route");
    as(aOwner);
    expect((await (await GET()).json()).emails.length).toBe(1);
    as(bOwner);
    expect((await (await GET()).json()).emails).toEqual([]);
  });

  it("the data layer filters by org: loaders, jobs and exports", async () => {
    const domain = await import("@/lib/domain");
    expect((await domain.loadOpenPos(orgA)).length).toBeGreaterThan(0);
    expect(await domain.loadOpenPos(orgB)).toEqual([]);
    expect((await domain.loadHistory(orgB)).length).toBe(0);
    expect(await domain.vendorApproved(orgB, "Northwind Logistics")).toEqual({ id: null, approved: false });
    expect((await domain.vendorApproved(orgA, "Northwind Logistics")).approved).toBe(true);
    expect(await domain.loadCorrections(orgB, "x")).toEqual([]);
    const { computeMetrics } = await import("@/lib/metrics");
    expect((await computeMetrics(orgA)).total).toBeGreaterThan(0);
    expect((await computeMetrics(orgB)).total).toBe(0);
  });

  it("jobs: org B's worker lane never claims org A's job, and a spoofed payload org is ignored", async () => {
    const jobs = await import("@/lib/queue/jobs");
    const { runJob } = await import("@/lib/queue/handlers");
    const idA = await jobs.enqueue(orgA, "process-invoice", { invoiceId: "x" });
    expect(await jobs.claimNext(orgB)).toBeNull();
    const spoof = await jobs.enqueue(orgB, "process-invoice", { orgId: orgA, invoiceId: suspendedId });
    const claimed = await jobs.claimNext(orgB);
    expect(claimed?.id).toBe(spoof);
    await expect(runJob(claimed!)).rejects.toThrow("not found");
    await jobs.failJob({ ...claimed!, attempts: claimed!.maxAttempts }, new Error("x"));
    await jobs.completeJob({ orgId: orgB, id: idA });
    const [a] = await getDb().select().from(t.jobs).where(eq(t.jobs.id, idA));
    expect(a.status).toBe("queued");
    const { GET, POST } = await import("@/app/api/queue/route");
    as(bOwner);
    await POST(post("/api/queue", { retry: "all" }));
    expect((await (await GET()).json()).recent.every((j: { orgId: string }) => j.orgId === orgB)).toBe(true);
    await jobs.claimNext(orgA);
  });

  it("intake webhook: explicit org via x-intake-org, unknown org 404, no silent default in production", async () => {
    const { POST } = await import("@/app/api/intake/email/route");
    vi.stubEnv("INTAKE_SECRET", "s3cret-value");
    const send = (headers: Record<string, string>, msgId: string) =>
      POST(req("/api/intake/email", { method: "POST", headers: { "content-type": "message/rfc822", "x-intake-secret": "s3cret-value", ...headers }, body: EML(msgId) }));

    expect((await send({ "x-intake-org": "acme" }, "b-1@vendor.test")).status).toBe(202);
    const inB = await getDb().select().from(t.invoices).where(and(eq(t.invoices.orgId, orgB), eq(t.invoices.source, "email")));
    expect(inB).toHaveLength(1);
    expect(await getDb().select().from(t.emailMessages).where(and(eq(t.emailMessages.orgId, orgA), eq(t.emailMessages.messageId, "<b-1@vendor.test>")))).toHaveLength(0);

    expect((await send({ "x-intake-org": "nope" }, "b-2@vendor.test")).status).toBe(404);
    expect((await send({}, "a-2@vendor.test")).status).toBe(202);
    expect(await getDb().select().from(t.emailMessages).where(and(eq(t.emailMessages.orgId, orgA), eq(t.emailMessages.messageId, "<a-2@vendor.test>")))).toHaveLength(1);

    vi.stubEnv("NODE_ENV", "production");
    expect((await send({}, "a-3@vendor.test")).status).toBe(400);
    vi.stubEnv("SERVICE_ORG_SLUG", "acme");
    expect((await send({}, "b-3@vendor.test")).status).toBe(202);
    vi.unstubAllEnvs();

    vi.stubEnv("INTAKE_SECRET", "");
    expect((await send({ "x-intake-org": "acme" }, "b-4@vendor.test")).status).toBe(503);
    vi.stubEnv("INTAKE_SECRET", "s3cret-value");
    const bad = await POST(req("/api/intake/email", { method: "POST", headers: { "x-intake-secret": "wrong" }, body: EML("b-5@vendor.test") }));
    expect(bad.status).toBe(401);
    vi.unstubAllEnvs();
  });
});

describe("roles come from memberships.role", () => {
  const origCwd = process.cwd();
  let orgA = "";
  let owner: Member, admin: Member, member: Member, other: Member;
  let caseId = "";

  beforeAll(async () => {
    process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "ap-roles-")));
    orgA = await makeOrg();
    const orgB = await makeOrg();
    owner = await makeMember(orgA, "owner");
    admin = await makeMember(orgA, "admin");
    member = await makeMember(orgA, "member");
    other = await makeMember(orgB, "admin");
    await seedDatabase(orgA, { pdfs: false });
    as(owner);
    caseId = await createCase(orgA, "low-confidence");
  });
  afterAll(() => {
    process.chdir(origCwd);
    session.current = null;
  });

  it("a member cannot release a payment but can create cases and stop one", async () => {
    const { POST: resume } = await import("@/app/api/invoices/resume/route");
    const { POST: process_ } = await import("@/app/api/invoices/process/route");
    as(member);
    const denied = await resume(post("/api/invoices/resume", { invoiceId: caseId, action: "approve" }));
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("not-approver");
    expect((await resume(post("/api/invoices/resume", { invoiceId: caseId, action: "override", override: "auto_approve" }))).status).toBe(403);
    expect((await process_(post("/api/invoices/process", { demoId: "partial" }))).status).toBe(200);
    expect((await resume(post("/api/invoices/resume", { invoiceId: caseId, action: "reject" }))).status).toBe(200);
  });

  it("owners and admins can release; other orgs' admins cannot", async () => {
    const { POST: resume } = await import("@/app/api/invoices/resume/route");
    as(owner);
    const next = await createCase(orgA, "low-confidence");
    as(other);
    expect((await resume(post("/api/invoices/resume", { invoiceId: next, action: "approve" }))).status).toBe(404);
    as(admin);
    expect((await resume(post("/api/invoices/resume", { invoiceId: next, action: "approve" }))).status).toBe(200);
  });

  it("admin-only actions require owner or admin", async () => {
    const policy = await import("@/app/api/policy/route");
    const master = await import("@/app/api/master/import/route");
    const queue = await import("@/app/api/queue/route");
    const users = await import("@/app/api/auth/users/route");
    const friday = await import("@/app/api/demo/friday/route");
    const put = () => req("/api/policy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "dateWindowDays", value: "10" }) });
    for (const [who, expected] of [[member, 403], [admin, 200], [owner, 200]] as const) {
      as(who);
      expect((await policy.PUT(put())).status).toBe(expected);
      expect((await queue.POST(post("/api/queue", {}))).status).toBe(expected);
      expect((await users.GET()).status).toBe(expected);
      const form = new FormData();
      expect((await master.POST(req("/api/master/import", { method: "POST", body: form }))).status).toBe(expected === 200 ? 400 : 403);
    }
    as(null);
    expect((await friday.POST()).status).toBe(401);
    as(member);
    expect((await friday.POST()).status).toBe(403);
  });

  it("org admins list and change roles of their own members only", async () => {
    const users = await import("@/app/api/auth/users/route");
    const patch = (email: string, role: string) =>
      users.PATCH(req("/api/auth/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role }) }));
    as(admin);
    const list = (await (await users.GET()).json()).users as { email: string }[];
    expect(list.map((u) => u.email).sort()).toEqual([admin.email, member.email, owner.email].sort());
    expect((await patch(member.email, "admin")).status).toBe(200);
    expect((await patch(member.email, "member")).status).toBe(200);
    expect((await patch(other.email, "member")).status).toBe(404);
    expect((await patch(owner.email, "member")).status).toBe(403);
    expect((await patch(member.email, "owner")).status).toBe(403);
    as(other);
    expect((await patch(member.email, "admin")).status).toBe(404);
  });

  it("approval limits follow org role and the org's own policy", async () => {
    const { approvalLimit } = await import("@/lib/auth/users");
    const orgC = await makeOrg();
    await seedDatabase(orgC, { pdfs: false });
    await getDb().update(t.policyRules).set({ value: "10" }).where(and(eq(t.policyRules.orgId, orgC), eq(t.policyRules.key, "approverLimit")));
    expect(await approvalLimit(orgC, "admin")).toBe(10);
    expect(await approvalLimit(orgA, "admin")).toBe(100000);
    expect(await approvalLimit(orgA, "member")).toBe(5000);
    expect(await approvalLimit(orgA, "owner")).toBe(Infinity);
  });
});

describe("memberships and invites do not cross organizations", () => {
  it("an invite for org A makes a member of A only, and an A member cannot activate org B", async () => {
    const { createUser, findInvite, hashInviteToken, listMemberships } = await import("@/lib/auth/users");
    const { refreshClaims } = await import("@/lib/auth/token");
    const orgA = await makeOrg();
    const orgB = await makeOrg();
    
    await getDb().insert(t.invites).values({
      orgId: orgA,
      email: "guest@corp.io",
      role: "member",
      tokenHash: hashInviteToken("tok-123"),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    expect(await findInvite("tok-123", "other@corp.io")).toBeNull();
    const invite = (await findInvite("tok-123", "guest@corp.io"))!;
    const guest = (await createUser({ email: "guest@corp.io", name: "Guest", password: "p-unique-9876", role: "clerk", invite }))!;
    expect(await listMemberships(guest.id)).toMatchObject([{ orgId: orgA, orgRole: "member" }]);

    const base = { userId: guest.id, tokenVersion: guest.tokenVersion, authAt: Date.now() };
    expect((await refreshClaims({ ...base, activeOrgId: orgA }, orgB))?.activeOrgId).toBe(orgA);
    expect((await refreshClaims({ ...base, activeOrgId: orgB }))?.activeOrgId).toBe(orgA);
    expect((await refreshClaims({ ...base, activeOrgId: orgB }))?.orgRole).toBe("member");
  });
});
