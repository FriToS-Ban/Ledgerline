import { money, round2 } from "@/lib/utils";
import { withinTolerance } from "./normalize";
import type {
  Decision,
  DecisionResult,
  DuplicateHit,
  Extraction,
  FiredRule,
  MatchResult,
  Normalized,
  Policy,
} from "./schema";
import { worstStatus } from "./allocate";
import { isMarketplaceDocument } from "./document-kind";

const CRITICAL = ["invoiceNumber", "invoiceDate", "total"] as const;

export function evaluateRules(input: {
  extraction: Extraction;
  normalized: Normalized;
  match: MatchResult;
  duplicates: DuplicateHit[];
  policy: Policy;
  vendorApproved: boolean;
  poClosed: boolean;
}): FiredRule[] {
  const { extraction, normalized, match, duplicates, policy, vendorApproved, poClosed } = input;
  const marketplace = isMarketplaceDocument(extraction);
  const rules: FiredRule[] = [];

  const gaps = criticalGaps(extraction, policy);
  rules.push({
    ruleId: "extraction.confidence",
    outcome: gaps.length ? "fail" : "pass",
    evidence: { gaps, floor: policy.confidenceFloor },
    humanText: gaps.length
      ? `Critical fields below ${policy.confidenceFloor * 100}% confidence: ${gaps.join(", ")}. Do not invent values.`
      : "Critical fields extracted above the confidence floor.",
  });

  if (marketplace) {
    rules.push({
      ruleId: "doc.marketplace",
      outcome: "warn",
      evidence: { kind: extraction.documentKind, vendor: extraction.vendorName },
      humanText:
        "This is a marketplace / restaurant bill (Zomato/Swiggy-style), not a supplier invoice against a purchase order. Treat it as an expense receipt.",
    });
  } else {
    rules.push({
      ruleId: "vendor.approved",
      outcome: vendorApproved ? "pass" : "fail",
      evidence: { vendor: extraction.vendorName, vendorApproved },
      humanText: vendorApproved
        ? `${extraction.vendorName} is on the approved vendor list.`
        : `${extraction.vendorName} is not an approved vendor.`,
    });
  }

  if (poClosed) {
    rules.push({
      ruleId: "po.open",
      outcome: "fail",
      evidence: { primary: match.primaryPoNumber },
      humanText: `Purchase order ${match.primaryPoNumber} is closed or fully consumed.`,
    });
  }

  if (normalized.fx?.missing && normalized.originalCurrency !== normalized.comparableCurrency) {
    rules.push({
      ruleId: "fx.missing",
      outcome: "fail",
      evidence: normalized.fx,
      humanText: `No FX rate for ${normalized.fx.pair} on the invoice date. Amount kept in ${normalized.originalCurrency}; it was not converted 1:1.`,
    });
  } else if (normalized.fx?.stale) {
    rules.push({
      ruleId: "fx.stale",
      outcome: "fail",
      evidence: normalized.fx,
      humanText: `FX rate ${normalized.fx.pair} as of ${normalized.fx.asOf} is stale (> ${policy.fxMaxAgeDays} days).`,
    });
  } else if (normalized.fx && normalized.fx.source !== "identity") {
    rules.push({
      ruleId: "fx.converted",
      outcome: "pass",
      evidence: normalized.fx,
      humanText: `Tolerance of ${policy.amountTolerancePct * 100}% or ${money(policy.amountToleranceAbs)} was applied in ${normalized.comparableCurrency} after converting at ${normalized.fx.rate} (${normalized.fx.asOf}).`,
    });
  }

  if (
    !marketplace &&
    (normalized.shippingTreatment === "embedded" || normalized.taxTreatment === "inclusive")
  ) {
    rules.push({
      ruleId: "structure.normalize",
      outcome: "warn",
      evidence: {
        tax: normalized.taxTreatment,
        shipping: normalized.shippingTreatment,
      },
      humanText:
        "Invoice tax/shipping structure differs from a typical PO (estimated freight as a separate line). Amounts were normalized before tolerance.",
    });
  }

  const primary = match.allocations[0];
  if (primary) {
    const tol = withinTolerance(primary.allocatedAmount, primary.remainingBefore, policy);
    rules.push({
      ruleId: "amount.tolerance",
      outcome: primary.status === "escalate" ? "fail" : "pass",
      evidence: { ...tol, remaining: primary.remainingBefore, allocated: primary.allocatedAmount },
      humanText: primary.evidence,
    });
  } else if (match.method === "none") {
    const orderRef = extraction.poNumbers[0];
    rules.push({
      ruleId: "po.match",
      outcome: marketplace ? "pass" : "fail",
      evidence: { candidates: match.candidates.length, marketplace, orderRef: orderRef ?? null },
      humanText: marketplace
        ? `No PO expected on a marketplace bill.${orderRef ? ` Order ${orderRef} is the reference.` : ""}`
        : "No purchase order could be matched.",
    });
  }

  if (match.method === "implied") {
    const top = match.candidates[0];
    rules.push({
      ruleId: "po.implied",
      outcome: top && top.score >= policy.impliedMatchAuto ? "pass" : "warn",
      evidence: { score: top?.score, po: top?.poNumber },
      humanText:
        top && top.score >= policy.impliedMatchAuto
          ? `No PO on the invoice; auto-matched to ${top.poNumber} (score ${top.score.toFixed(2)}).`
          : `No PO on the invoice; candidate ${top?.poNumber ?? "none"} scored ${top?.score.toFixed(2) ?? 0} and needs review.`,
    });
  }

  if (match.allocations.length > 1) {
    const mixed = new Set(match.allocations.map((a) => a.status)).size > 1;
    rules.push({
      ruleId: "po.multi",
      outcome: mixed ? "warn" : "pass",
      evidence: {
        allocations: match.allocations.map((a) => ({ po: a.poNumber, status: a.status })),
      },
      humanText: mixed
        ? `One invoice covers ${match.allocations.length} POs with mixed outcomes: ${match.allocations.map((a) => `${a.poNumber} ${a.status}`).join("; ")}.`
        : `Invoice allocated across ${match.allocations.length} POs with a consistent outcome.`,
    });
  }

  const exactDup = duplicates.find((d) => d.exactNumber);
  const nearDup = duplicates.find((d) => d.near);
  if (exactDup) {
    rules.push({
      ruleId: "duplicate.exact",
      outcome: "fail",
      evidence: exactDup,
      humanText: `Exact duplicate of ${exactDup.invoiceNumber}.`,
    });
  } else if (nearDup) {
    rules.push({
      ruleId: "duplicate.near",
      outcome: "fail",
      evidence: nearDup,
      humanText: `Likely duplicate of ${nearDup.invoiceNumber} (amount within ${policy.duplicateAmountPct * 100}%, similar lines). Escalate.`,
    });
  }

  if (extraction.annotations.some((a) => /credit|debit/i.test(a)) || (extraction.total ?? 0) < 0) {
    rules.push({
      ruleId: "doc.credit",
      outcome: "warn",
      evidence: { annotations: extraction.annotations },
      humanText: "Document looks like a credit/debit note rather than a standard invoice.",
    });
  }

  const foodLines = extraction.lineItems.filter((l) => !/platform fee/i.test(l.description));
  const packagingAlreadyLined = foodLines.some((l) => /packaging|shipping|freight/i.test(l.description));
  const lineSum = round2(foodLines.reduce((s, l) => s + l.amount, 0));
  if (extraction.total != null && foodLines.length > 0) {
    const extraShip = packagingAlreadyLined ? 0 : (extraction.shipping ?? 0);
    const extraTax = normalized.taxTreatment === "inclusive" ? 0 : (extraction.tax ?? 0);
    // Tax-inclusive lines (Indian GST bills): the packaging charge carries its own tax, so shipping alone
    // under-counts. When the bill prints an item subtotal, check the lines against that instead.
    const inclusiveWithSubtotal = foodLines.every((l) => l.taxIncluded) && extraction.subtotal != null;
    const check = inclusiveWithSubtotal
      ? round2(lineSum + (extraction.total - (extraction.subtotal as number)))
      : round2(lineSum + extraShip + extraTax);
    const drift = Math.abs(check - extraction.total);
    if (drift > 1 && drift > extraction.total * 0.005) {
      rules.push({
        ruleId: "arithmetic",
        outcome: "warn",
        evidence: { lineSum, total: extraction.total, check },
        humanText: `Line items (${lineSum}) do not add up to the stated total (${extraction.total}).`,
      });
    }
  }

  if (normalized.comparableAmount >= policy.approvalThreshold) {
    rules.push({
      ruleId: "threshold",
      outcome: "warn",
      evidence: { amount: normalized.comparableAmount, threshold: policy.approvalThreshold },
      humanText: `Amount exceeds the ${money(policy.approvalThreshold, normalized.comparableCurrency)} approval threshold even if the PO matches.`,
    });
  }

  return rules;
}

export function criticalGaps(extraction: Extraction, policy: Policy): string[] {
  const gaps: string[] = [];
  if (!extraction.invoiceNumber || extraction.invoiceNumberConfidence < policy.confidenceFloor) {
    gaps.push("invoiceNumber");
  }
  if (!extraction.invoiceDate || extraction.invoiceDateConfidence < policy.confidenceFloor) {
    gaps.push("invoiceDate");
  }
  if (extraction.total == null || extraction.totalConfidence < policy.confidenceFloor) {
    gaps.push("total");
  }
  return gaps;
}

export function recommend(rules: FiredRule[], match: MatchResult): DecisionResult {
  const fails = rules.filter((r) => r.outcome === "fail");
  const warns = rules.filter((r) => r.outcome === "warn");
  const gaps = (rules.find((r) => r.ruleId === "extraction.confidence")?.evidence.gaps ??
    []) as string[];

  let recommendation: Decision = "auto_approve";
  if (fails.some((r) => r.ruleId === "duplicate.exact" || r.ruleId === "po.open")) {
    recommendation = "reject";
  } else if (fails.some((r) => r.ruleId === "vendor.approved")) {
    recommendation = "reject";
  } else if (fails.length) {
    recommendation = "escalate";
  } else if (match.allocations.length > 1) {
    recommendation = worstStatus(match.allocations.map((a) => a.status));
  } else if (match.allocations[0]?.status === "partial_approve") {
    recommendation = "partial_approve";
  } else if (
    warns.some(
      (r) =>
        r.ruleId === "po.implied" ||
        r.ruleId === "threshold" ||
        r.ruleId === "doc.credit" ||
        r.ruleId === "doc.marketplace",
    )
  ) {
    recommendation = "escalate";
  }

  const needsHuman =
    recommendation === "escalate" ||
    recommendation === "reject" ||
    gaps.length > 0 ||
    (recommendation === "partial_approve" && warns.length > 0);

  const checklist: string[] = [];
  if (gaps.length) checklist.push(`Verify unreadable or low-confidence fields: ${gaps.join(", ")}.`);
  if (fails.find((r) => r.ruleId.startsWith("duplicate"))) {
    checklist.push("Compare against the suspected duplicate before paying.");
  }
  if (fails.find((r) => r.ruleId.startsWith("fx"))) {
    checklist.push("Confirm the FX rate with treasury; do not use a guessed rate. Do not treat rupees as dollars.");
  }
  if (warns.find((r) => r.ruleId === "doc.marketplace")) {
    checklist.push("Confirm this marketplace food bill should be expensed — it is not a supplier PO invoice.");
  }
  if (match.method === "implied") checklist.push("Confirm the pre-selected PO is the intended order.");
  if (match.allocations.length > 1) checklist.push("Confirm line allocation across the listed POs.");
  if (!checklist.length && needsHuman) checklist.push("Review the proposed decision and supporting evidence.");

  const explanation = rules.map((r) => r.humanText).join(" ");
  const confidence = Math.max(
    0.2,
    0.95 - fails.length * 0.18 - warns.length * 0.08 - gaps.length * 0.15,
  );

  return {
    recommendation,
    confidence: round2(confidence),
    explanation,
    needsHuman: needsHuman || gaps.length > 0,
    checklist,
    criticalFieldGaps: CRITICAL.filter((f) => gaps.includes(f)),
  };
}
