"use client";

import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useState } from "react";

type Job = {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  updatedAt: string;
};
type QueueData = {
  counts: Record<string, number>;
  recent: Job[];
  worker: { running: boolean; busy: boolean; lastTick: string | null };
};
type Email = {
  id: string;
  sender: string | null;
  subject: string | null;
  receivedAt: string;
  attachments: number;
  invoiceIds: string;
  source: string;
  note: string | null;
};
type MasterData = {
  vendors: { id: string; name: string; approved: number; currency: string }[];
  pos: { id: string; number: string; amount: number; currency: string; status: string }[];
  poLineCount: number;
  erp?: boolean;
  hostedDb?: boolean;
  imports: { id: string; source: string; vendors: number; pos: number; po_lines: number; errors: string; at: string }[];
};

const card = "border-t-2 border-[#1F2A44] pt-4";

export default function OperationsPage() {
  const [queue, setQueue] = useState<QueueData | null>(null);
  const [emails, setEmails] = useState<{ imap: boolean; emails: Email[] } | null>(null);
  const [master, setMaster] = useState<MasterData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [q, e, m] = await Promise.all([
      fetch("/api/queue").then((r) => r.json()),
      fetch("/api/intake/email").then((r) => r.json()),
      fetch("/api/master/import").then((r) => r.json()),
    ]);
    setQueue(q);
    setEmails(e);
    setMaster(m);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling fetch; state is set after the request resolves
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function uploadCsv(files: FileList | null) {
    if (!files?.length) return;
    const form = new FormData();
    for (const f of Array.from(files)) form.append("file", f);
    const res = await fetch("/api/master/import", { method: "POST", body: form });
    const r = await res.json();
    setMsg(
      res.ok
        ? `Imported ${r.vendors} vendors, ${r.pos} POs, ${r.poLines} PO lines` +
            (r.errors?.length ? ` — ${r.errors.length} row problems: ${r.errors.slice(0, 3).join("; ")}` : "")
        : (r.error ?? "import failed"),
    );
    await load();
  }

  async function post(url: string, body?: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const r = await res.json();
    if (!res.ok) setMsg(r.error ?? "failed");
    await load();
    return r;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[2.6rem] leading-[1.1] sm:text-[3.2rem]">Sources and plumbing.</h1>
        <p className="mt-1 max-w-2xl text-sm text-[#4B5963]">
          Where invoices come from, what the worker is doing, and which vendor/PO book the decisions are checked against.
        </p>
        {msg && <p className="mt-2 rounded-none bg-[#E6ECE3] px-3 py-2 text-sm">{msg}</p>}
      </div>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl">Work queue</h2>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void post("/api/worker/tick")}>
              Run worker now
            </Button>
            <Button variant="outline" onClick={() => void post("/api/queue", { retry: "all" })}>
              Retry failed
            </Button>
          </div>
        </div>
        {queue && (
          <>
            <p className="mt-2 text-sm text-[#4B5963]">
              Worker {queue.worker.running ? "running" : "not started"}
              {queue.worker.lastTick ? ` · last tick ${new Date(queue.worker.lastTick).toLocaleTimeString()}` : ""} ·{" "}
              {["queued", "running", "done", "dead"].map((k) => `${queue.counts[k] ?? 0} ${k}`).join(" · ")}
            </p>
            <ul className="mt-3 divide-y divide-[#C5D0D8] text-sm">
              {queue.recent.slice(0, 8).map((j) => (
                <li key={j.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {j.kind} · <b>{j.status}</b> · attempt {j.attempts}/{j.maxAttempts}
                  </span>
                  <span className="text-[#4B5963]">{j.lastError ?? new Date(j.updatedAt).toLocaleTimeString()}</span>
                </li>
              ))}
              {!queue.recent.length && <li className="py-2 text-[#4B5963]">No jobs yet.</li>}
            </ul>
          </>
        )}
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl">Email intake</h2>
          <Button
            variant="outline"
            disabled={!emails?.imap}
            title={emails?.imap ? "" : "Set IMAP_HOST, IMAP_USER, IMAP_PASSWORD"}
            onClick={() => void post("/api/intake/poll")}
          >
            Check mailbox now
          </Button>
        </div>
        <p className="mt-2 text-sm text-[#4B5963]">
          {emails?.imap ? "Mailbox connected (IMAP)." : "No mailbox configured."} Or forward mail to{" "}
          <code>POST /api/intake/email</code> (raw message/rfc822, or multipart field <code>email</code>).
        </p>
        <ul className="mt-3 divide-y divide-[#C5D0D8] text-sm">
          {emails?.emails.map((m) => {
            const ids: string[] = JSON.parse(m.invoiceIds);
            return (
              <li key={m.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {m.sender ?? "unknown"} — {m.subject ?? "(no subject)"}
                </span>
                <span className="text-[#4B5963]">
                  {ids.length ? (
                    ids.map((id, i) => (
                      <a key={id} className="underline" href={`/cases/${id}`}>
                        case {i + 1}
                      </a>
                    ))
                  ) : (
                    (m.note ?? "nothing queued")
                  )}
                </span>
              </li>
            );
          })}
          {!emails?.emails.length && <li className="py-2 text-[#4B5963]">No emails received yet.</li>}
        </ul>
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl">Vendor &amp; PO book</h2>
          <div className="flex gap-2">
            <label className="inline-flex min-h-11 cursor-pointer items-center border border-[#1F2A44] bg-[#FBFCFA] px-3.5 text-sm font-medium hover:bg-[#E6ECE3]">
              Upload CSVs
              <input
                type="file"
                accept=".csv"
                multiple
                className="hidden"
                onChange={(e) => void uploadCsv(e.target.files)}
              />
            </label>
            <Button variant="outline" onClick={() => void post("/api/master/import", {})}>
              Sync data/master
            </Button>
            <Button
              variant="outline"
              disabled={!master?.erp}
              title={master?.erp ? "" : "Set ERP_URL to connect an ERP"}
              onClick={() => void post("/api/master/import", { erp: true })}
            >
              Sync from ERP
            </Button>
          </div>
        </div>
        <p className="mt-2 text-sm text-[#4B5963]">
          Files: <code>vendors.csv</code> (name, approved, currency, payment_terms), <code>pos.csv</code> (number, vendor,
          amount, currency, issue_date, description, status, goods_received), <code>po_lines.csv</code> (po_number,
          description, amount). Drop them in <code>data/master</code> and the worker re-imports on change.
        </p>
        {master && (
          <p className="mt-2 text-sm">
            {master.vendors.length} vendors ({master.vendors.filter((v) => !v.approved).length} blocked) ·{" "}
            {master.pos.length} POs · {master.poLineCount} PO lines · {master.hostedDb ? "hosted database" : "local database"} ·{" "}
            {master.erp ? "ERP connected" : "no ERP connected"}
            {master.imports[0] && (
              <span className="text-[#4B5963]">
                {" "}
                · last import {new Date(master.imports[0].at).toLocaleString()} ({master.imports[0].source})
              </span>
            )}
          </p>
        )}
      </section>
    </div>
  );
}
