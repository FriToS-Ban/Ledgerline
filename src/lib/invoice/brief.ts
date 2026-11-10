import { money } from "@/lib/utils";
import type { Decision, PipelineTrace } from "./schema";

export type DecisionBrief = {
  verb: string;
  stance: string;
  amount: string;
  currency: string;
  howSure: string;
  why: string[];
  facts: { label: string; value: string; warn?: boolean }[];
  extras: { label: string; value: string }[];
  parties: { role: string; name: string; taxId?: string | null }[];
  slices: { title: string; invoiceNumber: string | null; amount: string; note?: string }[];
  lines: { description: string; amount: string; qty: string }[];
  checks: { label: string; outcome: "pass" | "warn" | "fail"; text: string }[];
  ask: string[];
  kindLabel: string;
  analystNote?: string;
  analystModel?: string;
  analystHeadline?: string;
  analystSoWhat?: string;
};

const VERB: Record<Decision, string> = {
  auto_approve: "Release payment",
  partial_approve: "Release the matched amount",
  escalate: "Hold payment",
  reject: "Block payment",
};

const KIND: Record<string, string> = {
  supplier_invoice: "Supplier invoice",
  marketplace_invoice: "Marketplace invoice",
  order_receipt: "Order receipt / screenshot",
  mixed_pack: "Pack of documents",
  unknown: "Document",
};

const ROLE: Record<string, string> = {
  seller: "Seller",
  marketplace: "Platform",
  buyer: "Customer",
  ship_to: "Deliver to",
};

export function buildBrief(trace: PipelineTrace): DecisionBrief {
  const d = trace.decision.recommendation;
  const x = trace.extraction;
  const why = [
    ...trace.rules.filter((r) => r.outcome !== "pass").map((r) => r.humanText),
    ...trace.decision.checklist,
  ].slice(0, 4);
  if (!why.length) {
    why.push(trace.decision.explanation);
  }

  const facts: DecisionBrief["facts"] = [
    { label: "Who to pay", value: x.vendorName, warn: x.vendorConfidence < 0.7 },
    { label: "Invoice #", value: x.invoiceNumber ?? "Not found", warn: !x.invoiceNumber },
    { label: "Date", value: x.invoiceDate ?? "Not found", warn: !x.invoiceDate },
    {
      label: "Amount on document",
      value: x.total != null ? money(x.total, x.currency) : "Not found",
      warn: x.total == null,
    },
  ];
  const n = trace.normalized;
  const converted =
    n.comparableCurrency !== n.originalCurrency && !n.fx?.missing;
  if (converted) {
    facts.push({
      label: "In our books",
      value: money(n.comparableAmount, n.comparableCurrency),
    });
  }
  facts.push({
    label: x.documentKind === "marketplace_invoice" || x.documentKind === "mixed_pack" || x.documentKind === "order_receipt"
      ? "Order #"
      : "Linked order / PO",
    value: x.poNumbers.join(", ") || "None on the page",
    warn: !x.poNumbers.length && x.documentKind !== "marketplace_invoice" && x.documentKind !== "mixed_pack",
  });

  if (n.fx?.missing) {
    facts.push({
      label: "FX",
      value: `Not converted. Kept as ${n.originalCurrency} — not 1:1 ${n.fx.pair.replace(/.*\//, "")}.`,
      warn: true,
    });
  } else if (n.fx && n.fx.source !== "identity") {
    facts.push({
      label: "FX used",
      value: `${n.fx.pair} @ ${n.fx.rate} (${n.fx.asOf})`,
      warn: n.fx.stale,
    });
  }

  return {
    verb: VERB[d],
    stance: trace.decision.explanation,
    amount: x.total != null ? money(x.total, x.currency) : "—",
    currency: x.currency,
    howSure: `${Math.round(trace.decision.confidence * 100)}% sure`,
    why,
    facts,
    extras: (x.extras ?? []).map((e) => ({ label: e.label, value: e.value })),
    parties: (x.parties ?? []).map((p) => ({
      role: ROLE[p.role] ?? p.role,
      name: p.name,
      taxId: p.taxId,
    })),
    slices: (x.slices ?? []).map((s) => ({
      title: s.title,
      invoiceNumber: s.invoiceNumber,
      amount: s.total != null ? money(s.total, s.currency) : "—",
      note: s.note,
    })),
    lines: x.lineItems.map((l) => ({
      description: l.description,
      amount: money(l.amount, x.currency),
      qty: l.quantity != null ? String(l.quantity) : "—",
    })),
    checks: trace.rules.map((r) => ({
      label: r.ruleId.replace(/\./g, " · "),
      outcome: r.outcome,
      text: r.humanText,
    })),
    ask: trace.decision.needsHuman
      ? trace.decision.checklist.length
        ? trace.decision.checklist
        : ["A person needs to confirm before this posts."]
      : ["No action required. This is ready to post."],
    kindLabel: KIND[x.documentKind ?? "unknown"] ?? "Document",
    analystNote: trace.decision.analystNote,
    analystModel: trace.decision.analystModel,
    analystHeadline: trace.decision.analystHeadline,
    analystSoWhat: trace.decision.analystSoWhat,
  };
}
