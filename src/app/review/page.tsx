"use client";

import { StatusBadge } from "@/components/status-badge";
import Link from "next/link";
import { useEffect, useState } from "react";

type Row = {
  invoice: { id: string; invoiceNumber: string | null; demoId: string | null; status: string };
  decision: { recommendation: string; explanation: string } | null;
};

export default function ReviewPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    void fetch("/api/review")
      .then((r) => r.json())
      .then(setRows);
  }, []);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-display max-w-[20ch] text-[2.6rem] leading-[1.1] sm:text-[3.2rem]">
          {rows && rows.length === 0 ? "Nobody is waiting." : "Waiting for a person."}
        </h1>
        <p className="mt-4 max-w-[52ch] text-[#4B5963]">
          These invoices are on hold. Open one to see the proposed call and what needs confirming.
        </p>
      </section>
      {rows && rows.length > 0 && (
        <div className="ledger">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Decision</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.invoice.id}>
                  <td className="whitespace-nowrap font-medium">
                    <Link href={`/cases/${r.invoice.id}`} className="underline underline-offset-4">
                      {r.invoice.invoiceNumber ?? r.invoice.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge value={r.decision?.recommendation ?? r.invoice.status} />
                  </td>
                  <td className="max-w-[40rem] text-[#4B5963]">
                    <span className="line-clamp-2">{r.decision?.explanation}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
