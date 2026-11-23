import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { isValidIban, isValidIfsc, isValidRouting, maskAccount } from "@/lib/invoice/bank";
import { validateGstin } from "@/lib/invoice/gst";

export type VendorRow = {
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

export async function listVendors(orgId: string): Promise<VendorRow[]> {
  const rows = await getDb().select().from(t.vendors).where(eq(t.vendors.orgId, orgId)).orderBy(asc(t.vendors.name));
  return rows.map((v) => ({
    id: v.id,
    name: v.name,
    legalName: v.legalName,
    approved: v.approved,
    currency: v.currency,
    paymentTerms: v.paymentTerms,
    taxId: v.taxId,
    // The full account number never leaves the server: the UI only needs to recognise it.
    bankAccountMasked: v.bankAccount ? maskAccount(v.bankAccount) : null,
    bankCode: v.bankCode,
    bankVerifiedAt: v.bankVerifiedAt?.toISOString() ?? null,
    bankVerifiedBy: v.bankVerifiedBy,
  }));
}

export type VendorPatch = {
  approved?: boolean;
  paymentTerms?: string;
  taxId?: string | null;
  bankAccount?: string | null;
  bankCode?: string | null;
  /** How the new bank details were verified (e.g. "call-back to +1 555 0100 on file"). Required with bank changes. */
  verification?: string;
};

export class VendorPatchError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404) {
    super(message);
  }
}

const clean = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();

/** Validates a patch. Returns normalized values or throws VendorPatchError. */
export function validateVendorPatch(p: VendorPatch): VendorPatch {
  const out: VendorPatch = {};
  if (p.approved !== undefined) {
    if (typeof p.approved !== "boolean") throw new VendorPatchError("approved must be true or false", 400);
    out.approved = p.approved;
  }
  if (p.paymentTerms !== undefined) {
    const terms = String(p.paymentTerms).trim();
    if (!terms || terms.length > 40) throw new VendorPatchError("payment terms must be 1-40 characters", 400);
    out.paymentTerms = terms;
  }
  if (p.taxId !== undefined) {
    if (p.taxId === null || p.taxId === "") out.taxId = null;
    else {
      const id = clean(String(p.taxId));
      if (/^\d{2}[A-Z]{5}\d{4}[A-Z]/.test(id)) {
        const g = validateGstin(id);
        if (!g.valid) throw new VendorPatchError(`GSTIN is not valid: ${g.reason}`, 400);
      } else if (!/^[A-Z0-9]{5,20}$/.test(id)) {
        throw new VendorPatchError("tax id must be 5-20 letters or digits", 400);
      }
      out.taxId = id;
    }
  }
  if (p.bankAccount !== undefined || p.bankCode !== undefined) {
    const account = p.bankAccount ? clean(String(p.bankAccount)) : null;
    const code = p.bankCode ? clean(String(p.bankCode)) : null;
    if (account) {
      const iban = /^[A-Z]{2}\d{2}/.test(account);
      if (iban ? !isValidIban(account) : !/^\d{6,20}$/.test(account)) {
        throw new VendorPatchError("bank account must be 6-20 digits or a valid IBAN", 400);
      }
    }
    if (code && !(isValidIfsc(code) || isValidRouting(code) || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(code))) {
      throw new VendorPatchError("bank code must be a valid IFSC, ABA routing number or SWIFT/BIC", 400);
    }
    const how = String(p.verification ?? "").trim();
    if (account && how.length < 8) {
      throw new VendorPatchError("say how the new bank details were verified (e.g. a call-back to a number already on file)", 400);
    }
    out.bankAccount = account;
    out.bankCode = code;
    out.verification = how;
  }
  return out;
}

/**
 * Applies a vendor-master change and records it in the audit trail. Changing where money goes is
 * owner-only: an admin who can release payments must not also be able to redirect them.
 */
export async function updateVendor(opts: {
  orgId: string;
  vendorId: string;
  patch: VendorPatch;
  actor: { email: string; orgRole: string };
}) {
  const patch = validateVendorPatch(opts.patch);
  const bankChange = patch.bankAccount !== undefined || patch.bankCode !== undefined;
  if (bankChange && opts.actor.orgRole !== "owner") {
    throw new VendorPatchError("only the workspace owner can change a vendor's bank details", 403);
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    const where = and(eq(t.vendors.orgId, opts.orgId), eq(t.vendors.id, opts.vendorId));
    const [old] = await tx.select().from(t.vendors).where(where).for("update");
    if (!old) throw new VendorPatchError("vendor not found", 404);
    const set: Partial<typeof t.vendors.$inferInsert> = {};
    if (patch.approved !== undefined) set.approved = patch.approved;
    if (patch.paymentTerms !== undefined) set.paymentTerms = patch.paymentTerms;
    if (patch.taxId !== undefined) set.taxId = patch.taxId;
    if (bankChange) {
      set.bankAccount = patch.bankAccount ?? null;
      set.bankCode = patch.bankCode ?? null;
      set.bankVerifiedAt = patch.bankAccount ? new Date() : null;
      set.bankVerifiedBy = patch.bankAccount ? `${opts.actor.email}: ${patch.verification}` : null;
    }
    if (!Object.keys(set).length) return { changed: false };
    await tx.update(t.vendors).set(set).where(where);
    await tx.insert(t.auditEvents).values({
      orgId: opts.orgId,
      id: randomUUID(),
      invoiceId: `vendor:${opts.vendorId}`,
      step: bankChange ? "vendor-bank-change" : "vendor-change",
      status: "success",
      payload: JSON.stringify({
        vendor: old.name,
        by: opts.actor.email,
        ...(patch.approved !== undefined && { approved: { from: old.approved, to: patch.approved } }),
        ...(patch.paymentTerms !== undefined && { paymentTerms: { from: old.paymentTerms, to: patch.paymentTerms } }),
        ...(patch.taxId !== undefined && { taxId: { from: old.taxId, to: patch.taxId } }),
        ...(bankChange && {
          bank: {
            from: old.bankAccount ? `${maskAccount(old.bankAccount)} ${old.bankCode ?? ""}`.trim() : null,
            to: patch.bankAccount ? `${maskAccount(patch.bankAccount)} ${patch.bankCode ?? ""}`.trim() : null,
            verification: patch.verification,
          },
        }),
      }),
      at: new Date(),
    });
    return { changed: true };
  });
}
