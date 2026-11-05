import { jaccard, normalizeName, tokenize } from "@/lib/utils";
import { withinTolerance } from "./normalize";
import type { Extraction, MatchCandidate, Policy } from "./schema";

export type OpenPo = {
  id: string;
  number: string;
  vendorName: string;
  vendorId: string;
  amount: number;
  currency: string;
  status: "open" | "closed" | "consumed";
  issueDate: string;
  description: string;
  alreadyMatched: number;
  goodsReceived: boolean;
};

export function remainingBalance(po: OpenPo): number {
  return Math.max(0, Math.round((po.amount - po.alreadyMatched) * 100) / 100);
}

export function explicitMatches(extraction: Extraction, pos: OpenPo[]): MatchCandidate[] {
  const refs = new Set(extraction.poNumbers.map((p) => p.replace(/\s+/g, "").toUpperCase()));
  for (const line of extraction.lineItems) {
    if (line.poNumber) refs.add(line.poNumber.replace(/\s+/g, "").toUpperCase());
  }
  return pos
    .filter((p) => refs.has(p.number.replace(/\s+/g, "").toUpperCase()))
    .map((p) => ({
      poNumber: p.number,
      poId: p.id,
      score: 1,
      method: "explicit" as const,
      reasons: [`Invoice cites ${p.number}.`],
    }));
}

export function impliedMatch(
  extraction: Extraction,
  pos: OpenPo[],
  invoiceDate: string,
  comparableAmount: number,
  policy: Policy,
): MatchCandidate[] {
  const vendor = normalizeName(extraction.vendorName);
  const desc = tokenize(extraction.lineItems.map((l) => l.description).join(" "));
  return pos
    .filter((p) => p.status === "open")
    .map((p) => {
      const reasons: string[] = [];
      let score = 0;
      const vendorScore = jaccard(tokenize(vendor), tokenize(normalizeName(p.vendorName)));
      if (vendorScore >= 0.5) {
        score += 0.4 * vendorScore;
        reasons.push(`Vendor similarity ${vendorScore.toFixed(2)} with ${p.vendorName}.`);
      }
      const dateDelta = Math.abs(Date.parse(invoiceDate) - Date.parse(p.issueDate)) / 86_400_000;
      if (dateDelta <= policy.dateWindowDays) {
        const dateScore = 1 - dateDelta / policy.dateWindowDays;
        score += 0.2 * dateScore;
        reasons.push(`Invoice date is ${Math.round(dateDelta)} days from PO ${p.number} (${p.issueDate}).`);
      }
      const rem = remainingBalance(p);
      const amt = withinTolerance(comparableAmount, rem, policy);
      const amtRatio =
        rem === 0 ? 0 : 1 - Math.min(1, Math.abs(comparableAmount - rem) / Math.max(rem, 1));
      score += 0.25 * amtRatio;
      if (amt.ok) reasons.push(`Amount ${comparableAmount} is within tolerance of remaining ${rem}.`);
      else reasons.push(`Amount ${comparableAmount} vs remaining ${rem} (delta ${amt.delta}).`);
      const descScore = jaccard(desc, tokenize(p.description));
      score += 0.15 * descScore;
      if (descScore > 0.2) reasons.push(`Line description overlap ${descScore.toFixed(2)}.`);
      return {
        poNumber: p.number,
        poId: p.id,
        score: Math.min(1, score),
        method: "implied" as const,
        reasons,
      };
    })
    .filter((c) => c.score >= policy.impliedMatchEscalate)
    .sort((a, b) => b.score - a.score);
}

export type HistoricalInvoice = {
  invoiceNumber: string;
  vendorName: string;
  amount: number;
  date: string | null;
  lineText: string;
  status: string;
};

export function findDuplicates(
  extraction: Extraction,
  amount: number,
  date: string | null,
  history: HistoricalInvoice[],
  policy: Policy,
) {
  const vendor = normalizeName(extraction.vendorName);
  const lines = tokenize(extraction.lineItems.map((l) => l.description).join(" "));
  const hits = [];
  for (const prior of history) {
    if (normalizeName(prior.vendorName) !== vendor) continue;
    const exactNumber =
      !!extraction.invoiceNumber &&
      prior.invoiceNumber.toLowerCase() === extraction.invoiceNumber.toLowerCase();
    const amountDelta = Math.abs(amount - prior.amount);
    const amountPct = prior.amount === 0 ? 1 : amountDelta / prior.amount;
    const dateOk =
      !date ||
      !prior.date ||
      Math.abs(Date.parse(date) - Date.parse(prior.date)) / 86_400_000 <=
        policy.duplicateDateWindowDays;
    const lineSim = jaccard(lines, tokenize(prior.lineText));
    const near =
      !exactNumber &&
      amountPct <= policy.duplicateAmountPct &&
      dateOk &&
      lineSim >= 0.45;
    if (exactNumber || near) {
      hits.push({
        invoiceNumber: prior.invoiceNumber,
        amount: prior.amount,
        date: prior.date,
        similarity: exactNumber ? 1 : (1 - amountPct) * 0.6 + lineSim * 0.4,
        exactNumber,
        near,
      });
    }
  }
  return hits.sort((a, b) => b.similarity - a.similarity);
}
