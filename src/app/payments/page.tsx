"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/utils";

type Payable = {
  invoiceId: string;
  invoiceNumber: string | null;
  vendorName: string;
  amount: number;
  currency: string;
  dueDate: string | null;
  discount: { pct: number; byDate: string; saving: number } | null;
  payTo: string | null;
  payable: boolean;
  blocker: string | null;
};

type Batch = {
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

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "good" }) {
  return (
    <div className="border border-glass-border bg-glass p-4">
      <p className="text-xs uppercase tracking-wide text-text-mute">{label}</p>
      <p className={`mt-1 font-display text-2xl tabular ${tone === "warn" ? "text-danger-text" : tone === "good" ? "text-neon-cyan" : ""}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-text-mute">{sub}</p>}
    </div>
  );
}

export default function PaymentsPage() {
  const router = useRouter();
  const [data, setData] = useState<{ payables: Payable[]; batches: Batch[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/payments", { cache: "no-store" });
    setData(res.ok ? await res.json() : { payables: [], batches: [] });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch; state is set after the request resolves
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const p = data?.payables ?? [];
    const t0 = today();
    const week = inDays(7);
    const sum = (rows: Payable[]) => {
      const cur = new Set(rows.map((r) => r.currency));
      return cur.size === 1 ? money(rows.reduce((s, r) => s + r.amount, 0), [...cur][0]) : `${rows.length} invoices`;
    };
    const overdue = p.filter((r) => r.dueDate && r.dueDate < t0);
    const dueWeek = p.filter((r) => r.dueDate && r.dueDate >= t0 && r.dueDate <= week);
    const discounts = p.filter((r) => r.discount && r.discount.byDate >= t0);
    const blocked = p.filter((r) => !r.payable);
    return { overdue, dueWeek, discounts, blocked, sum };
  }, [data]);

  const pickedRows = (data?.payables ?? []).filter((r) => picked.has(r.invoiceId));

  async function createBatch() {
    setBusy("batch");
    const res = await fetch("/api/payments/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceIds: [...picked] }),
    });
    const body = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) return void toast.error(body?.error ?? "Could not create the batch.");
    toast.success(`Batch ${body.reference}: ${body.count} payments, ${money(body.total, body.currency)}. Upload the file to your bank.`);
    const link = document.createElement("a");
    link.href = `/api/payments/batches/${body.id}/file`;
    link.download = `${body.reference}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setPicked(new Set());
    void load();
  }

  async function settle(b: Batch, action: "paid" | "cancel") {
    if (action === "cancel" && !confirm(`Cancel ${b.reference}? Its invoices go back to the payable list.`)) return;
    setBusy(b.id);
    const res = await fetch(`/api/payments/batches/${b.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) return void toast.error(body?.error ?? "Could not update the batch.");
    toast.success(action === "paid" ? `${b.reference} marked paid.` : `${b.reference} cancelled.`);
    void load();
  }

  const currencies = new Set(pickedRows.map((r) => r.currency));

  return (
    <div className="space-y-10">
      <section>
        <h1 className="font-display max-w-[20ch] text-[2.6rem] leading-[1.1] sm:text-[3.2rem]">Payments.</h1>
        <p className="mt-4 max-w-[62ch] text-text-mute">
          Everything the guard (or a person) cleared, ordered by due date. A batch pays each vendor&apos;s verified account from the
          vendor list, never the account printed on an invoice, and takes early-payment discounts that are still open.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Summary">
        <Tile label="Overdue" value={summary.overdue.length ? summary.sum(summary.overdue) : "None"} sub={`${summary.overdue.length} invoices`} tone={summary.overdue.length ? "warn" : undefined} />
        <Tile label="Due in 7 days" value={summary.dueWeek.length ? summary.sum(summary.dueWeek) : "None"} sub={`${summary.dueWeek.length} invoices`} />
        <Tile
          label="Discounts to capture"
          value={summary.discounts.length ? money(summary.discounts.reduce((s, r) => s + (r.discount?.saving ?? 0), 0), summary.discounts[0].currency) : "None"}
          sub={summary.discounts.length ? `pay ${summary.discounts.length} early` : "no open early-pay terms"}
          tone={summary.discounts.length ? "good" : undefined}
        />
        <Tile label="Can't pay yet" value={String(summary.blocked.length)} sub="no verified bank account or vendor" tone={summary.blocked.length ? "warn" : undefined} />
      </section>

      <section aria-label="Ready to pay" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl">Ready to pay</h2>
          <Button onClick={() => void createBatch()} disabled={!picked.size || busy === "batch" || currencies.size > 1}>
            {busy === "batch"
              ? "Creating…"
              : currencies.size > 1
                ? "One currency per batch"
                : picked.size
                  ? `Create payment batch (${picked.size})`
                  : "Select invoices to pay"}
          </Button>
        </div>
        <div className="ledger overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th aria-label="Select" />
                <th>Vendor</th>
                <th>Invoice</th>
                <th className="num">Amount</th>
                <th>Due</th>
                <th>Pay to</th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <tr>
                  <td colSpan={6} className="text-text-mute">
                    Loading…
                  </td>
                </tr>
              ) : data.payables.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-text-mute">
                    Nothing approved and unpaid. Released invoices show up here.
                  </td>
                </tr>
              ) : (
                data.payables.map((r) => {
                  const overdue = r.dueDate && r.dueDate < today();
                  const discountOpen = r.discount && r.discount.byDate >= today();
                  return (
                    <tr key={r.invoiceId}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Pay ${r.invoiceNumber ?? r.invoiceId}`}
                          disabled={!r.payable}
                          checked={picked.has(r.invoiceId)}
                          onChange={(e) => {
                            const next = new Set(picked);
                            if (e.target.checked) next.add(r.invoiceId);
                            else next.delete(r.invoiceId);
                            setPicked(next);
                          }}
                        />
                      </td>
                      <td>{r.vendorName}</td>
                      <td>
                        <button className="underline-offset-4 hover:underline" onClick={() => router.push(`/cases/${r.invoiceId}`)}>
                          {r.invoiceNumber ?? r.invoiceId.slice(0, 8)}
                        </button>
                      </td>
                      <td className="num">{money(r.amount, r.currency)}</td>
                      <td>
                        <span className={overdue ? "text-danger-text" : ""}>{r.dueDate ?? "—"}</span>
                        {discountOpen && (
                          <span className="block text-xs text-neon-cyan">
                            save {money(r.discount!.saving, r.currency)} if paid by {r.discount!.byDate}
                          </span>
                        )}
                      </td>
                      <td>
                        {r.payable ? (
                          <span className="font-mono text-sm">{r.payTo} ✓</span>
                        ) : (
                          <span className="text-sm text-danger-text">{r.blocker}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Batches" className="space-y-3">
        <h2 className="font-display text-2xl">Payment batches</h2>
        <div className="ledger overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th className="num">Payments</th>
                <th className="num">Total</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data?.batches ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-text-mute">
                    No batches yet.
                  </td>
                </tr>
              ) : (
                data!.batches.map((b) => (
                  <tr key={b.id}>
                    <td className="font-mono text-sm">{b.reference}</td>
                    <td className="num">{b.count}</td>
                    <td className="num">{money(b.total, b.currency)}</td>
                    <td>{b.status === "exported" ? "Sent to bank, awaiting confirmation" : b.status}</td>
                    <td className="text-text-mute">
                      {b.createdAt.slice(0, 16).replace("T", " ")}
                      <span className="block text-xs">{b.createdBy}</span>
                    </td>
                    <td className="whitespace-nowrap">
                      <a className="mr-3 text-sm underline-offset-4 hover:underline" href={`/api/payments/batches/${b.id}/file`}>
                        Bank file
                      </a>
                      {b.status === "exported" && (
                        <>
                          <Button variant="outline" disabled={busy === b.id} onClick={() => void settle(b, "paid")}>
                            Mark paid
                          </Button>
                          <Button variant="ghost" disabled={busy === b.id} onClick={() => void settle(b, "cancel")}>
                            Cancel
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
