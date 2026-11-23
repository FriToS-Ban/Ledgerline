"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Vendor = {
  id: string;
  name: string;
  legalName: string;
  approved: boolean;
  currency: string;
  paymentTerms: string;
  taxId: string | null;
  bankAccountMasked: string | null;
  bankCode: string | null;
  bankVerifiedAt: string | null;
  bankVerifiedBy: string | null;
};

const field =
  "w-full rounded-md border border-input bg-void px-2 py-1 text-foreground focus-visible:outline-2 focus-visible:outline-neon-cyan";

function EditVendor({ v, onDone }: { v: Vendor; onDone: () => void }) {
  const [terms, setTerms] = useState(v.paymentTerms);
  const [taxId, setTaxId] = useState(v.taxId ?? "");
  const [approved, setApproved] = useState(v.approved);
  const [account, setAccount] = useState("");
  const [code, setCode] = useState("");
  const [verification, setVerification] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const patch: Record<string, unknown> = {};
    if (terms !== v.paymentTerms) patch.paymentTerms = terms;
    if (taxId !== (v.taxId ?? "")) patch.taxId = taxId || null;
    if (approved !== v.approved) patch.approved = approved;
    if (account) Object.assign(patch, { bankAccount: account, bankCode: code || null, verification });
    const res = await fetch(`/api/vendors/${encodeURIComponent(v.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return void toast.error(data?.error ?? "Could not save the vendor.");
    toast.success(account ? "Bank details updated and logged in the audit trail." : "Vendor updated.");
    onDone();
  }

  return (
    <div className="grid gap-4 border-t border-glass-border bg-glass p-4 sm:grid-cols-2">
      <label className="text-sm">
        Payment terms
        <input className={field} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Net 30, 2/10 Net 30…" />
      </label>
      <label className="text-sm">
        Tax id (GSTIN / VAT / EIN)
        <input className={field} value={taxId} onChange={(e) => setTaxId(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> Approved vendor
      </label>
      <div className="sm:col-span-2 border-t border-glass-border pt-3">
        <p className="text-sm font-medium">Change bank details (workspace owner only)</p>
        <p className="mt-1 text-xs text-text-mute">
          Only enter details you confirmed by calling the vendor on a number you already had, never one from an email or invoice.
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            New account number / IBAN
            <input className={field} value={account} onChange={(e) => setAccount(e.target.value)} autoComplete="off" />
          </label>
          <label className="text-sm">
            IFSC / routing / SWIFT
            <input className={field} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          </label>
          <label className="text-sm">
            How you verified it
            <input
              className={field}
              value={verification}
              onChange={(e) => setVerification(e.target.value)}
              placeholder="Called +1 555 0100 (on file), spoke to J. Rao"
            />
          </label>
        </div>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function VendorsPage() {
  const [rows, setRows] = useState<Vendor[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/vendors", { cache: "no-store" });
    setRows(res.ok ? await res.json() : []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch; state is set after the request resolves
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-display max-w-[20ch] text-[2.6rem] leading-[1.1] sm:text-[3.2rem]">Vendors.</h1>
        <p className="mt-4 max-w-[60ch] text-text-mute">
          The verified record of who you pay and where. Every invoice&apos;s bank details are checked against this list, so a
          fraudster changing &quot;remit to&quot; on an invoice gets stopped. Import vendors with bank and tax columns on the Sources
          page, or edit one here.
        </p>
      </section>
      <div className="ledger overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Terms</th>
              <th>Tax id</th>
              <th>Verified pay-to account</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td colSpan={5} className="text-text-mute">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-text-mute">
                  No vendors yet. Import a vendor sheet on the Sources page or run a demo case.
                </td>
              </tr>
            ) : (
              rows.map((v) => (
                <Fragment key={v.id}>
                  <tr>
                    <td>
                      <span className="font-medium">{v.name}</span>
                      {!v.approved && <span className="ml-2 text-xs text-danger-text">not approved</span>}
                      <span className="block text-xs text-text-mute">{v.legalName}</span>
                    </td>
                    <td>{v.paymentTerms}</td>
                    <td className="font-mono text-sm">{v.taxId ?? "—"}</td>
                    <td>
                      {v.bankAccountMasked ? (
                        <>
                          <span className="font-mono">{v.bankAccountMasked}</span>
                          {v.bankCode && <span className="ml-2 font-mono text-sm text-text-mute">{v.bankCode}</span>}
                          <span className="block text-xs text-text-mute">
                            verified {v.bankVerifiedAt?.slice(0, 10)} · {v.bankVerifiedBy}
                          </span>
                        </>
                      ) : (
                        <span className="text-text-mute">None on file</span>
                      )}
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => setEditing(editing === v.id ? null : v.id)}>
                        {editing === v.id ? "Close" : "Edit"}
                      </Button>
                    </td>
                  </tr>
                  {editing === v.id && (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <EditVendor
                          v={v}
                          onDone={() => {
                            setEditing(null);
                            void load();
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
