import { eq } from "drizzle-orm";
import { DEFAULT_POLICY, type Policy } from "@/lib/invoice/schema";
import type { HistoricalInvoice, OpenPo } from "@/lib/invoice/match";
import type { FxRateRow } from "@/lib/invoice/fx";
import type { VendorProfile } from "@/lib/invoice/rules";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

export async function loadPolicy(orgId: string): Promise<Policy> {
  const db = getDb();
  const rows = await db.select().from(t.policyRules).where(eq(t.policyRules.orgId, orgId));
  const policy = { ...DEFAULT_POLICY };
  for (const row of rows) {
    const key = row.key as keyof Policy;
    if (key in policy) {
      const n = Number(row.value);
      if (Number.isFinite(n) && n >= 0) (policy[key] as number) = n; // a corrupt value keeps the safe default
    }
  }
  return policy;
}

export async function loadOpenPos(orgId: string): Promise<OpenPo[]> {
  const db = getDb();
  const pos = await db.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.orgId, orgId));
  const vendors = await db.select().from(t.vendors).where(eq(t.vendors.orgId, orgId));
  const matched = await db.select().from(t.matches).where(eq(t.matches.orgId, orgId));
  const vmap = new Map(vendors.map((v) => [v.id, v]));
  const spent = new Map<string, number>();
  for (const m of matched) {
    if (m.status === "rejected") continue;
    spent.set(m.poId, (spent.get(m.poId) ?? 0) + m.amount);
  }
  return pos.map((p) => ({
    id: p.id,
    number: p.number,
    vendorId: p.vendorId,
    vendorName: vmap.get(p.vendorId)?.name ?? "Unknown",
    amount: p.amount,
    currency: p.currency,
    status: p.status as OpenPo["status"],
    issueDate: p.issueDate,
    description: p.description,
    alreadyMatched: spent.get(p.id) ?? 0,
    goodsReceived: p.goodsReceived,
  }));
}

export async function loadHistory(orgId: string): Promise<HistoricalInvoice[]> {
  const db = getDb();
  const invoices = await db.select().from(t.invoices).where(eq(t.invoices.orgId, orgId));
  const vendors = await db.select().from(t.vendors).where(eq(t.vendors.orgId, orgId));
  const lines = await db.select().from(t.invoiceLines).where(eq(t.invoiceLines.orgId, orgId));
  const vmap = new Map(vendors.map((v) => [v.id, v.name]));
  const lineText = new Map<string, string>();
  for (const l of lines) {
    lineText.set(l.invoiceId, `${lineText.get(l.invoiceId) ?? ""} ${l.description}`);
  }
  return invoices
    .filter((i) => ["approved", "auto_approve", "partial_approve"].includes(i.status))
    .map((i) => ({
      invoiceNumber: i.invoiceNumber ?? "",
      vendorName: vmap.get(i.vendorId ?? "") ?? "",
      amount: i.total ?? 0,
      date: i.invoiceDate,
      lineText: lineText.get(i.id) ?? "",
      status: i.status,
    }));
}

export async function loadFx(orgId: string): Promise<FxRateRow[]> {
  const db = getDb();
  const rows = await db.select().from(t.fxRates).where(eq(t.fxRates.orgId, orgId));
  return rows.map((r) => ({
    base: r.base,
    quote: r.quote,
    rate: r.rate,
    asOf: r.asOf,
    source: r.source as FxRateRow["source"],
  }));
}

/** The vendor-master record for an invoice's seller name, or null when it is not a known vendor. */
export async function loadVendorProfile(orgId: string, name: string): Promise<VendorProfile | null> {
  const db = getDb();
  const rows = await db.select().from(t.vendors).where(eq(t.vendors.orgId, orgId));
  const n = name.toLowerCase();
  const hit = rows.find(
    (v) => v.name.toLowerCase() === n || v.legalName.toLowerCase() === n || n.includes(v.name.toLowerCase()),
  );
  if (!hit) return null;
  return {
    id: hit.id,
    name: hit.name,
    approved: hit.approved,
    taxId: hit.taxId ?? null,
    bankAccount: hit.bankAccount ?? null,
    bankCode: hit.bankCode ?? null,
    paymentTerms: hit.paymentTerms ?? null,
  };
}

export async function vendorApproved(orgId: string, name: string): Promise<{ id: string | null; approved: boolean }> {
  const hit = await loadVendorProfile(orgId, name);
  return { id: hit?.id ?? null, approved: hit?.approved ?? false };
}

export async function loadCorrections(orgId: string, fingerprint: string) {
  const db = getDb();
  const rows = await db.select().from(t.decisionCorrections).where(eq(t.decisionCorrections.orgId, orgId));
  return rows.filter((r) => r.fingerprint === fingerprint || fingerprint.includes(r.fingerprint)).slice(0, 3);
}

export function situationFingerprint(opts: {
  vendor: string;
  method: string;
  rules: string[];
}): string {
  const vendor = opts.vendor.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const top = opts.rules.slice(0, 3).sort().join("+");
  return `${vendor}|${opts.method}|${top}`;
}

export { eq };
