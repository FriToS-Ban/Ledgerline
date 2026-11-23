/**
 * Payment-instruction checks. A changed bank account on an otherwise normal invoice is the most
 * common invoice fraud (business email compromise): the vendor's mailbox is hijacked and the
 * "new remittance details" go to the fraudster. We read the bank details printed on the invoice
 * and compare them with the verified details in the vendor master.
 */

export type BankDetails = {
  accountNumber?: string | null;
  iban?: string | null;
  ifsc?: string | null;
  swift?: string | null;
  routingNumber?: string | null;
  accountName?: string | null;
};

const clean = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();

/** ISO 13616 IBAN check (mod 97 == 1). */
export function isValidIban(raw: string): boolean {
  const iban = clean(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  const digits = moved.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

/** Indian Financial System Code: 4 bank letters, a zero, 6 branch characters. */
export const isValidIfsc = (raw: string) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(clean(raw));

/** US ABA routing number (3-7-1 weighted checksum). */
export function isValidRouting(raw: string): boolean {
  const d = clean(raw);
  if (!/^\d{9}$/.test(d)) return false;
  const n = d.split("").map(Number);
  const sum = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8]);
  return sum % 10 === 0;
}

/** Reads remittance details from invoice text. Only well-formed values are returned. */
export function parseBankDetails(text: string): BankDetails | null {
  const grab = (re: RegExp) => text.match(re)?.[1]?.trim() ?? null;
  const ibanRaw = grab(/\bIBAN\b[ \t]*(?:No\.?|Number)?[ \t]*[:#]?[ \t]*([A-Z]{2}\d{2}(?:[ \t]?[A-Z0-9]{2,4}){3,8})/i);
  const iban = ibanRaw && isValidIban(ibanRaw) ? clean(ibanRaw) : null;
  const ifscRaw = grab(/\bIFS(?:C)?(?:[ \t]*Code)?[ \t]*[:#-]?[ \t]*([A-Z]{4}0[A-Z0-9]{6})\b/i);
  const ifsc = ifscRaw && isValidIfsc(ifscRaw) ? clean(ifscRaw) : null;
  const swift = grab(/\b(?:SWIFT|BIC)(?:[ \t]*(?:\/[ \t]*BIC)?[ \t]*Code)?[ \t]*[:#]?[ \t]*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/i);
  const routingRaw = grab(/\b(?:Routing|ABA)(?:[ \t]*(?:No\.?|Number|#))?[ \t]*[:#]?[ \t]*(\d{9})\b/i);
  const routingNumber = routingRaw && isValidRouting(routingRaw) ? routingRaw : null;
  const accountRaw = grab(
    /\b(?:A\/?C|Acct|Account)(?:[ \t]*(?:No\.?|Number|#))?[ \t]*[:#.-]?[ \t]*(\d[\d \t-]{6,22}\d)\b/i,
  );
  const accountNumber = accountRaw ? accountRaw.replace(/[\s-]/g, "") : null;
  const accountName = grab(/\b(?:Account|Beneficiary)[ \t]*Name[ \t]*[:#]?[ \t]*([A-Za-z][A-Za-z0-9 .,&'-]{2,60})/i);
  const found = { accountNumber, iban, ifsc, swift: swift ? clean(swift) : null, routingNumber, accountName };
  return accountNumber || iban ? found : null;
}

/** The account identifier we compare on: IBAN when present, else the account number. */
export function accountKey(b: BankDetails | null | undefined): string | null {
  if (!b) return null;
  const v = b.iban || b.accountNumber;
  return v ? clean(v) : null;
}

/** The bank/branch identifier: IFSC, SWIFT/BIC or routing number. */
export function bankCodeKey(b: BankDetails | null | undefined): string | null {
  if (!b) return null;
  const v = b.ifsc || b.routingNumber || b.swift;
  return v ? clean(v) : null;
}

/** "…4821": never show a full account number in a decision memo or audit trail. */
export function maskAccount(v: string | null | undefined): string {
  if (!v) return "—";
  const c = clean(v);
  return c.length <= 4 ? "…" + c : "…" + c.slice(-4);
}

export type BankComparison =
  | { status: "none" } // no bank details on the invoice
  | { status: "unverified"; invoiceAccount: string } // details on the invoice, none on file
  | { status: "match"; invoiceAccount: string }
  | { status: "changed"; invoiceAccount: string; onFile: string; codeChanged: boolean };

export function compareBank(
  invoice: BankDetails | null | undefined,
  onFile: { account: string | null; code: string | null } | null | undefined,
): BankComparison {
  const acct = accountKey(invoice);
  if (!acct) return { status: "none" };
  const fileAcct = onFile?.account ? clean(onFile.account) : null;
  if (!fileAcct) return { status: "unverified", invoiceAccount: acct };
  const code = bankCodeKey(invoice);
  const fileCode = onFile?.code ? clean(onFile.code) : null;
  const codeChanged = !!(code && fileCode && code !== fileCode);
  if (acct !== fileAcct || codeChanged) return { status: "changed", invoiceAccount: acct, onFile: fileAcct, codeChanged };
  return { status: "match", invoiceAccount: acct };
}
