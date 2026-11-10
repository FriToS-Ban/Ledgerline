"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";

type Accuracy = {
  scored: number;
  pending: number;
  decisionAccuracy: number;
  correct: number;
  wronglyPaid: number;
  sentToHuman: number;
  extraction: { field: string; correct: number; total: number; rate: number }[];
  scenarios: { scenario: string; total: number; correct: number; wronglyPaid: number }[];
  misses: { invoiceId: string; scenario: string; expected: string[]; actual: string; note: string }[];
};

const FIELD: Record<string, string> = {
  vendor: "Vendor name",
  invoiceNumber: "Invoice number",
  total: "Total amount",
  poNumbers: "PO numbers",
};

export default function AccuracyPage() {
  const [a, setA] = useState<Accuracy | null>(null);

  useEffect(() => {
    const load = () =>
      void fetch("/api/accuracy")
        .then((r) => r.json())
        .then(setA);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!a) return <Skeleton className="h-96" />;

  if (a.scored === 0) {
    return (
      <div>
        <h1 className="font-display max-w-[18ch] text-[2.6rem] leading-[1.1]">Not tested yet.</h1>
        <p className="mt-4 max-w-[50ch] text-text-mute">
          The guard is tested against invoices where the right answer is known. Load the Friday demo from the{" "}
          <Link href="/" className="underline underline-offset-4">
            Command page
          </Link>
          , start the worker, then come back.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <section>
        <h1 className="font-display max-w-[22ch] text-[2.6rem] leading-[1.1] sm:text-[3.2rem]">
          {a.wronglyPaid === 0
            ? `The guard let nothing bad through.`
            : `${a.wronglyPaid} invoice${a.wronglyPaid === 1 ? "" : "s"} slipped past the guard and would have been paid wrongly.`}
        </h1>
        <p className="font-display mt-5 max-w-[38ch] text-[1.4rem] leading-snug sm:text-[1.6rem]">
          Across {a.scored} test invoices we made the expected call {a.correct} times. {a.sentToHuman} went to a person
          instead of being decided alone.
        </p>
      </section>

      {a.misses.length > 0 && (
        <section className="border-l-4 border-danger bg-glass p-4">
          <h2 className="font-display text-xl">Where the guard disagreed with the answer key</h2>
          <ul className="mt-2 space-y-1 text-[0.9375rem]">
            {a.misses.map((m) => (
              <li key={m.invoiceId}>
                <Link className="underline underline-offset-4" href={`/cases/${m.invoiceId}`}>
                  {m.scenario}
                </Link>
                : expected {m.expected.join(" or ")}, we said {m.actual}. {m.note}.
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-12 lg:grid-cols-2">
        <section>
          <h2 className="font-display border-b-2 border-neon-blue pb-1 text-2xl">Reading the page</h2>
          <p className="mt-2 text-sm text-text-mute">Did we pull the right value off the PDF?</p>
          <ul className="mt-4 space-y-4">
            {a.extraction.map((f) => (
              <li key={f.field}>
                <div className="flex justify-between gap-4 text-[0.9375rem]">
                  <span>{FIELD[f.field] ?? f.field}</span>
                  <span className="tabular text-text-mute">
                    {f.correct} of {f.total}
                  </span>
                </div>
                <div className="mt-1 h-2 bg-muted" role="img" aria-label={`${FIELD[f.field] ?? f.field}: ${Math.round(f.rate * 100)} percent correct`}>
                  <div className="h-full bg-neon-blue" style={{ width: `${f.rate * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="font-display border-b-2 border-neon-blue pb-1 text-2xl">By kind of invoice</h2>
          <div className="ledger mt-4">
            <table>
              <thead>
                <tr>
                  <th>Situation</th>
                  <th className="num">Right call</th>
                  <th className="num">Paid wrongly</th>
                </tr>
              </thead>
              <tbody>
                {a.scenarios.map((s) => (
                  <tr key={s.scenario}>
                    <td>{s.scenario}</td>
                    <td className="num">
                      {s.correct} of {s.total}
                    </td>
                    <td className="num" style={s.wronglyPaid ? { color: "var(--margin)", fontWeight: 600 } : undefined}>
                      {s.wronglyPaid}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="max-w-[62ch] border-t border-glass-border pt-5 text-[0.9375rem] text-text-mute">
        <h2 className="font-display text-xl text-foreground">Before you quote these numbers</h2>
        <p className="mt-2">
          We generated these invoices ourselves in a clean digital layout, so reading accuracy here is the best case. Real
          vendor PDFs and phone photos will score lower. What this page proves is the method and the safety check. Run it on a
          sample of the client&apos;s own invoices before claiming a number to them.
        </p>
      </section>
    </div>
  );
}
