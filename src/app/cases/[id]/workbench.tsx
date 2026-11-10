"use client";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/utils";
import { buildBrief } from "@/lib/invoice/brief";
import type { PipelineTrace } from "@/lib/invoice/schema";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";

type Event = { id: string; step: string; status: string; payload: unknown; at: string };

type Payload = {
  invoice: {
    id: string;
    demoId: string | null;
    invoiceNumber: string | null;
    pdfPath: string | null;
    status: string;
    runId: string | null;
  };
  decision: {
    recommendation: string;
    final: string | null;
    confidence: number;
    explanation: string;
    needsHuman: boolean;
    trace: PipelineTrace;
  } | null;
  events: Event[];
};

export function Workbench({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/invoices/${id}`, { cache: "no-store" });
    if (!res.ok) {
      setError(`Failed to load case (${res.status})`);
      return;
    }
    setData(await res.json());
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling fetch; state is set after the request resolves
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  async function resume(action: "approve" | "reject" | "override", override?: string) {
    const res = await fetch("/api/invoices/resume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        invoiceId: id,
        action,
        override,
        note,
        runId: data?.invoice.runId,
      }),
    });
    if (res.ok) toast.success("Decision recorded");
    else toast.error((await res.json().catch(() => ({}))).error ?? "Could not record the decision");
    await load();
  }

  if (error) return <p className="text-sm text-danger-text">{error}</p>;
  if (!data) return <p className="text-sm text-text-mute">Opening the guard file…</p>;
  const trace = data.decision?.trace;
  const brief = trace ? buildBrief(trace) : null;
  // Uploads are storage keys (org/...) served by the authenticated files route; demo fixtures are static.
  const stored = data.invoice.pdfPath ?? "/demos/partial.pdf";
  const pdf = stored.startsWith("/") ? stored : `/api/files/${data.invoice.id}`;
  const isImage = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(stored);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <section className="overflow-hidden rounded-none border border-glass-border bg-glass">
        <div className="flex items-center justify-between border-b border-glass-border px-4 py-2">
          <div>
            <div className="text-sm font-semibold">{brief?.kindLabel ?? "Document"}</div>
            <div className="text-[11px] text-text-mute">
              {data.invoice.invoiceNumber ?? "Source as uploaded"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/invoices/${id}/audit?format=csv`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-none px-2 text-xs font-medium text-text-mute hover:bg-muted hover:text-foreground"
              title="Download the audit trail for this invoice"
            >
              <Download className="h-3.5 w-3.5" aria-hidden /> Audit trail
            </a>
          </div>
        </div>
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            title="Invoice image"
            src={pdf}
            alt="Uploaded invoice"
            className="h-[72vh] w-full bg-void object-contain"
          />
        ) : (
          <iframe title="Invoice PDF" src={pdf} className="h-[72vh] w-full bg-white" />
        )}
      </section>

      <section className="space-y-7">
        {brief && (
          <header>
            <div className="flex flex-wrap items-start justify-between gap-5">
              <h1 className="font-display max-w-[17ch] text-[2.3rem] leading-[1.08]">{brief.analystHeadline ?? brief.verb}</h1>
              <StatusBadge big value={data.decision?.final ?? data.decision?.recommendation ?? data.invoice.status} />
            </div>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-5 text-text-mute">
              <span className="font-display text-[1.7rem] text-foreground tabular">{brief.amount}</span>
              <span>{brief.howSure}</span>
              {brief.analystModel && brief.analystModel !== "engine" && (
                <span className="text-sm">Memo by {brief.analystModel}. The decision comes from the rules.</span>
              )}
            </p>
            {brief.analystSoWhat && (
              <p className="font-display mt-5 max-w-[40ch] border-l-4 border-danger pl-4 text-[1.25rem] leading-snug">
                {brief.analystSoWhat}
              </p>
            )}
            <p className="mt-4 max-w-[62ch] leading-7">{brief.analystNote ?? brief.stance}</p>
            <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[0.9375rem] text-text-mute">
              {brief.why.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </header>
        )}

        {brief && (
          <div className="border-t-2 border-neon-blue pt-3">
            <h2 className="font-display text-xl">What we read</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {brief.facts.map((f) => (
                <div key={f.label}>
                  <dt className="text-xs text-text-mute">{f.label}</dt>
                  <dd className={f.warn ? "font-medium text-warning-text" : "font-medium"}>{f.value}</dd>
                </div>
              ))}
            </dl>
            {brief.parties.length > 0 && (
              <div className="mt-4 border-t border-glass-border pt-3">
                <div className="text-xs text-text-mute">Parties</div>
                <ul className="mt-2 space-y-1 text-sm">
                  {brief.parties.map((p) => (
                    <li key={p.role + p.name}>
                      <span className="text-text-mute">{p.role}: </span>
                      {p.name}
                      {p.taxId ? <span className="text-text-mute"> · {p.taxId}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {brief.slices.length > 1 && (
              <div className="mt-4 border-t border-glass-border pt-3">
                <div className="text-xs text-text-mute">
                  This file contains more than one bill
                </div>
                <ul className="mt-2 space-y-2">
                  {brief.slices.map((s) => (
                    <li key={s.title + (s.invoiceNumber ?? "")} className="flex justify-between text-sm">
                      <span>
                        {s.title}
                        <span className="block text-[11px] text-text-mute">
                          {s.invoiceNumber} {s.note ? `· ${s.note}` : ""}
                        </span>
                      </span>
                      <span className="tabular">{s.amount}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {brief.extras.length > 0 && (
              <div className="mt-4 border-t border-glass-border pt-3">
                <div className="text-xs text-text-mute">Also on the page</div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  {brief.extras.map((e) => (
                    <div key={e.label}>
                      <dt className="text-text-mute">{e.label}</dt>
                      <dd>{e.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        )}

        {brief && brief.lines.length > 0 && (
          <div className="border-t-2 border-neon-blue pt-3">
            <h2 className="font-display text-xl">Lines</h2>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {brief.lines.map((l) => (
                  <tr key={l.description} className="border-t border-glass-border">
                    <td className="py-2">{l.description}</td>
                    <td className="py-2 text-text-mute">×{l.qty}</td>
                    <td className="py-2 text-right tabular">{l.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {trace && (
          <div className="border-t-2 border-neon-blue pt-3">
            <h2 className="font-display text-xl">Overpayment check (purchase orders)</h2>
            {trace.normalized.fx?.missing && (
              <p className="mt-2 text-sm text-warning-text">
                No published {trace.normalized.fx.pair} rate. Left in{" "}
                {trace.normalized.originalCurrency} — we did not call ₹1 equal to $1.
              </p>
            )}
            {trace.normalized.fx &&
              !trace.normalized.fx.missing &&
              trace.normalized.fx.source !== "identity" && (
                <p className="mt-2 text-sm text-text-mute">
                  Converted {trace.normalized.originalCurrency} {trace.normalized.originalTotal} to{" "}
                  {money(trace.normalized.comparableAmount, trace.normalized.comparableCurrency)} at{" "}
                  {trace.normalized.fx.rate} on {trace.normalized.fx.asOf}.
                </p>
              )}
            <div className="mt-3 space-y-2">
              {trace.match.allocations.map((a) => (
                <div key={a.poNumber} className="border border-glass-border bg-glass p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.poNumber}</span>
                    <StatusBadge value={a.status} />
                  </div>
                  <p className="mt-1 text-text-mute">{a.evidence}</p>
                </div>
              ))}
              {!trace.match.allocations.length && (
                <p className="text-sm text-text-mute">
                  {trace.extraction.documentKind === "mixed_pack" ||
                  trace.extraction.documentKind === "marketplace_invoice"
                    ? "Marketplace food bill — we do not match these to a purchase order. The order number on the page is the reference."
                    : "No open purchase order was linked."}
                </p>
              )}
            </div>
          </div>
        )}

        {brief && (
          <div className="border-t-2 border-neon-blue pt-3">
            <h2 className="font-display text-xl">Guard checks run</h2>
            <ul className="mt-2 space-y-2">
              {brief.checks.map((c) => (
                <li key={c.label} className="flex items-start gap-2 text-sm">
                  <StatusBadge value={c.outcome} />
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.invoice.status === "suspended" && brief && (
          <div className="border-l-4 border-warning bg-glass p-4">
            <h2 className="font-display text-xl">A person needs to clear this before money moves</h2>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {brief.ask.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <textarea
              className="mt-3 w-full rounded-md border border-input bg-void p-2 text-sm text-foreground"
              rows={2}
              placeholder="Note for the file (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void resume("approve")}>Release as proposed</Button>
              <Button variant="outline" onClick={() => void resume("override", "auto_approve")}>
                Override and release in full
              </Button>
              <Button variant="danger" onClick={() => void resume("reject")}>
                Do not pay
              </Button>
            </div>
          </div>
        )}

        <details className="rounded-none border border-glass-border bg-glass p-4 text-sm">
          <summary className="cursor-pointer font-medium">Guard log (for the file, not the meeting)</summary>
          <ol className="mt-3 space-y-1 text-text-mute">
            {data.events.map((e) => (
              <li key={e.id}>
                {e.at.slice(11, 19)} · {e.step} · {e.status}
              </li>
            ))}
          </ol>
          <button className="mt-3 text-xs underline" type="button" onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? "Hide machine output" : "Show machine output"}
          </button>
          {showRaw && trace && (
            <pre className="mt-2 max-h-64 overflow-auto text-[11px] leading-5">
              {JSON.stringify(
                {
                  documentKind: trace.extraction.documentKind,
                  extras: trace.extraction.extras,
                  parties: trace.extraction.parties,
                  slices: trace.extraction.slices,
                  decision: trace.decision,
                },
                null,
                2,
              )}
            </pre>
          )}
        </details>
      </section>
    </div>
  );
}
