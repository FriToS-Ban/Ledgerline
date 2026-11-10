"use client";

import { DEMO_CASES } from "@/lib/fixtures/cases";
import { StatusBadge } from "@/components/status-badge";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Row = {
  id: string;
  demoId: string | null;
  invoiceNumber: string | null;
  status: string;
  createdAt: string;
  recommendation: string | null;
  confidence: number | null;
};

export default function QueuePage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/invoices");
    setRows(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling fetch; state is set after the request resolves
    void load();
  }, []);

  async function runDemo(id: string) {
    setBusy(id);
    const res = await fetch("/api/invoices/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ demoId: id }),
    });
    const data = await res.json();
    setBusy(null);
    router.push(`/cases/${data.invoiceId}`);
  }

  async function onUpload(file: File) {
    setBusy("upload");
    const form = new FormData();
    form.set("file", file);
    const res = await fetch("/api/invoices/process", { method: "POST", body: form });
    const data = await res.json();
    setBusy(null);
    router.push(`/cases/${data.invoiceId}`);
  }

  return (
    <div className="space-y-12">
      <section>
        <h1 className="font-display max-w-[20ch] text-[2.6rem] leading-[1.1] sm:text-[3.2rem]">Every invoice, checked.</h1>
        <p className="mt-4 max-w-[54ch] text-text-mute">
          Upload a vendor PDF or a phone photo. The guard checks it for duplicates, overpayment and suspicious details, then
          says release, hold, or block, with the numbers and reasons behind it.
        </p>
        <label className="mt-6 flex max-w-xl cursor-pointer items-center justify-between gap-4 border border-dashed border-neon-blue bg-glass px-4 py-3">
          <span>{busy === "upload" ? "Reading the file…" : "Choose a PDF, photo or screenshot"}</span>
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
            }}
          />
          <span className="border border-neon-blue px-3 py-1 text-sm">Browse</span>
        </label>
      </section>

      <section aria-label="Invoices">
        <div className="ledger overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Source</th>
                <th>Decision</th>
                <th className="num">Confidence</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => r.demoId !== "seed-partial-1" && r.demoId !== "seed-dup")
                .map((r) => (
                  <tr key={r.id} data-href onClick={() => router.push("/cases/" + r.id)}>
                    <td className="font-medium">{r.invoiceNumber ?? r.id.slice(0, 8)}</td>
                    <td className="text-text-mute">{r.demoId ?? "upload"}</td>
                    <td>
                      <StatusBadge value={r.status} />
                    </td>
                    <td className="num">{r.confidence != null ? Math.round(r.confidence * 100) + "%" : "—"}</td>
                    <td className="text-text-mute">{r.createdAt.slice(0, 16).replace("T", " ")}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t-2 border-neon-blue pt-6">
        <h2 className="font-display text-2xl">Try a known threat</h2>
        <p className="mt-1 text-sm text-text-mute">Each one is built to trip a different guard rule.</p>
        <ul className="mt-4 grid gap-x-10 gap-y-4 sm:grid-cols-2">
          {DEMO_CASES.map((c) => (
            <li key={c.id} className="border-b border-glass-border pb-3">
              <button onClick={() => void runDemo(c.id)} disabled={busy === c.id} className="text-left disabled:opacity-60">
                <span className="font-medium underline-offset-4 hover:underline">{c.title}</span>
                <span className="block text-sm text-text-mute">{c.subtitle}</span>
                <span className="text-xs text-foreground">{busy === c.id ? "Running…" : "Run this case"}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
