import { round2 } from "@/lib/utils";
import { convertAmount, type FxProvider } from "./fx";
import type { Extraction, Normalized, Policy } from "./schema";

export function normalizeInvoice(
  extraction: Extraction,
  poCurrency: string,
  invoiceDate: string,
  provider: FxProvider,
  policy: Policy,
): Normalized {
  const notes: string[] = [];
  const originalTotal = extraction.total ?? sumLines(extraction);
  const originalCurrency = extraction.currency || "USD";

  const hasSeparateTax = (extraction.tax ?? 0) > 0;
  const taxTreatment = hasSeparateTax
    ? "exclusive"
    : extraction.lineItems.some((l) => l.taxIncluded)
      ? "inclusive"
      : "unknown";

  const hasSeparateShipping = (extraction.shipping ?? 0) > 0;
  const shippingTreatment = hasSeparateShipping
    ? "separate"
    : /ship|freight|delivery/i.test(
          extraction.lineItems.map((l) => l.description).join(" "),
        )
      ? "embedded"
      : "none";

  if (taxTreatment === "inclusive") {
    notes.push("Tax appears embedded in line items; comparable amount uses grand total.");
  } else if (taxTreatment === "exclusive") {
    notes.push("Tax is separated on the invoice; matching uses pre-tax plus shipping unless the PO is tax-inclusive.");
  }
  if (shippingTreatment === "embedded") {
    notes.push("Shipping is rolled into line items rather than a freight line.");
  }

  const converted = convertAmount(
    originalTotal,
    originalCurrency,
    poCurrency,
    invoiceDate,
    provider,
    policy,
  );
  if (converted.fx.missing) {
    notes.push(
      `No FX rate for ${converted.fx.pair} on ${invoiceDate}. Amount kept in ${originalCurrency} — not restated 1:1 as ${poCurrency}.`,
    );
  } else if (converted.fx.stale) {
    notes.push(
      `FX rate ${converted.fx.pair} dated ${converted.fx.asOf} is older than ${policy.fxMaxAgeDays} days.`,
    );
  } else if (converted.fx.source !== "identity") {
    notes.push(
      `Converted ${originalCurrency} ${originalTotal} → ${poCurrency} ${converted.amount} at ${converted.fx.rate} (${converted.fx.asOf}).`,
    );
  }

  const fxFailed = converted.fx.missing;
  const comparableCurrency = (fxFailed ? originalCurrency : poCurrency).toUpperCase();
  const comparableAmount = fxFailed ? round2(originalTotal) : converted.amount;

  const lineComparable = extraction.lineItems.map((line) => {
    const c = convertAmount(
      line.amount,
      originalCurrency,
      comparableCurrency,
      invoiceDate,
      provider,
      policy,
    );
    return {
      id: line.id,
      amount: fxFailed ? round2(line.amount) : c.amount,
      currency: comparableCurrency,
    };
  });

  return {
    taxTreatment,
    shippingTreatment,
    comparableAmount,
    comparableCurrency,
    originalTotal: round2(originalTotal),
    originalCurrency,
    fx: converted.fx,
    lineComparable,
    notes,
  };
}

function sumLines(extraction: Extraction): number {
  return round2(extraction.lineItems.reduce((s, l) => s + l.amount, 0));
}

export function withinTolerance(
  actual: number,
  expected: number,
  policy: Pick<Policy, "amountTolerancePct" | "amountToleranceAbs">,
): { ok: boolean; delta: number; allowed: number } {
  const delta = round2(Math.abs(actual - expected));
  const allowed = Math.max(
    policy.amountToleranceAbs,
    round2(Math.abs(expected) * policy.amountTolerancePct),
  );
  return { ok: delta <= allowed, delta, allowed };
}
