"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";

type Metrics = {
  total: number;
  decided: number;
  outcome: { auto_approve: number; partial_approve: number; escalate: number; reject: number; processing: number };
  money: { cleared: number; held: number; blocked: number };
  waitingForPerson: number;
  duplicatesCaught: number;
  minutesSaved: number;
  assumptions: { manualMinutesPerInvoice: number };
  reasons: { id: string; label: string; count: number }[];
  queue: Record<string, number>;
};

type Row = {
  id: string;
  demoId: string | null;
  vendor: string | null;
  invoiceNumber: string | null;
  amount: number | null;
  currency: string | null;
  reason: string | null;
  status: string;
  recommendation: string | null;
  final: string | null;
  createdAt: string;
};

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function Friday() {
  const router = useRouter();
  const [m, setM] = useState<Metrics | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch("/api/metrics"), fetch("/api/invoices")]);
    if (a.ok) setM(await a.json());
    if (b.ok) setRows(await b.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling fetch; state is set after the request resolves
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load]);

  async function act(key: string, url: string, ok: (r: Record<string, number | boolean>) => string) {
    setBusy(key);
    const res = await fetch(url, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) toast.error(body.error ?? "That didn't work. Try again.");
    else toast.success(ok(body));
    await load();
  }

  if (!m) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-96" />
        <Skeleton className="h-24 w-full max-w-xl" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const cleared = m.outcome.auto_approve + m.outcome.partial_approve;
  const hold = m.outcome.escalate;
  const dnp = m.outcome.reject;
  // Decided invoices first, still-unread ones after, so the ledger leads with answers.
  const real = rows
    .filter((r) => !(r.demoId ?? "").startsWith("seed-"))
    .sort((a, b) => Number(!!b.recommendation) - Number(!!a.recommendation));
  const queueTotal = (m.queue.queued ?? 0) + (m.queue.running ?? 0) + (m.queue.done ?? 0) + (m.queue.dead ?? 0);
  const queueDone = m.queue.done ?? 0;
  const maxReason = Math.max(1, ...m.reasons.map((r) => r.count));

  return (
    <div className="space-y-12">
      <section className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div>
          <h1 className="font-display max-w-[20ch] text-[2.6rem] leading-[1.1] sm:text-[3.4rem]">
            {m.total === 0 ? "Nothing has come in yet." : `${plural(m.total, "invoice", "invoices")} came in.`}
          </h1>
          {m.total > 0 && (
            <p className="font-display mt-5 max-w-[36ch] text-[1.4rem] leading-snug text-[#1F2A44] sm:text-[1.65rem]">
              {cleared === 0 ? "None are cleared to pay yet." : `${cleared} ${cleared === 1 ? "is" : "are"} cleared to pay, ${usd(m.money.cleared)} in all.`}
              {hold > 0 && ` ${hold} ${hold === 1 ? "is" : "are"} on hold (${usd(m.money.held)}).`}
              {dnp > 0 && ` ${dnp} should not be paid (${usd(m.money.blocked)}).`}
              {m.waitingForPerson > 0 && ` ${m.waitingForPerson} wait for a person to look.`}
              {m.outcome.processing > 0 && ` ${m.outcome.processing} still being read.`}
            </p>
          )}
          {m.total === 0 && (
            <p className="mt-4 max-w-[52ch] text-[#4B5963]">
              Invoices arrive by email, or you can{" "}
              <Link href="/queue" className="underline underline-offset-4">
                upload one
              </Link>
              . To see the whole flow with about thirty messy invoices, run the Friday demo at the bottom of this page.
            </p>
          )}
        </div>
        {m.total > 0 && (
          <dl aria-label="Totals by decision" className="space-y-3 border-l border-[#C5D0D8] pl-6">
            {[
              { v: "auto_approve", n: cleared, d: usd(m.money.cleared) },
              { v: "escalate", n: hold, d: usd(m.money.held) },
              { v: "reject", n: dnp, d: usd(m.money.blocked) },
            ].map((t) => (
              <div key={t.v} className="flex items-center justify-between gap-4">
                <dt>
                  <StatusBadge value={t.v} />
                </dt>
                <dd className="text-right">
                  <span className="font-display text-2xl tabular">{t.n}</span>
                  <span className="block text-xs text-[#4B5963] tabular">{t.d}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section aria-label="Invoices received" className="min-w-0">
          <div className="ledger overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>Invoice</th>
                  <th className="num">Amount</th>
                  <th>Decision</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {real.slice(0, 14).map((r) => (
                  <tr key={r.id} data-href onClick={() => router.push(`/cases/${r.id}`)}>
                    <td className="font-medium">
                      <Link href={`/cases/${r.id}`} onClick={(e) => e.stopPropagation()}>
                        {r.vendor ?? "Reading…"}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-[#4B5963]">{r.invoiceNumber ?? "—"}</td>
                    <td className="num">{r.amount != null ? usd(r.amount) : "—"}</td>
                    <td>
                      <StatusBadge value={r.final ?? r.recommendation ?? (r.status === "queued" ? "queued" : "running")} />
                    </td>
                    <td className="max-w-[22rem] truncate text-[#4B5963]" title={r.reason ?? undefined}>
                      {r.reason ?? ""}
                    </td>
                  </tr>
                ))}
                {real.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-[#4B5963]">
                      The ledger is empty.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {real.length > 14 && (
            <p className="mt-3 text-sm">
              <Link href="/queue" className="underline underline-offset-4">
                See all {real.length} invoices
              </Link>
            </p>
          )}
        </section>

        <aside className="space-y-9 text-[0.9375rem]">
          <section>
            <h2 className="font-display border-b border-[#C5D0D8] pb-1 text-xl">Why things stopped</h2>
            {m.reasons.length === 0 ? (
              <p className="mt-3 text-[#4B5963]">Nothing has failed a check.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {m.reasons.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <div className="flex justify-between gap-3">
                      <span>{r.label}</span>
                      <span className="tabular">{r.count}</span>
                    </div>
                    <div className="mt-1 h-1.5 bg-[#DDE5DB]" aria-hidden>
                      <div className="h-full bg-[#1F2A44]" style={{ width: `${(r.count / maxReason) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-display border-b border-[#C5D0D8] pb-1 text-xl">Checked for you</h2>
            <p className="mt-3 text-[#4B5963]">
              About {m.minutesSaved} minutes of checking saved, counting {m.assumptions.manualMinutesPerInvoice} minutes
              an invoice by hand.
            </p>
            <p className="mt-2 text-[#4B5963]">
              {m.duplicatesCaught === 0
                ? "No re-sent invoices so far."
                : `${plural(m.duplicatesCaught, "re-sent invoice", "re-sent invoices")} caught before payment.`}
            </p>
          </section>

          <section>
            <h2 className="font-display border-b border-[#C5D0D8] pb-1 text-xl">Work queue</h2>
            <p className="mt-3">
              {queueDone} of {queueTotal} done
              {(m.queue.dead ?? 0) > 0 && <span className="text-[#B3261E]">, {m.queue.dead} failed</span>}.
            </p>
            <div className="mt-2 h-1.5 bg-[#DDE5DB]" role="progressbar" aria-valuenow={queueDone} aria-valuemin={0} aria-valuemax={queueTotal} aria-label="Queue progress">
              <div className="h-full bg-[#1E7F5C]" style={{ width: `${queueTotal ? (queueDone / queueTotal) * 100 : 0}%` }} />
            </div>
            <p className="mt-2 text-[#4B5963]">
              If the worker stops mid-job, the job goes back in the queue. Nothing is lost or paid twice.
            </p>
          </section>
        </aside>
      </div>

      <section className="border-t-2 border-[#1F2A44] pt-6">
        <h2 className="font-display text-2xl">Run the Friday demo</h2>
        <ol className="mt-4 grid max-w-[64rem] list-decimal gap-x-10 gap-y-4 pl-5 text-[0.9375rem] sm:grid-cols-3">
          <li className="pl-1">
            <p>About thirty emails with invoices attached land in the queue. None are read yet.</p>
            <Button
              variant="outline"
              className="mt-3"
              disabled={busy !== null}
              onClick={() =>
                void act("load", "/api/demo/friday", (r) =>
                  r.alreadyLoaded ? "The Friday inbox is already loaded." : `Queued ${r.invoices} invoices from email.`,
                )
              }
            >
              Load the inbox
            </Button>
          </li>
          <li className="pl-1">
            <p>The worker picks up three invoices, then stops as if the server had crashed.</p>
            <Button
              variant="outline"
              className="mt-3"
              disabled={busy !== null || (m.queue.queued ?? 0) === 0}
              onClick={() => void act("crash", "/api/demo/crash", (r) => `Worker stopped holding ${r.abandoned} invoices.`)}
            >
              Stop the worker
            </Button>
          </li>
          <li className="pl-1">
            <p>Restart it. The three abandoned invoices are picked up again once their short lease runs out.</p>
            <Button disabled={busy !== null} className="mt-3" onClick={() => void act("run", "/api/worker/tick", (r) => `Worker finished ${r.ran} invoices.`)}>
              Start the worker
            </Button>
          </li>
        </ol>
      </section>
    </div>
  );
}
