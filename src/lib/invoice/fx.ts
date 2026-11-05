import { round2 } from "@/lib/utils";
import type { FxUsed, Policy } from "./schema";

export type FxRateRow = {
  base: string;
  quote: string;
  rate: number;
  asOf: string;
  source: "seed" | "provider";
};

export interface FxProvider {
  lookup(base: string, quote: string, onDate: string): FxRateRow | null;
}

export class TableFxProvider implements FxProvider {
  constructor(private rates: FxRateRow[]) {}

  lookup(base: string, quote: string, onDate: string): FxRateRow | null {
    const b = base.toUpperCase();
    const q = quote.toUpperCase();
    if (b === q) {
      return { base: b, quote: q, rate: 1, asOf: onDate, source: "seed" };
    }
    const direct = this.rates
      .filter((r) => r.base === b && r.quote === q && r.asOf <= onDate)
      .sort((a, c) => c.asOf.localeCompare(a.asOf))[0];
    if (direct) return direct;
    const inverse = this.rates
      .filter((r) => r.base === q && r.quote === b && r.asOf <= onDate)
      .sort((a, c) => c.asOf.localeCompare(a.asOf))[0];
    if (inverse) {
      return {
        base: b,
        quote: q,
        rate: round2(1 / inverse.rate * 1e6) / 1e6,
        asOf: inverse.asOf,
        source: inverse.source,
      };
    }
    return null;
  }
}

export function convertAmount(
  amount: number,
  from: string,
  to: string,
  onDate: string,
  provider: FxProvider,
  policy: Policy,
): { amount: number; fx: FxUsed } {
  const src = from.toUpperCase();
  const dst = to.toUpperCase();
  if (src === dst) {
    return {
      amount: round2(amount),
      fx: {
        pair: `${src}/${dst}`,
        rate: 1,
        asOf: onDate,
        source: "identity",
        stale: false,
        missing: false,
      },
    };
  }
  const row = provider.lookup(src, dst, onDate);
  if (!row) {
    return {
      amount: round2(amount),
      fx: {
        pair: `${src}/${dst}`,
        rate: 0,
        asOf: onDate,
        source: "seed",
        stale: false,
        missing: true,
      },
    };
  }
  const ageDays = Math.round(
    (Date.parse(onDate) - Date.parse(row.asOf)) / 86_400_000,
  );
  const stale = ageDays > policy.fxMaxAgeDays;
  return {
    amount: round2(amount * row.rate),
    fx: {
      pair: `${src}/${dst}`,
      rate: row.rate,
      asOf: row.asOf,
      source: row.source,
      stale,
      missing: false,
    },
  };
}
