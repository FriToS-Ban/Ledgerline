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
import { compareBank, maskAccount } from "./bank";
import { gstHeads, placeOfSupplyCode, validateGstin } from "./gst";

const CRITICAL = ["invoiceNumber", "invoiceDate", "total"] as const;

/** What the vendor master says about the seller (verified out of band, never from an invoice). */
export type VendorProfile = {
  id: string;
  name: string;
  approved: boolean;
  taxId: string | null;
  bankAccount: string | null;
  bankCode: string | null;
  paymentTerms: string | null;
};

const DAY_MS = 86_400_000;

export function evaluateRules(input: {
  extraction: Extraction;
  normalized: Normalized;
  match: MatchResult;
  duplicates: DuplicateHit[];
  policy: Policy;
  vendorApproved: boolean;
  poClosed: boolean;
  /** Matched POs whose goods/services are not marked received (3-way match). */
  unreceivedPos?: string[];
  vendor?: VendorProfile | null;
  /** Clock for date checks (injectable for tests). */
  now?: Date;
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

  rules.push(...paymentInstructionRules(extraction, input.vendor ?? null, marketplace));
  rules.push(...taxIdentityRules(extraction, input.vendor ?? null));
  rules.push(...dateRules(extraction, policy, input.now ?? new Date()));

  const unreceived = input.unreceivedPos ?? [];
  if (!marketplace && unreceived.length) {
    rules.push({
      ruleId: "receipt.missing",
      outcome: "fail",
      evidence: { pos: unreceived },
      humanText: `No goods receipt yet for ${unreceived.join(", ")}: the invoice is billing for goods or services that are not marked received (3-way match).`,
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

/** Bank details on the invoice vs the verified ones on file (business-email-compromise guard). */
function paymentInstructionRules(extraction: Extraction, vendor: VendorProfile | null, marketplace: boolean): FiredRule[] {
  const cmp = compareBank(extraction.bankDetails, vendor ? { account: vendor.bankAccount, code: vendor.bankCode } : null);
  switch (cmp.status) {
    case "none":
      return [];
    case "changed":
      return [
        {
          ruleId: "bank.changed",
          outcome: "fail",
          evidence: {
            invoiceAccount: maskAccount(cmp.invoiceAccount),
            onFile: maskAccount(cmp.onFile),
            bankCodeChanged: cmp.codeChanged,
          },
          humanText: `Bank details changed: this invoice asks for payment to account ${maskAccount(cmp.invoiceAccount)}, but the verified account on file for ${vendor?.name ?? "this vendor"} is ${maskAccount(cmp.onFile)}${cmp.codeChanged ? " at a different bank" : ""}. This is the most common invoice-fraud pattern.`,
        },
      ];
    case "match":
      return [
        {
          ruleId: "bank.verified",
          outcome: "pass",
          evidence: { account: maskAccount(cmp.invoiceAccount) },
          humanText: `Pay-to account ${maskAccount(cmp.invoiceAccount)} matches the verified vendor record.`,
        },
      ];
    case "unverified":
      return marketplace
        ? []
        : [
            {
              ruleId: "bank.unverified",
              outcome: "warn",
              evidence: { account: maskAccount(cmp.invoiceAccount) },
              humanText: `The invoice names pay-to account ${maskAccount(cmp.invoiceAccount)}, but there are no verified bank details on file for ${extraction.vendorName} to compare against.`,
            },
          ];
  }
}

/** GSTIN checksum, vendor-master match, and intra- vs inter-state tax heads. */
function taxIdentityRules(extraction: Extraction, vendor: VendorProfile | null): FiredRule[] {
  const extras = extraction.extras ?? [];
  const seller =
    extras.find((e) => e.key === "seller_gstin")?.value ??
    extraction.parties?.find((p) => p.role === "seller")?.taxId ??
    null;
  const all = [...new Set([seller, ...extras.filter((e) => /gstin/i.test(e.key)).map((e) => e.value)])].filter(
    (g): g is string => !!g && /^[0-9]{2}[A-Z0-9]{13}$/i.test(g.replace(/\s/g, "")),
  );
  if (!all.length) return [];
  const rules: FiredRule[] = [];
  const checks = all.map(validateGstin);
  const invalid = checks.filter((c) => !c.valid);
  rules.push(
    invalid.length
      ? {
          ruleId: "tax.gstin_invalid",
          outcome: "fail",
          evidence: { invalid: invalid.map((c) => ({ gstin: c.gstin, reason: c.valid ? "" : c.reason })) },
          humanText: `GSTIN ${invalid.map((c) => c.gstin).join(", ")} is not valid (${invalid[0].valid ? "" : invalid[0].reason}). Input tax credit cannot be claimed against an invalid GSTIN.`,
        }
      : {
          ruleId: "tax.gstin",
          outcome: "pass",
          evidence: { gstins: checks.map((c) => c.gstin) },
          humanText: `GSTIN ${checks.map((c) => c.gstin).join(", ")} passes the format and checksum test.`,
        },
  );
  const sellerCheck = seller ? validateGstin(seller) : null;
  const onFile = vendor?.taxId?.replace(/\s/g, "").toUpperCase() ?? null;
  if (sellerCheck?.valid && onFile && onFile !== sellerCheck.gstin) {
    rules.push({
      ruleId: "tax.id_mismatch",
      outcome: "fail",
      evidence: { invoice: sellerCheck.gstin, onFile },
      humanText: `The seller GSTIN on the invoice (${sellerCheck.gstin}) is not the one on file for ${vendor?.name} (${onFile}).`,
    });
  }
  const pos = placeOfSupplyCode(extras.find((e) => e.key === "place_of_supply")?.value);
  if (sellerCheck?.valid && pos && extraction.rawText) {
    const heads = gstHeads(extraction.rawText.split(/\n\n/)[0] ?? extraction.rawText);
    const intraExpected = sellerCheck.stateCode === pos;
    if ((intraExpected && heads.inter && !heads.intra) || (!intraExpected && heads.intra && !heads.inter)) {
      rules.push({
        ruleId: "tax.gst_type",
        outcome: "warn",
        evidence: { sellerState: sellerCheck.stateCode, placeOfSupply: pos, ...heads },
        humanText: intraExpected
          ? `Seller and place of supply are both in ${sellerCheck.state}, so CGST + SGST is expected, but the bill charges IGST.`
          : `Seller (${sellerCheck.state}) and place of supply (state ${pos}) differ, so IGST is expected, but the bill charges CGST/SGST.`,
      });
    }
  }
  return rules;
}

/** Future-dated invoices are not payable; very old ones are a classic duplicate/fraud signal. */
function dateRules(extraction: Extraction, policy: Policy, now: Date): FiredRule[] {
  const d = extraction.invoiceDate;
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return [];
  const ageDays = Math.floor((now.getTime() - new Date(`${d}T00:00:00Z`).getTime()) / DAY_MS);
  if (ageDays < -1) {
    return [
      {
        ruleId: "date.future",
        outcome: "fail",
        evidence: { invoiceDate: d, daysAhead: -ageDays },
        humanText: `The invoice is dated ${d}, ${-ageDays} days in the future.`,
      },
    ];
  }
  if (policy.staleInvoiceDays > 0 && ageDays > policy.staleInvoiceDays) {
    return [
      {
        ruleId: "date.stale",
        outcome: "warn",
        evidence: { invoiceDate: d, ageDays, limit: policy.staleInvoiceDays },
        humanText: `The invoice is ${ageDays} days old (limit ${policy.staleInvoiceDays}); old invoices resurfacing are a common duplicate-payment pattern.`,
      },
    ];
  }
  return [];
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
  if (fails.some((r) => r.ruleId === "bank.changed")) {
    checklist.push(
      "Do not pay the new account. Call the vendor on a phone number from your own records (never one from this invoice or email) to confirm the change.",
    );
  }
  if (gaps.length) checklist.push(`Verify unreadable or low-confidence fields: ${gaps.join(", ")}.`);
  if (fails.some((r) => r.ruleId === "receipt.missing")) {
    checklist.push("Confirm the goods or services were received (goods receipt) before paying.");
  }
  if (fails.some((r) => r.ruleId.startsWith("tax."))) {
    checklist.push("Check the supplier's GSTIN on the GST portal before paying or claiming input tax credit.");
  }
  if (fails.some((r) => r.ruleId === "date.future")) checklist.push("Confirm the invoice date; a future-dated invoice is not payable yet.");
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
