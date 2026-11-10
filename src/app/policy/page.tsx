"use client";

import { toast } from "sonner";
import { useEffect, useState } from "react";

type Rule = { id: string; key: string; value: string; label: string; enabled: boolean };

export default function PolicyPage() {
  const [rows, setRows] = useState<Rule[]>([]);
  useEffect(() => {
    void fetch("/api/policy")
      .then((r) => r.json())
      .then(setRows);
  }, []);

  async function save(key: string, value: string) {
    const res = await fetch("/api/policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (res.ok) toast.success("Saved. It applies to the next invoice.");
    else toast.error("Couldn't save that rule.");
  }

  return (
    <div className="max-w-2xl space-y-8">
      <section>
        <h1 className="font-display max-w-[20ch] text-[2.6rem] leading-[1.1] sm:text-[3.2rem]">Guard rules.</h1>
        <p className="mt-4 max-w-[52ch] text-text-mute">
          These are the lines the guard will not let money cross. Every release or hold cites the number that applied. Change a value and click away to save it.
        </p>
      </section>
      <div className="ledger">
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <label htmlFor={r.key}>{r.label}</label>
                </td>
                <td className="num">
                  <input
                    id={r.key}
                    className="w-28 rounded-md border border-input bg-void px-2 py-1 text-right text-foreground tabular focus-visible:outline-2 focus-visible:outline-neon-cyan"
                    defaultValue={r.value}
                    onBlur={(e) => e.target.value !== r.value && void save(r.key, e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
