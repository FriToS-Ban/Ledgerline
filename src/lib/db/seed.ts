import { eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import * as t from "./schema";
import { generateDemoPdfs } from "@/lib/pdf/generate";

const MASTER = {
  vendors: [
    { id: "v-apex", name: "Apex Industrial Supply", legalName: "Apex Industrial Supply Inc.", approved: true, currency: "USD", paymentTerms: "Net 30" },
    { id: "v-north", name: "Northwind Logistics", legalName: "Northwind Logistics Ltd.", approved: true, currency: "USD", paymentTerms: "Net 45" },
    { id: "v-helios", name: "Helios Components GmbH", legalName: "Helios Components GmbH", approved: true, currency: "EUR", paymentTerms: "Net 30" },
    { id: "v-meridian", name: "Meridian Facilities", legalName: "Meridian Facilities LLC", approved: true, currency: "USD", paymentTerms: "Net 30" },
  ],
  pos: [
    { id: "po-31000", number: "PO-31000", vendorId: "v-apex", amount: 31000, currency: "USD", status: "open", issueDate: "2026-09-01", description: "Stainless fastener kit blanket — progressive billing", goodsReceived: true },
    { id: "po-88021", number: "PO-88021", vendorId: "v-apex", amount: 8450, currency: "USD", status: "open", issueDate: "2026-10-02", description: "Stainless fasteners kit hex cap screws M8", goodsReceived: true },
    { id: "po-4410", number: "PO-4410", vendorId: "v-north", amount: 5380, currency: "USD", status: "open", issueDate: "2026-10-01", description: "Inbound logistics with estimated freight 180", goodsReceived: true },
    { id: "po-5519", number: "PO-5519", vendorId: "v-apex", amount: 4210, currency: "USD", status: "open", issueDate: "2026-10-10", description: "Metric hex nuts assortment 8-12mm", goodsReceived: true },
    { id: "po-eur-19", number: "PO-EUR-19", vendorId: "v-helios", amount: 10603.6, currency: "USD", status: "open", issueDate: "2026-10-05", description: "Precision bearings 6204-2RS", goodsReceived: true },
    { id: "po-7701", number: "PO-7701", vendorId: "v-meridian", amount: 3000, currency: "USD", status: "open", issueDate: "2026-10-08", description: "Q4 HVAC filter replacement", goodsReceived: true },
    { id: "po-7702", number: "PO-7702", vendorId: "v-meridian", amount: 1800, currency: "USD", status: "open", issueDate: "2026-10-08", description: "Emergency rooftop unit service", goodsReceived: true },
  ],
  poLines: [
    { id: "pl1", poId: "po-31000", description: "Fastener kit phase deliveries", amount: 31000 },
    { id: "pl2", poId: "po-4410", description: "Palletized inbound handling", amount: 5200 },
    { id: "pl3", poId: "po-4410", description: "Estimated shipping / freight", amount: 180 },
    { id: "pl4", poId: "po-7701", description: "HVAC filters", amount: 3000 },
    { id: "pl5", poId: "po-7702", description: "RTU service", amount: 1800 },
  ],
  historyInvoices: [
    { id: "inv-hist-1", demoId: "seed-partial-1", vendorId: "v-apex", invoiceNumber: "INV-P-1100", invoiceDate: "2026-09-20", currency: "USD", total: 12400, pdfPath: null, status: "approved", runId: null, createdAt: new Date("2026-09-20T12:00:00Z") },
    { id: "inv-hist-2", demoId: "seed-dup", vendorId: "v-apex", invoiceNumber: "INV-8842", invoiceDate: "2026-10-20", currency: "USD", total: 4210, pdfPath: null, status: "approved", runId: null, createdAt: new Date("2026-10-20T12:00:00Z") },
  ],
  historyMatches: [
    { id: "m1", invoiceId: "inv-hist-1", poId: "po-31000", amount: 12400, method: "explicit", status: "approved" },
    { id: "m2", invoiceId: "inv-hist-2", poId: "po-5519", amount: 4210, method: "explicit", status: "approved" },
  ],
  historyLines: [
    { id: "hl1", invoiceId: "inv-hist-2", description: "Metric hex nuts assortment 8–12mm", amount: 4210, poNumber: "PO-5519" },
  ],
  fx: [
    { id: "fx1", base: "EUR", quote: "USD", rate: 1.082, asOf: "2026-10-28", source: "seed" },
    { id: "fx2", base: "GBP", quote: "USD", rate: 1.31, asOf: "2026-10-28", source: "seed" },
    { id: "fx3", base: "USD", quote: "USD", rate: 1, asOf: "2026-01-01", source: "seed" },
    { id: "fx4", base: "INR", quote: "USD", rate: 0.012, asOf: "2026-10-01", source: "seed" },
  ],
  policy: [
    { id: "p1", key: "amountTolerancePct", value: "0.02", label: "Amount tolerance %", enabled: true },
    { id: "p2", key: "amountToleranceAbs", value: "50", label: "Amount tolerance $", enabled: true },
    { id: "p3", key: "duplicateAmountPct", value: "0.015", label: "Near-duplicate amount %", enabled: true },
    { id: "p4", key: "confidenceFloor", value: "0.7", label: "Extraction confidence floor", enabled: true },
    { id: "p5", key: "fxMaxAgeDays", value: "7", label: "FX rate max age (days)", enabled: true },
    { id: "p6", key: "approvalThreshold", value: "25000", label: "Approval threshold", enabled: true },
    { id: "p7", key: "impliedMatchAuto", value: "0.85", label: "Implied match auto-approve score", enabled: true },
    { id: "p8", key: "impliedMatchEscalate", value: "0.55", label: "Implied match candidate floor", enabled: true },
    { id: "p9", key: "dateWindowDays", value: "45", label: "PO date window (days)", enabled: true },
    { id: "p10", key: "duplicateDateWindowDays", value: "14", label: "Duplicate date window (days)", enabled: true },
  ],
};

const LIMIT_RULES = [
  { id: "p11", key: "clerkLimit", value: "5000", label: "Member approval limit ($)" },
  { id: "p12", key: "approverLimit", value: "100000", label: "Admin approval limit ($)" },
];

/** Gives an org its guard policy and FX table if it has none yet (new tenants); never touches existing rows. Idempotent. */
export async function seedOrgDefaults(orgId: string) {
  const db = getDb();
  const have = new Set(
    (await db.select({ key: t.policyRules.key }).from(t.policyRules).where(eq(t.policyRules.orgId, orgId))).map((r) => r.key),
  );
  const missing = [...MASTER.policy, ...LIMIT_RULES].filter((r) => !have.has(r.key)).map((r) => ({ ...r, orgId, enabled: true }));
  if (missing.length) await db.insert(t.policyRules).values(missing).onConflictDoNothing();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.fxRates).where(eq(t.fxRates.orgId, orgId));
  if (n === 0) await db.insert(t.fxRates).values(MASTER.fx.map((r) => ({ ...r, orgId }))).onConflictDoNothing();
}

/** Loads the demo vendor / PO book, history and policy into one org. Idempotent. */
export async function seedDatabase(orgId: string, opts: { pdfs?: boolean } = {}) {
  const db = getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.vendors)
    .where(eq(t.vendors.orgId, orgId));
  const empty = n === 0;
  const withOrg = <T extends object>(rows: T[]) => rows.map((r) => ({ ...r, orgId }));

  if (empty) {
    await db.insert(t.vendors).values(withOrg(MASTER.vendors)).onConflictDoNothing();
    await db.insert(t.purchaseOrders).values(withOrg(MASTER.pos)).onConflictDoNothing();
    await db.insert(t.poLines).values(withOrg(MASTER.poLines)).onConflictDoNothing();
    await db.insert(t.invoices).values(withOrg(MASTER.historyInvoices)).onConflictDoNothing();
    await db.insert(t.matches).values(withOrg(MASTER.historyMatches)).onConflictDoNothing();
    await db.insert(t.invoiceLines).values(withOrg(MASTER.historyLines)).onConflictDoNothing();
  }
  await seedOrgDefaults(orgId);

  if (opts.pdfs !== false) await generateDemoPdfs();
  return { seeded: empty };
}
