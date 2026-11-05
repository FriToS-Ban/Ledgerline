import { round2 } from "@/lib/utils";
import { remainingBalance, type OpenPo } from "./match";
import { withinTolerance } from "./normalize";
import type { Allocation, Decision, Extraction, MatchCandidate, Policy } from "./schema";

const rank: Record<Decision, number> = {
  auto_approve: 0,
  partial_approve: 1,
  escalate: 2,
  reject: 3,
};

export function worstStatus(statuses: Decision[]): Decision {
  return statuses.reduce((w, s) => (rank[s] > rank[w] ? s : w), "auto_approve");
}

export function allocate(
  extraction: Extraction,
  candidates: MatchCandidate[],
  pos: OpenPo[],
  comparableAmount: number,
  policy: Policy,
): Allocation[] {
  const byNumber = new Map(pos.map((p) => [p.number, p]));
  const unique = uniqueCandidates(candidates);
  if (unique.length === 0) return [];

  if (unique.length === 1) {
    const po = byNumber.get(unique[0].poNumber);
    if (!po) return [];
    return [allocationForPo(po, extraction.lineItems.map((l) => l.id), comparableAmount, policy)];
  }

  const lineMap = new Map<string, string[]>();
  for (const line of extraction.lineItems) {
    const cited = line.poNumber
      ? unique.find(
          (c) => c.poNumber.replace(/\s+/g, "").toUpperCase() === line.poNumber!.replace(/\s+/g, "").toUpperCase(),
        )
      : undefined;
    const target = cited?.poNumber ?? "";
    if (!target) continue;
    const list = lineMap.get(target) ?? [];
    list.push(line.id);
    lineMap.set(target, list);
  }

  const amounts = new Map<string, number>();
  for (const line of extraction.lineItems) {
    const cited = line.poNumber
      ? unique.find(
          (c) => c.poNumber.replace(/\s+/g, "").toUpperCase() === line.poNumber!.replace(/\s+/g, "").toUpperCase(),
        )?.poNumber
      : undefined;
    if (!cited) continue;
    amounts.set(cited, round2((amounts.get(cited) ?? 0) + line.amount));
  }

  const unassigned = extraction.lineItems.filter((l) => !l.poNumber);
  if (unassigned.length && unique.length > 0 && amounts.size < unique.length) {
    const leftover = round2(unassigned.reduce((s, l) => s + l.amount, 0));
    const missing = unique.find((c) => !amounts.has(c.poNumber));
    if (missing) {
      amounts.set(missing.poNumber, leftover);
      lineMap.set(
        missing.poNumber,
        unassigned.map((l) => l.id),
      );
    }
  }

  if (amounts.size === 0) {
    return unique.map((c) => {
      const po = byNumber.get(c.poNumber)!;
      const share = round2(comparableAmount / unique.length);
      return allocationForPo(po, extraction.lineItems.map((l) => l.id), share, policy);
    });
  }

  return unique
    .map((c) => {
      const po = byNumber.get(c.poNumber);
      if (!po) return null;
      const amt = amounts.get(c.poNumber) ?? 0;
      return allocationForPo(po, lineMap.get(c.poNumber) ?? [], amt, policy);
    })
    .filter((a): a is Allocation => a !== null);
}

function uniqueCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  const seen = new Set<string>();
  const out: MatchCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.poId)) continue;
    seen.add(c.poId);
    out.push(c);
  }
  return out;
}

function allocationForPo(
  po: OpenPo,
  lineIds: string[],
  allocatedAmount: number,
  policy: Policy,
): Allocation {
  const already = po.alreadyMatched;
  const remainingBefore = remainingBalance(po);
  const remainingAfter = round2(remainingBefore - allocatedAmount);
  const variance = round2(allocatedAmount - remainingBefore);
  const tol = withinTolerance(allocatedAmount, remainingBefore, policy);
  let status: Decision = "auto_approve";
  if (po.status === "closed" || po.status === "consumed") status = "reject";
  else if (allocatedAmount <= 0) status = "escalate";
  else if (allocatedAmount < remainingBefore - tol.allowed && allocatedAmount > 0) {
    status = remainingAfter > 0 ? "partial_approve" : "auto_approve";
  } else if (!tol.ok && allocatedAmount > remainingBefore) {
    status = "escalate";
  } else if (remainingAfter > tol.allowed) {
    status = "partial_approve";
  }

  const evidence =
    status === "partial_approve"
      ? `Partial match — ${allocatedAmount} of ${remainingBefore} remaining on ${po.number}.`
      : status === "escalate" && variance > 0
        ? `${po.number} over remaining by ${variance} (allowed ${tol.allowed}).`
        : `Allocated ${allocatedAmount} against ${po.number} remaining ${remainingBefore}.`;

  return {
    poNumber: po.number,
    poId: po.id,
    lineIds,
    allocatedAmount,
    poAmount: po.amount,
    alreadyMatched: already,
    remainingBefore,
    remainingAfter: Math.max(0, remainingAfter),
    variance,
    withinTolerance: tol.ok || allocatedAmount <= remainingBefore,
    status,
    evidence,
  };
}
