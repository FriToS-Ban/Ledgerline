import { allocate } from "./allocate";
import { TableFxProvider, type FxRateRow } from "./fx";
import {
  explicitMatches,
  findDuplicates,
  impliedMatch,
  type HistoricalInvoice,
  type OpenPo,
} from "./match";
import { normalizeInvoice } from "./normalize";
import { evaluateRules, recommend, type VendorProfile } from "./rules";
import { dueFromTerms } from "./terms";
import { accountKey, maskAccount } from "./bank";
import {
  DEFAULT_POLICY,
  type Extraction,
  type PipelineTrace,
  type Policy,
} from "./schema";
import { isMarketplaceDocument } from "./document-kind";

export type PipelineContext = {
  pos: OpenPo[];
  history: HistoricalInvoice[];
  fxRates: FxRateRow[];
  policy: Policy;
  vendorApproved: boolean;
  /** Vendor master record for the seller, when one matched. */
  vendor?: VendorProfile | null;
  /** Clock for date rules (tests pin it). */
  now?: Date;
};

export function runPipeline(extraction: Extraction, ctx: PipelineContext): PipelineTrace {
  const policy = ctx.policy ?? DEFAULT_POLICY;
  const invoiceDate = extraction.invoiceDate ?? "1970-01-01";
  const explicit = explicitMatches(extraction, ctx.pos);

  const marketplace = isMarketplaceDocument(extraction);
  const poCurrency = marketplace
    ? extraction.currency || "INR"
    : explicit.length === 1
      ? (ctx.pos.find((p) => p.id === explicit[0].poId)?.currency ?? "USD")
      : explicit.length > 1
        ? (ctx.pos.find((p) => p.id === explicit[0].poId)?.currency ?? "USD")
        : (ctx.pos.find((p) => p.vendorName === extraction.vendorName)?.currency ??
          ctx.pos[0]?.currency ??
          "USD");

  const provider = new TableFxProvider(ctx.fxRates);
  const normalized = normalizeInvoice(extraction, poCurrency, invoiceDate, provider, policy);

  let candidates = explicit;
  let method: PipelineTrace["match"]["method"] = "none";
  if (explicit.length > 1) {
    method = "multi";
  } else if (explicit.length === 1) {
    method = "explicit";
  } else {
    const implied = impliedMatch(
      extraction,
      ctx.pos,
      invoiceDate,
      normalized.comparableAmount,
      policy,
    );
    if (implied.length > 1 && implied[0].score - implied[1].score >= 0.05) {
      candidates = [implied[0]];
    } else {
      candidates = implied.slice(0, 3);
    }
    method = candidates.length ? "implied" : "none";
  }

  const allocations = allocate(
    extraction,
    method === "implied" ? candidates.slice(0, 1) : candidates,
    ctx.pos,
    normalized.comparableAmount,
    policy,
  );
  if (explicit.length > 1 && allocations.length > 1) method = "multi";

  const match = {
    candidates,
    allocations,
    primaryPoNumber: allocations[0]?.poNumber ?? candidates[0]?.poNumber ?? null,
    method,
  };

  const duplicates = findDuplicates(
    extraction,
    normalized.comparableAmount,
    extraction.invoiceDate,
    ctx.history,
    policy,
  );

  const poClosed = allocations.some((a) => {
    const po = ctx.pos.find((p) => p.id === a.poId);
    return po?.status === "closed" || po?.status === "consumed";
  });

  // 3-way match: a matched PO whose goods/services are not received yet cannot be paid.
  const unreceivedPos = allocations
    .map((a) => ctx.pos.find((p) => p.id === a.poId))
    .filter((po): po is NonNullable<typeof po> => !!po && po.goodsReceived === false)
    .map((po) => po.number);

  const rules = evaluateRules({
    extraction,
    normalized,
    match,
    duplicates,
    policy,
    vendorApproved: ctx.vendorApproved,
    poClosed,
    unreceivedPos,
    vendor: ctx.vendor ?? null,
    now: ctx.now,
  });
  const decision = recommend(rules, match);

  const terms = ctx.vendor?.paymentTerms ?? extraction.paymentTerms ?? null;
  const due = dueFromTerms(extraction.invoiceDate, terms);
  const payToAccount = accountKey(extraction.bankDetails) ?? ctx.vendor?.bankAccount ?? null;
  const payment = {
    dueDate: due?.dueDate ?? null,
    terms: terms ?? (due ? "Net 30 (assumed)" : null),
    termsAssumed: due?.assumed ?? !terms,
    discount: due?.discount ?? null,
    payTo: payToAccount ? maskAccount(payToAccount) : null,
  };

  return { extraction, normalized, match, duplicates, rules, decision, payment };
}
