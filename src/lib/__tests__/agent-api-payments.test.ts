import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { seedDatabase } from "@/lib/db/seed";
import { makeMember, makeOrg } from "@/test/orgs";
import { useTempCwd } from "@/lib/auth/__tests__/helpers";

const session = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("@/auth", () => ({ auth: async () => session.current }));

type Member = Awaited<ReturnType<typeof makeMember>>;
const as = (m: Member | null) => {
  session.current = m && { userId: m.userId, activeOrgId: m.orgId, orgRole: m.orgRole, user: { email: m.email, name: m.email } };
};
const req = (p: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${p}`, {
    method,
    headers: { ...(body !== undefined && { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const today = () => new Date().toISOString().slice(0, 10);

async function newKey(owner: Member, name = "agent") {
  const { POST } = await import("@/app/api/integrations/keys/route");
  as(owner);
  const res = await POST(req("/api/integrations/keys", "POST", { name }));
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; key: string; prefix: string };
}

async function submit(key: string, body: unknown) {
  const { POST } = await import("@/app/api/v1/invoices/route");
  as(null); // the agent API never uses a session
  return POST(req("/api/v1/invoices", "POST", body, { authorization: `Bearer ${key}` }));
}

const meridianInvoice = (number: string, bank?: { accountNumber: string; routingNumber: string }) => ({
  externalId: `run-${number}`,
  vendorName: "Meridian Facilities",
  invoiceNumber: number,
  invoiceDate: today(),
  currency: "USD",
  total: 2450,
  poNumbers: ["PO-7740"],
  lineItems: [{ description: "Q4 janitorial services", amount: 2450 }],
  ...(bank && { bankDetails: bank }),
});

describe("agent API: keys, submit, decide, tenancy", () => {
  let org = "";
  let owner: Member, admin: Member, member: Member;
  let key = "";
  beforeAll(async () => {
    org = await makeOrg();
    owner = await makeMember(org, "owner");
    admin = await makeMember(org, "admin");
    member = await makeMember(org, "member");
    await seedDatabase(org, { pdfs: false });
    key = (await newKey(owner)).key;
  });

  it("only owners/admins manage keys, and the key is shown once (only its hash is stored)", async () => {
    const { POST, GET } = await import("@/app/api/integrations/keys/route");
    as(member);
    expect((await POST(req("/api/integrations/keys", "POST", { name: "x" }))).status).toBe(403);
    as(admin);
    const list = (await (await GET()).json()) as { prefix: string }[];
    expect(list.length).toBeGreaterThan(0);
    expect(JSON.stringify(list)).not.toContain(key);
    const [row] = await getDb().select().from(t.apiKeys).where(eq(t.apiKeys.orgId, org));
    expect(row.keyHash).not.toContain(key.slice(8));
    expect(key.startsWith(row.prefix)).toBe(true);
  });

  it("rejects missing, malformed and unknown keys", async () => {
    const { POST } = await import("@/app/api/v1/invoices/route");
    expect((await POST(req("/api/v1/invoices", "POST", meridianInvoice("X-1")))).status).toBe(401);
    expect((await submit("ll_live_not-a-real-key-at-all-0000000", meridianInvoice("X-1"))).status).toBe(401);
    expect((await submit("sk_wrong", meridianInvoice("X-1"))).status).toBe(401);
  });

  it("holds an invoice whose bank account differs from the verified one, and explains what to do", async () => {
    const res = await submit(key, meridianInvoice("MF-9001", { accountNumber: "7712004431", routingNumber: "026009593" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ status: "needs_review", externalId: "run-MF-9001", decision: { action: "hold", needsHuman: true } });
    expect(body.decision.reasons.join(" ")).toMatch(/Bank details changed/);
    expect(body.decision.checklist[0]).toMatch(/phone number from your own records/);
    expect(JSON.stringify(body)).not.toContain("7712004431"); // only masked account numbers leave the server
    expect(res.headers.get("location")).toContain(`/api/v1/invoices/${body.id}`);
  });

  it("releases the same invoice when it pays the verified account, with due date and discount", async () => {
    const res = await submit(key, meridianInvoice("MF-9002", { accountNumber: "4839201928", routingNumber: "021000021" }));
    const body = await res.json();
    expect(body.decision).toMatchObject({ action: "release", needsHuman: false });
    expect(body.payment.payTo).toBe("…1928");
    expect(body.payment.discount).toMatchObject({ pct: 0.02 });
    expect(body.payment.dueDate > today()).toBe(true);
  });

  it("validates input and returns field-level issues", async () => {
    const res = await submit(key, { vendorName: "", invoiceNumber: "A", invoiceDate: "05/11/2026", total: "lots" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(["vendorName", "invoiceDate", "total"]));
  });

  it("reads a decision back, but never across workspaces", async () => {
    const created = await (await submit(key, meridianInvoice("MF-9003", { accountNumber: "4839201928", routingNumber: "021000021" }))).json();
    const { GET } = await import("@/app/api/v1/invoices/[id]/route");
    const mine = await GET(req(`/api/v1/invoices/${created.id}`, "GET", undefined, { authorization: `Bearer ${key}` }), params(created.id));
    expect(mine.status).toBe(200);
    expect((await mine.json()).invoiceNumber).toBe("MF-9003");

    const otherOrg = await makeOrg();
    const otherOwner = await makeMember(otherOrg, "owner");
    const otherKey = (await newKey(otherOwner, "other")).key;
    const theirs = await GET(req(`/api/v1/invoices/${created.id}`, "GET", undefined, { authorization: `Bearer ${otherKey}` }), params(created.id));
    expect(theirs.status).toBe(404);
  });

  it("accepts a PDF upload and reads it with the real extractor", async () => {
    const { POST } = await import("@/app/api/v1/invoices/route");
    const form = new FormData();
    const pdf = fs.readFileSync(path.join(__dirname, "../../../public/demos/partial.pdf"));
    form.set("file", new File([pdf], "partial.pdf", { type: "application/pdf" }));
    form.set("externalId", "inbox-1");
    const res = await POST(new NextRequest("http://localhost/api/v1/invoices", { method: "POST", body: form, headers: { authorization: `Bearer ${key}` } }));
    expect([201, 202]).toContain(res.status);
    const body = await res.json();
    expect(body).toMatchObject({ invoiceNumber: "INV-P-2401", vendor: "Apex Industrial Supply", total: 12400, externalId: "inbox-1" });
  });

  it("stops working the moment a key is revoked", async () => {
    const k = await newKey(owner, "short-lived");
    const { DELETE } = await import("@/app/api/integrations/keys/[id]/route");
    as(owner);
    expect((await DELETE(req(`/api/integrations/keys/${k.id}`, "DELETE"), params(k.id))).status).toBe(200);
    expect((await submit(k.key, meridianInvoice("MF-9004"))).status).toBe(401);
  });

  it("rate-limits each key", async () => {
    const { takeRateLimit, API_RATE_LIMIT_PER_MIN } = await import("@/lib/api-keys");
    const now = Date.now();
    for (let i = 0; i < API_RATE_LIMIT_PER_MIN; i++) expect(takeRateLimit("k-rl", now).ok).toBe(true);
    const over = takeRateLimit("k-rl", now);
    expect(over.ok).toBe(false);
    expect(over.retryAfter).toBeGreaterThan(0);
    expect(takeRateLimit("k-rl", now + 61_000).ok).toBe(true);
  });
});

describe("payments: batches pay the verified account only, once", () => {
  let org = "";
  let owner: Member, admin: Member, member: Member;
  let key = "";
  beforeAll(async () => {
    org = await makeOrg();
    owner = await makeMember(org, "owner");
    admin = await makeMember(org, "admin");
    member = await makeMember(org, "member");
    await seedDatabase(org, { pdfs: false });
    key = (await newKey(owner)).key;
  });

  const payables = async () => {
    const { GET } = await import("@/app/api/payments/route");
    as(admin);
    return (await (await GET()).json()) as { payables: { invoiceId: string; invoiceNumber: string; payable: boolean; blocker: string | null; amount: number; payTo: string | null }[] };
  };

  it("lists released invoices with pay-to status; an unverified vendor cannot be paid", async () => {
    const ok = await (await submit(key, meridianInvoice("MF-7001", { accountNumber: "4839201928", routingNumber: "021000021" }))).json();
    expect(ok.decision.action).toBe("release");
    // Apex has no verified bank account in the demo book.
    await getDb().update(t.purchaseOrders).set({ amount: 40000 }).where(and(eq(t.purchaseOrders.orgId, org), eq(t.purchaseOrders.id, "po-31000")));
    const apex = await (
      await submit(key, { vendorName: "Apex Industrial Supply", invoiceNumber: "INV-P-7777", invoiceDate: today(), total: 1000, poNumbers: ["PO-31000"] })
    ).json();
    expect(apex.decision.action).toBe("release_partial"); // progressive billing against a larger PO
    const p = await payables();
    expect(p.payables.find((r) => r.invoiceNumber === "MF-7001")).toMatchObject({ payable: true, payTo: "…1928" });
    expect(p.payables.find((r) => r.invoiceNumber === "INV-P-7777")).toMatchObject({ payable: false, blocker: "No verified bank account on file" });
  });

  it("members cannot create batches; unpayable invoices are refused", async () => {
    const { POST } = await import("@/app/api/payments/batches/route");
    const p = await payables();
    const apex = p.payables.find((r) => r.invoiceNumber === "INV-P-7777")!;
    as(member);
    expect((await POST(req("/api/payments/batches", "POST", { invoiceIds: [apex.invoiceId] }))).status).toBe(403);
    as(admin);
    const res = await POST(req("/api/payments/batches", "POST", { invoiceIds: [apex.invoiceId] }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/No verified bank account/);
  });

  it("creates a batch whose bank file pays the vendor-master account and takes the open discount", async () => {
    const { POST } = await import("@/app/api/payments/batches/route");
    const { GET: FILE } = await import("@/app/api/payments/batches/[id]/file/route");
    const p = await payables();
    const mf = p.payables.find((r) => r.invoiceNumber === "MF-7001")!;
    as(admin);
    const res = await POST(req("/api/payments/batches", "POST", { invoiceIds: [mf.invoiceId] }));
    expect(res.status).toBe(201);
    const batch = await res.json();
    expect(batch).toMatchObject({ count: 1, currency: "USD", total: 2401 }); // 2% early-payment discount on 2450
    const file = await (await FILE(req(`/api/payments/batches/${batch.id}/file`), params(batch.id))).text();
    expect(file).toContain("4839201928");
    expect(file).toContain("021000021");
    expect(file).toContain("2401.00");
    expect(file.split("\r\n")[0]).toMatch(/^payment_ref,beneficiary_name,account_number/);

    // the same invoice cannot go into a second batch
    const again = await POST(req("/api/payments/batches", "POST", { invoiceIds: [mf.invoiceId] }));
    expect(again.status).toBe(409);
    expect((await payables()).payables.some((r) => r.invoiceId === mf.invoiceId)).toBe(false);

    // the bank file never changes, even if the vendor's account is changed afterwards
    await getDb().update(t.vendors).set({ bankAccount: "1111111111" }).where(and(eq(t.vendors.orgId, org), eq(t.vendors.id, "v-meridian")));
    expect(await (await FILE(req(`/api/payments/batches/${batch.id}/file`), params(batch.id))).text()).toBe(file);
    await getDb().update(t.vendors).set({ bankAccount: "4839201928" }).where(and(eq(t.vendors.orgId, org), eq(t.vendors.id, "v-meridian")));

    const { POST: SETTLE } = await import("@/app/api/payments/batches/[id]/route");
    expect((await SETTLE(req(`/api/payments/batches/${batch.id}`, "POST", { action: "paid" }), params(batch.id))).status).toBe(200);
    expect((await SETTLE(req(`/api/payments/batches/${batch.id}`, "POST", { action: "cancel" }), params(batch.id))).status).toBe(409);
    const [inv] = await getDb().select().from(t.invoices).where(and(eq(t.invoices.orgId, org), eq(t.invoices.id, mf.invoiceId)));
    expect(inv.paidAt).toBeTruthy();
    expect(inv.paymentRef).toBe(batch.reference);
  });

  it("refuses a near-duplicate of an invoice already released (same vendor, amount and date)", async () => {
    const dup = await (await submit(key, meridianInvoice("MF-7002", { accountNumber: "4839201928", routingNumber: "021000021" }))).json();
    expect(dup.decision.action).toBe("hold");
    expect(dup.decision.reasons.join(" ")).toMatch(/duplicate/i);
  });

  it("cancelling a batch puts its invoices back on the payable list", async () => {
    const created = await (
      await submit(key, {
        vendorName: "Northwind Logistics",
        invoiceNumber: "NW-7003",
        invoiceDate: today(),
        total: 5380,
        poNumbers: ["PO-4410"],
        bankDetails: { accountNumber: "3302118845", routingNumber: "011000015" },
      })
    ).json();
    expect(created.decision.action).toBe("release");
    const { POST } = await import("@/app/api/payments/batches/route");
    as(owner);
    const batch = await (await POST(req("/api/payments/batches", "POST", { invoiceIds: [created.id] }))).json();
    const { POST: SETTLE } = await import("@/app/api/payments/batches/[id]/route");
    expect((await SETTLE(req(`/api/payments/batches/${batch.id}`, "POST", { action: "cancel" }), params(batch.id))).status).toBe(200);
    expect((await payables()).payables.some((r) => r.invoiceId === created.id)).toBe(true);
  });
});

describe("vendor bank details are owner-only, verified and audited", () => {
  let org = "";
  let owner: Member, admin: Member;
  beforeAll(async () => {
    org = await makeOrg();
    owner = await makeMember(org, "owner");
    admin = await makeMember(org, "admin");
    await seedDatabase(org, { pdfs: false });
  });
  const patch = async (who: Member, body: unknown) => {
    const { PATCH } = await import("@/app/api/vendors/[id]/route");
    as(who);
    return PATCH(req("/api/vendors/v-apex", "PATCH", body), params("v-apex"));
  };

  it("an admin may edit terms but not bank details", async () => {
    expect((await patch(admin, { paymentTerms: "Net 45" })).status).toBe(200);
    expect((await patch(admin, { bankAccount: "1234567890", bankCode: "021000021", verification: "call-back to number on file" })).status).toBe(403);
  });

  it("an owner must say how the change was verified, and invalid codes are refused", async () => {
    expect((await patch(owner, { bankAccount: "1234567890", bankCode: "021000021" })).status).toBe(400);
    expect((await patch(owner, { bankAccount: "1234567890", bankCode: "123456789", verification: "call-back to number on file" })).status).toBe(400);
    expect((await patch(owner, { taxId: "05AADCD4946L1ZH" })).status).toBe(400); // bad GSTIN checksum
  });

  it("records who changed it, how it was verified, and only masked numbers", async () => {
    expect((await patch(owner, { bankAccount: "1234567890", bankCode: "021000021", verification: "called +1 555 0100 from vendor file" })).status).toBe(200);
    const [audit] = await getDb()
      .select()
      .from(t.auditEvents)
      .where(and(eq(t.auditEvents.orgId, org), eq(t.auditEvents.step, "vendor-bank-change")));
    const payload = JSON.parse(audit.payload);
    expect(payload.by).toBe(owner.email);
    expect(payload.bank.to).toContain("…7890");
    expect(audit.payload).not.toContain("1234567890");
    const { GET } = await import("@/app/api/vendors/route");
    as(admin);
    const list = await (await GET()).text();
    expect(list).not.toContain("1234567890");
    expect(list).toContain("…7890");
  });
});

describe("webhooks: SSRF-safe, signed, retried", () => {
  useTempCwd("ll-webhooks-"); // the signing-secret key derives from the dev auth secret written to cwd
  let org = "";
  let owner: Member;
  let key = "";
  beforeAll(async () => {
    org = await makeOrg();
    owner = await makeMember(org, "owner");
    await seedDatabase(org, { pdfs: false });
    key = (await newKey(owner)).key;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refuses non-https and private-network targets", async () => {
    const { POST } = await import("@/app/api/integrations/webhooks/route");
    as(owner);
    for (const url of ["http://93.184.215.14/x", "https://localhost/x", "https://10.0.0.5/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "https://user:pw@93.184.215.14/x", "nope"]) {
      const res = await POST(req("/api/integrations/webhooks", "POST", { url }));
      expect(res.status, url).toBe(400);
    }
  });

  it("delivers a signed invoice.decided event that verifies with the secret", async () => {
    const { POST } = await import("@/app/api/integrations/webhooks/route");
    as(owner);
    const created = await (await POST(req("/api/integrations/webhooks", "POST", { url: "https://93.184.215.14/hooks", events: ["invoice.decided"] }))).json();
    expect(created.secret).toMatch(/^whsec_/);
    const [row] = await getDb().select().from(t.webhooks).where(eq(t.webhooks.orgId, org));
    expect(row.secretEnc).not.toContain(created.secret);

    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string, init: RequestInit) => {
        calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) });
        return new Response("ok", { status: 200 });
      }),
    );
    const decided = await (await submit(key, meridianInvoice("MF-5001", { accountNumber: "7712004431", routingNumber: "026009593" }))).json();
    expect(calls).toHaveLength(1);
    const { headers, body } = calls[0];
    expect(headers["ledgerline-event"]).toBe("invoice.decided");
    const sig = Object.fromEntries(headers["ledgerline-signature"].split(",").map((p) => p.split("=")));
    expect(createHmac("sha256", created.secret).update(`${sig.t}.${body}`).digest("hex")).toBe(sig.v1);
    const event = JSON.parse(body);
    expect(event).toMatchObject({ type: "invoice.decided", data: { invoiceId: decided.id, recommendation: "escalate", needsHuman: true } });
    expect(event.data.failedRules).toContain("bank.changed");
  });

  it("records a failed delivery and queues a retry instead of losing the event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await submit(key, meridianInvoice("MF-5002", { accountNumber: "4839201928", routingNumber: "021000021" }));
    const deliveries = await getDb().select().from(t.webhookDeliveries).where(eq(t.webhookDeliveries.orgId, org));
    const failed = deliveries.find((d) => d.statusCode === 503)!;
    expect(failed.deliveredAt).toBeNull();
    expect(failed.error).toContain("503");
    const jobs = await getDb().select().from(t.jobs).where(and(eq(t.jobs.orgId, org), eq(t.jobs.kind, "deliver-webhook")));
    expect(jobs.some((j) => j.status === "queued" && j.runAt.getTime() > Date.now())).toBe(true);
  });
});

describe("cron endpoint", () => {
  it("is closed until CRON_SECRET is set, and checks it in constant time", async () => {
    const { GET } = await import("@/app/api/cron/tick/route");
    delete process.env.CRON_SECRET;
    expect((await GET(req("/api/cron/tick"))).status).toBe(503);
    process.env.CRON_SECRET = "a-very-long-cron-secret-123456";
    expect((await GET(req("/api/cron/tick", "GET", undefined, { authorization: "Bearer wrong" }))).status).toBe(401);
    const ok = await GET(req("/api/cron/tick", "GET", undefined, { authorization: "Bearer a-very-long-cron-secret-123456" }));
    expect(ok.status).toBe(200);
    delete process.env.CRON_SECRET;
  });
});
