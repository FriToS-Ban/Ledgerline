import { eq } from "drizzle-orm";
import { DEFAULT_POLICY, type Policy } from "@/lib/invoice/schema";
import type { HistoricalInvoice, OpenPo } from "@/lib/invoice/match";
import type { FxRateRow } from "@/lib/invoice/fx";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

export async function loadPolicy(): Promise<Policy> {
  const db = getDb();
  const rows = await db.select().from(t.policyRules);
  const policy = { ...DEFAULT_POLICY };
  for (const row of rows) {
    const key = row.key as keyof Policy;
    if (key in policy) (policy[key] as number) = Number(row.value);
  }
  return policy;
}

export async function loadOpenPos(): Promise<OpenPo[]> {
  const db = getDb();
  const pos = await db.select().from(t.purchaseOrders);
  const vendors = await db.select().from(t.vendors);
  const matched = await db.select().from(t.matches);
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

export async function loadHistory(): Promise<HistoricalInvoice[]> {
  const db = getDb();
  const invoices = await db.select().from(t.invoices);
  const vendors = await db.select().from(t.vendors);
  const lines = await db.select().from(t.invoiceLines);
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

export async function loadFx(): Promise<FxRateRow[]> {
  const db = getDb();
  const rows = await db.select().from(t.fxRates);
  return rows.map((r) => ({
    base: r.base,
    quote: r.quote,
    rate: r.rate,
    asOf: r.asOf,
    source: r.source as FxRateRow["source"],
  }));
}

export async function vendorApproved(name: string): Promise<{ id: string | null; approved: boolean }> {
  const db = getDb();
  const rows = await db.select().from(t.vendors);
  const n = name.toLowerCase();
  const hit = rows.find(
    (v) => v.name.toLowerCase() === n || v.legalName.toLowerCase() === n || n.includes(v.name.toLowerCase()),
  );
  return { id: hit?.id ?? null, approved: hit?.approved ?? false };
}

export async function loadCorrections(fingerprint: string) {
  const db = getDb();
  const rows = await db.select().from(t.decisionCorrections);
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
