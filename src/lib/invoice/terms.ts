/**
 * Payment terms → due date (and early-payment discount when the terms offer one).
 * Understands "Net 30", "Net30", "30 days", "Due on receipt", "Immediate", "2/10 Net 30",
 * "2% 10 Net 30" and "EOM" variants. Unknown terms fall back to Net 30 and say so.
 */

export type DueInfo = {
  dueDate: string; // YYYY-MM-DD
  netDays: number;
  discount: { pct: number; byDate: string } | null;
  assumed: boolean; // true when the terms could not be read and Net 30 was assumed
};

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const endOfMonth = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

export function dueFromTerms(invoiceDate: string | null | undefined, terms: string | null | undefined): DueInfo | null {
  if (!invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return null;
  const t = (terms ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (/due on receipt|on receipt|immediate|cash on delivery|\bcod\b/.test(t)) {
    return { dueDate: invoiceDate, netDays: 0, discount: null, assumed: false };
  }
  const discount = t.match(/(\d+(?:\.\d+)?)\s*%?\s*\/?\s*(\d+)\s*(?:days?)?,?\s*net\s*(\d+)/);
  if (discount) {
    const net = Number(discount[3]);
    return {
      dueDate: addDays(invoiceDate, net),
      netDays: net,
      discount: { pct: Number(discount[1]) / 100, byDate: addDays(invoiceDate, Number(discount[2])) },
      assumed: false,
    };
  }
  const net = t.match(/net\s*(\d+)|(\d+)\s*days?/);
  const days = net ? Number(net[1] ?? net[2]) : null;
  const eom = /\beom\b|end of month/.test(t);
  if (days != null) {
    const base = eom ? endOfMonth(invoiceDate) : invoiceDate;
    return { dueDate: addDays(base, days), netDays: days, discount: null, assumed: false };
  }
  return { dueDate: addDays(invoiceDate, 30), netDays: 30, discount: null, assumed: true };
}
