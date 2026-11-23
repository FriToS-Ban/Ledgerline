import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { maskAccount } from "@/lib/invoice/bank";
import { dueFromTerms } from "@/lib/invoice/terms";
import type { PipelineTrace } from "@/lib/invoice/schema";
import { round2 } from "@/lib/utils";

/** Invoice statuses that mean "cleared to pay" (by the guard or by a person). */
export const PAYABLE_STATUSES = ["auto_approve", "partial_approve", "approved"];

export type Payable = {
  invoiceId: string;
  invoiceNumber: string | null;
  vendorId: string | null;
  vendorName: string;
  amount: number; // what to pay: the matched amount for a partial release
  currency: string;
  invoiceDate: string | null;
  dueDate: string | null;
  discount: { pct: number; byDate: string; saving: number } | null;
  payTo: string | null; // masked VERIFIED account from the vendor master
  payable: boolean;
  blocker: string | null;
};

export type BatchRow = {
  id: string;
  reference: string;
  currency: string;
  total: number;
  count: number;
  status: string;
  createdBy: string | null;
  createdAt: string;
  paidAt: string | null;
};

function payableAmount(inv: { total: number | null; status: string }, trace: PipelineTrace | null): number {
  if (inv.status === "partial_approve" && trace?.match.allocations.length) {
    return round2(trace.match.allocations.reduce((s, a) => s + a.allocatedAmount, 0));
  }
  return inv.total ?? 0;
}

/** Approved invoices not yet in a payment batch, with due dates, discounts and pay-to status. */
export async function listPayables(orgId: string): Promise<Payable[]> {
  const db = getDb();
  const [invoices, vendors, decisions] = await Promise.all([
    db
      .select()
      .from(t.invoices)
      .where(and(eq(t.invoices.orgId, orgId), inArray(t.invoices.status, PAYABLE_STATUSES), isNull(t.invoices.paymentBatchId), isNull(t.invoices.paidAt))),
    db.select().from(t.vendors).where(eq(t.vendors.orgId, orgId)),
    db.select({ invoiceId: t.decisions.invoiceId, trace: t.decisions.trace }).from(t.decisions).where(eq(t.decisions.orgId, orgId)),
  ]);
  const vmap = new Map(vendors.map((v) => [v.id, v]));
  const traces = new Map(decisions.map((d) => [d.invoiceId, d.trace]));
  return invoices
    .filter((i) => !i.demoId?.startsWith("seed-")) // seeded history was "paid" before the demo began
    .map((i) => {
      const v = i.vendorId ? vmap.get(i.vendorId) : undefined;
      let trace: PipelineTrace | null = null;
      try {
        const raw = traces.get(i.id);
        trace = raw ? (JSON.parse(raw) as PipelineTrace) : null;
      } catch {
        trace = null;
      }
      const amount = payableAmount(i, trace);
      const due = trace?.payment ?? null;
      const computed = due?.dueDate ? null : dueFromTerms(i.invoiceDate, v?.paymentTerms);
      const discountRaw = due?.discount ?? computed?.discount ?? null;
      const blocker = !v
        ? "Not a vendor in the vendor master"
        : !v.approved
          ? "Vendor is not approved"
          : !v.bankAccount
            ? "No verified bank account on file"
            : !(i.total ?? 0)
              ? "No amount"
              : null;
      return {
        invoiceId: i.id,
        invoiceNumber: i.invoiceNumber,
        vendorId: i.vendorId,
        vendorName: v?.name ?? trace?.extraction.vendorName ?? "Unknown vendor",
        amount,
        currency: i.currency ?? trace?.extraction.currency ?? "USD",
        invoiceDate: i.invoiceDate,
        dueDate: i.dueDate ?? due?.dueDate ?? computed?.dueDate ?? null,
        discount: discountRaw ? { ...discountRaw, saving: round2(amount * discountRaw.pct) } : null,
        payTo: v?.bankAccount ? maskAccount(v.bankAccount) : null,
        payable: !blocker,
        blocker,
      };
    })
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
}

export async function listBatches(orgId: string): Promise<BatchRow[]> {
  const rows = await getDb()
    .select()
    .from(t.paymentBatches)
    .where(eq(t.paymentBatches.orgId, orgId))
    .orderBy(desc(t.paymentBatches.createdAt))
    .limit(50);
  return rows.map((b) => ({
    id: b.id,
    reference: b.reference,
    currency: b.currency,
    total: b.total,
    count: b.count,
    status: b.status,
    createdBy: b.createdBy,
    createdAt: b.createdAt.toISOString(),
    paidAt: b.paidAt?.toISOString() ?? null,
  }));
}

export class PaymentError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
  }
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  // Quote everything that could break a row, and neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * Puts approved invoices into one payment batch and returns the bank upload file.
 * Money always goes to the VERIFIED account in the vendor master, never to whatever an invoice
 * printed; invoices without one cannot be batched. One currency per batch.
 */
export async function createBatch(opts: { orgId: string; invoiceIds: string[]; actorEmail: string; today?: string }) {
  const ids = [...new Set(opts.invoiceIds)].filter((x) => typeof x === "string").slice(0, 500);
  if (!ids.length) throw new PaymentError("pick at least one invoice", 400);
  const payables = (await listPayables(opts.orgId)).filter((p) => ids.includes(p.invoiceId));
  if (payables.length !== ids.length) throw new PaymentError("some invoices are not approved or are already in a batch", 409);
  const blocked = payables.find((p) => !p.payable);
  if (blocked) throw new PaymentError(`${blocked.invoiceNumber ?? blocked.invoiceId}: ${blocked.blocker}`, 409);
  const currencies = new Set(payables.map((p) => p.currency));
  if (currencies.size > 1) throw new PaymentError("a batch must be in one currency; make one batch per currency", 400);
  const currency = payables[0].currency;

  const db = getDb();
  const vendors = await db.select().from(t.vendors).where(eq(t.vendors.orgId, opts.orgId));
  const vmap = new Map(vendors.map((v) => [v.id, v]));
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const reference = `PAY-${today.replace(/-/g, "")}-${randomUUID().slice(0, 4).toUpperCase()}`;
  const header = "payment_ref,beneficiary_name,account_number,bank_code,amount,currency,invoice_number,vendor_id,due_date,value_date";
  const lines = payables.map((p, i) => {
    const v = vmap.get(p.vendorId!)!;
    // Take the early-payment discount when paying on or before its deadline.
    const takeDiscount = p.discount && today <= p.discount.byDate;
    const amount = takeDiscount ? round2(p.amount - p.discount!.saving) : p.amount;
    return {
      p,
      amount,
      row: [
        `${reference}-${String(i + 1).padStart(3, "0")}`,
        v.legalName || v.name,
        v.bankAccount,
        v.bankCode,
        amount.toFixed(2),
        currency,
        p.invoiceNumber,
        v.id,
        p.dueDate,
        today,
      ]
        .map(csvCell)
        .join(","),
    };
  });
  const file = [header, ...lines.map((l) => l.row)].join("\r\n") + "\r\n";
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  const batchId = randomUUID();

  await db.transaction(async (tx) => {
    // Claim the invoices atomically: a second click (or a second person) cannot batch them twice.
    const claimed = await tx
      .update(t.invoices)
      .set({ paymentBatchId: batchId })
      .where(and(eq(t.invoices.orgId, opts.orgId), inArray(t.invoices.id, ids), isNull(t.invoices.paymentBatchId), isNull(t.invoices.paidAt)))
      .returning({ id: t.invoices.id });
    if (claimed.length !== ids.length) throw new PaymentError("some invoices were batched by someone else just now", 409);
    await tx.insert(t.paymentBatches).values({
      orgId: opts.orgId,
      id: batchId,
      reference,
      currency,
      total,
      count: lines.length,
      status: "exported",
      file,
      createdBy: opts.actorEmail,
    });
    await tx.insert(t.auditEvents).values(
      lines.map((l) => ({
        orgId: opts.orgId,
        id: randomUUID(),
        invoiceId: l.p.invoiceId,
        step: "payment",
        status: "running",
        payload: JSON.stringify({ batch: reference, amount: l.amount, currency, payTo: l.p.payTo, by: opts.actorEmail }),
        at: new Date(),
      })),
    );
  });
  return { id: batchId, reference, total, count: lines.length, currency, file };
}

export async function batchFile(orgId: string, batchId: string) {
  const [b] = await getDb()
    .select({ file: t.paymentBatches.file, reference: t.paymentBatches.reference })
    .from(t.paymentBatches)
    .where(and(eq(t.paymentBatches.orgId, orgId), eq(t.paymentBatches.id, batchId)));
  return b ?? null;
}

/** Confirms the bank sent the money (status "paid") or cancels the batch (invoices become payable again). */
export async function settleBatch(opts: { orgId: string; batchId: string; action: "paid" | "cancel"; actorEmail: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const where = and(eq(t.paymentBatches.orgId, opts.orgId), eq(t.paymentBatches.id, opts.batchId));
    const [b] = await tx.select().from(t.paymentBatches).where(where).for("update");
    if (!b) throw new PaymentError("batch not found", 404);
    if (b.status !== "exported") throw new PaymentError(`batch is already ${b.status}`, 409);
    const invoices = await tx
      .select({ id: t.invoices.id })
      .from(t.invoices)
      .where(and(eq(t.invoices.orgId, opts.orgId), eq(t.invoices.paymentBatchId, opts.batchId)));
    const now = new Date();
    if (opts.action === "paid") {
      await tx.update(t.paymentBatches).set({ status: "paid", paidAt: now }).where(where);
      await tx
        .update(t.invoices)
        .set({ paidAt: now, paymentRef: b.reference })
        .where(and(eq(t.invoices.orgId, opts.orgId), eq(t.invoices.paymentBatchId, opts.batchId)));
    } else {
      await tx.update(t.paymentBatches).set({ status: "cancelled" }).where(where);
      await tx
        .update(t.invoices)
        .set({ paymentBatchId: null })
        .where(and(eq(t.invoices.orgId, opts.orgId), eq(t.invoices.paymentBatchId, opts.batchId)));
    }
    if (invoices.length) {
      await tx.insert(t.auditEvents).values(
        invoices.map((i) => ({
          orgId: opts.orgId,
          id: randomUUID(),
          invoiceId: i.id,
          step: "payment",
          status: opts.action === "paid" ? "success" : "skipped",
          payload: JSON.stringify({ batch: b.reference, action: opts.action, by: opts.actorEmail }),
          at: now,
        })),
      );
    }
    return { reference: b.reference, invoices: invoices.length, status: opts.action === "paid" ? "paid" : "cancelled" };
  });
}
