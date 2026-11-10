import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
const json = (p: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${p}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("policy changes are validated, owner-gated and audited", () => {
  let org = "";
  let owner: Member, admin: Member;
  beforeAll(async () => {
    org = await makeOrg();
    owner = await makeMember(org, "owner");
    admin = await makeMember(org, "admin");
    await seedDatabase(org, { pdfs: false });
  });
  const put = async (who: Member, key: string, value: unknown) => {
    const { PUT } = await import("@/app/api/policy/route");
    as(who);
    return PUT(json("/api/policy", "PUT", { key, value }));
  };
  const read = async (key: string) =>
    (await getDb().select().from(t.policyRules).where(and(eq(t.policyRules.orgId, org), eq(t.policyRules.key, key))))[0].value;

  it("an admin cannot touch limits or money controls; an owner can", async () => {
    for (const key of ["clerkLimit", "approverLimit", "approvalThreshold"]) {
      expect((await put(admin, key, "999999999")).status).toBe(403);
    }
    expect(await read("approverLimit")).toBe("100000");
    expect((await put(admin, "dateWindowDays", "30")).status).toBe(200);
    expect((await put(owner, "approverLimit", "250000")).status).toBe(200);
    expect(await read("approverLimit")).toBe("250000");
  });

  it("rejects non-numeric, negative, non-finite, out-of-range values and unknown keys", async () => {
    for (const v of ["abc", "-1", "NaN", "Infinity", "1e999", "", "  ", null, {}, "1,5"]) {
      expect((await put(owner, "approverLimit", v)).status).toBe(400);
    }
    expect((await put(owner, "confidenceFloor", "7")).status).toBe(400);
    expect((await put(owner, "notAKey", "1")).status).toBe(400);
    expect(await read("approverLimit")).toBe("250000");
  });

  it("writes an audit row with who, key, old and new", async () => {
    await put(owner, "clerkLimit", "7000");
    const rows = await getDb().select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, org), eq(t.auditEvents.step, "policy-change")));
    const last = rows.map((r) => JSON.parse(r.payload)).find((p) => p.key === "clerkLimit");
    expect(last).toMatchObject({ key: "clerkLimit", old: "5000", new: "7000" });
    expect(last.by).toContain(owner.email);
  });

  it("a corrupt stored limit blocks (0) instead of waving payments through", async () => {
    const { approvalLimit } = await import("@/lib/auth/users");
    await getDb().update(t.policyRules).set({ value: "abc" }).where(and(eq(t.policyRules.orgId, org), eq(t.policyRules.key, "approverLimit")));
    expect(await approvalLimit(org, "admin")).toBe(0);
  });
});

describe("resume is atomic and validated", () => {
  let org = "";
  let owner: Member;
  beforeAll(async () => {
    org = await makeOrg();
    owner = await makeMember(org, "owner");
    await seedDatabase(org, { pdfs: false });
  });

  async function suspendedCase() {
    const { createInvoiceRecord, processCase } = await import("@/lib/process-case");
    const id = await createInvoiceRecord({ orgId: org, demoId: "low-confidence", runId: "r" });
    await processCase({ orgId: org, invoiceId: id, demoId: "low-confidence" });
    return id;
  }
  const matchCount = async (id: string) =>
    (await getDb().select().from(t.matches).where(and(eq(t.matches.orgId, org), eq(t.matches.invoiceId, id)))).length;

  it("a second approval conflicts and does not duplicate matches", async () => {
    const { POST } = await import("@/app/api/invoices/resume/route");
    const id = await suspendedCase();
    as(owner);
    const body = { invoiceId: id, action: "override", override: "partial_approve" };
    expect((await POST(json("/api/invoices/resume", "POST", body))).status).toBe(200);
    const n = await matchCount(id);
    expect((await POST(json("/api/invoices/resume", "POST", body))).status).toBe(409);
    expect(await matchCount(id)).toBe(n);
  });

  it("concurrent approvals: exactly one wins", async () => {
    const { resumeCase, ResumeError } = await import("@/lib/process-case");
    const id = await suspendedCase();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => resumeCase({ orgId: org, invoiceId: id, action: "override", override: "partial_approve" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ResumeError);
    const n = await matchCount(id);
    expect(n).toBeLessThanOrEqual(3);
  });

  it("rejects an override outside the decision enum", async () => {
    const { POST } = await import("@/app/api/invoices/resume/route");
    const id = await suspendedCase();
    as(owner);
    expect((await POST(json("/api/invoices/resume", "POST", { invoiceId: id, action: "override", override: "pay_everything" }))).status).toBe(400);
    const [d] = await getDb().select().from(t.decisions).where(and(eq(t.decisions.orgId, org), eq(t.decisions.invoiceId, id)));
    expect(d.final).toBeNull();
  });

  it("a non-owner cannot release an invoice with an unknown amount", async () => {
    const { POST } = await import("@/app/api/invoices/resume/route");
    const admin = await makeMember(org, "admin");
    const id = await suspendedCase();
    const [d] = await getDb().select().from(t.decisions).where(and(eq(t.decisions.orgId, org), eq(t.decisions.invoiceId, id)));
    const trace = JSON.parse(d.trace);
    trace.extraction.total = null;
    if (trace.normalized) trace.normalized.comparableAmount = null;
    await getDb().update(t.decisions).set({ trace: JSON.stringify(trace) }).where(eq(t.decisions.id, d.id));
    as(admin);
    const res = await POST(json("/api/invoices/resume", "POST", { invoiceId: id, action: "approve" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("over-limit");
    as(owner);
    expect((await POST(json("/api/invoices/resume", "POST", { invoiceId: id, action: "approve" }))).status).toBe(200);
  });
});
