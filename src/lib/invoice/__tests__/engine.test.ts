import { describe, expect, it } from "vitest";
import type { Extraction } from "../schema";
import { allocate, worstStatus } from "../allocate";
import { TableFxProvider, convertAmount } from "../fx";
import { FIXTURES } from "@/lib/fixtures/cases";
import { impliedMatch, remainingBalance, findDuplicates, type OpenPo } from "../match";
import { normalizeInvoice, withinTolerance } from "../normalize";
import { runPipeline } from "../pipeline";
import { buildBrief } from "../brief";
import { criticalGaps } from "../rules";
import { DEFAULT_POLICY } from "../schema";

const fx = new TableFxProvider([
  { base: "EUR", quote: "USD", rate: 1.082, asOf: "2026-10-28", source: "seed" },
]);

const pos: OpenPo[] = [
  {
    id: "po-31000",
    number: "PO-31000",
    vendorId: "v-apex",
    vendorName: "Apex Industrial Supply",
    amount: 31000,
    currency: "USD",
    status: "open",
    issueDate: "2026-09-01",
    description: "Stainless fastener kit blanket progressive billing",
    alreadyMatched: 12400,
    goodsReceived: true,
  },
  {
    id: "po-88021",
    number: "PO-88021",
    vendorId: "v-apex",
    vendorName: "Apex Industrial Supply",
    amount: 8450,
    currency: "USD",
    status: "open",
    issueDate: "2026-10-02",
    description: "Stainless fasteners kit hex cap screws M8",
    alreadyMatched: 0,
    goodsReceived: true,
  },
  {
    id: "po-4410",
    number: "PO-4410",
    vendorId: "v-north",
    vendorName: "Northwind Logistics",
    amount: 5380,
    currency: "USD",
    status: "open",
    issueDate: "2026-10-01",
    description: "Inbound logistics estimated freight",
    alreadyMatched: 0,
    goodsReceived: true,
  },
  {
    id: "po-5519",
    number: "PO-5519",
    vendorId: "v-apex",
    vendorName: "Apex Industrial Supply",
    amount: 4210,
    currency: "USD",
    status: "open",
    issueDate: "2026-10-10",
    description: "Metric hex nuts assortment",
    alreadyMatched: 4210,
    goodsReceived: true,
  },
  {
    id: "po-eur-19",
    number: "PO-EUR-19",
    vendorId: "v-helios",
    vendorName: "Helios Components GmbH",
    amount: 10603.6,
    currency: "USD",
    status: "open",
    issueDate: "2026-10-05",
    description: "Precision bearings 6204-2RS",
    alreadyMatched: 0,
    goodsReceived: true,
  },
  {
    id: "po-7701",
    number: "PO-7701",
    vendorId: "v-meridian",
    vendorName: "Meridian Facilities",
    amount: 3000,
    currency: "USD",
    status: "open",
    issueDate: "2026-10-08",
    description: "Q4 HVAC filter replacement",
    alreadyMatched: 0,
    goodsReceived: true,
  },
  {
    id: "po-7702",
    number: "PO-7702",
    vendorId: "v-meridian",
    vendorName: "Meridian Facilities",
    amount: 1800,
    currency: "USD",
    status: "open",
    issueDate: "2026-10-08",
    description: "Emergency rooftop unit service",
    alreadyMatched: 0,
    goodsReceived: true,
  },
];

const history = [
  {
    invoiceNumber: "INV-8842",
    vendorName: "Apex Industrial Supply",
    amount: 4210,
    date: "2026-10-20",
    lineText: "Metric hex nuts assortment 8-12mm",
    status: "approved",
  },
];

function ctx(vendorApproved = true) {
  return {
    pos,
    history,
    fxRates: [{ base: "EUR", quote: "USD", rate: 1.082, asOf: "2026-10-28", source: "seed" as const }],
    policy: DEFAULT_POLICY,
    vendorApproved,
  };
}

describe("remaining balance", () => {
  it("tracks cumulative matches on a split PO", () => {
    expect(remainingBalance(pos[0])).toBe(18600);
  });
});

describe("tolerance", () => {
  it("allows 2% or $50", () => {
    expect(withinTolerance(5395, 5380, DEFAULT_POLICY).ok).toBe(true);
    expect(withinTolerance(200, 100, DEFAULT_POLICY).ok).toBe(false);
  });
});

describe("fx", () => {
  it("converts EUR to USD on invoice date", () => {
    const r = convertAmount(9800, "EUR", "USD", "2026-10-28", fx, DEFAULT_POLICY);
    expect(r.amount).toBe(10603.6);
    expect(r.fx.missing).toBe(false);
    expect(r.fx.stale).toBe(false);
  });
  it("flags missing rates", () => {
    const r = convertAmount(100, "JPY", "USD", "2026-10-28", fx, DEFAULT_POLICY);
    expect(r.fx.missing).toBe(true);
  });
});

describe("edge cases", () => {
  it("partial billing recommends partial_approve", () => {
    const t = runPipeline(FIXTURES.partial, ctx());
    expect(t.match.allocations[0].remainingBefore).toBe(18600);
    expect(t.decision.recommendation).toBe("partial_approve");
  });

  it("implied PO matches PO-88021", () => {
    const implied = impliedMatch(FIXTURES.implied, pos, "2026-10-18", 8450, DEFAULT_POLICY);
    expect(implied[0].poNumber).toBe("PO-88021");
    const t = runPipeline(FIXTURES.implied, ctx());
    expect(t.match.method).toBe("implied");
    expect(t.match.primaryPoNumber).toBe("PO-88021");
  });

  it("tax/shipping structure still within tolerance", () => {
    const n = normalizeInvoice(FIXTURES["tax-shipping"], "USD", "2026-10-22", fx, DEFAULT_POLICY);
    expect(n.taxTreatment).toBe("inclusive");
    expect(n.shippingTreatment).toBe("embedded");
    const t = runPipeline(FIXTURES["tax-shipping"], ctx());
    expect(t.rules.some((r) => r.ruleId === "structure.normalize")).toBe(true);
    expect(["auto_approve", "partial_approve"]).toContain(t.decision.recommendation);
  });

  it("near-duplicate of INV-8842", () => {
    const hits = findDuplicates(FIXTURES["near-dup"], 4273, "2026-10-23", history, DEFAULT_POLICY);
    expect(hits[0].invoiceNumber).toBe("INV-8842");
    expect(hits[0].near).toBe(true);
    const t = runPipeline(FIXTURES["near-dup"], ctx());
    expect(t.decision.recommendation).toBe("escalate");
    expect(t.decision.explanation).toMatch(/INV-8842/);
  });

  it("FX invoice converts then matches", () => {
    const t = runPipeline(FIXTURES["fx-eur"], ctx());
    expect(t.normalized.comparableAmount).toBe(10603.6);
    expect(t.normalized.fx?.pair).toBe("EUR/USD");
    expect(t.decision.recommendation).toBe("auto_approve");
  });

  it("multi-PO mixed outcome", () => {
    const t = runPipeline(FIXTURES["multi-po"], ctx());
    expect(t.match.allocations).toHaveLength(2);
    expect(worstStatus(t.match.allocations.map((a) => a.status))).toBe("escalate");
    expect(t.decision.recommendation).toBe("escalate");
  });

  it("decision brief speaks in pay/hold language", () => {
    const t = runPipeline(FIXTURES["near-dup"], ctx());
    const brief = buildBrief(t);
    expect(brief.verb).toBe("Hold payment");
    expect(brief.facts.some((f) => f.label === "Who to pay")).toBe(true);
    expect(brief.ask.length).toBeGreaterThan(0);
  });

  it("engine memo never changes the recommendation", async () => {
    const { engineMemo } = await import("@/mastra/narrate");
    const t = runPipeline(FIXTURES["near-dup"], ctx());
    const before = t.decision.recommendation;
    const memo = engineMemo(t);
    expect(t.decision.recommendation).toBe(before);
    expect(memo.memo).toMatch(/Hold/i);
    expect(memo.headline).toMatch(/Hold/i);
    expect(memo.model).toBe("engine");
  });

  it("does not pretend rupees are dollars on a marketplace bill", () => {
    const taco: Extraction = {
      source: "digital" as const,
      documentKind: "mixed_pack" as const,
      vendorName: "TACO BELL RESTRO",
      vendorConfidence: 0.9,
      invoiceNumber: "26DM1P3I00016606",
      invoiceNumberConfidence: 0.92,
      invoiceDate: "2026-10-12",
      invoiceDateConfidence: 0.92,
      currency: "INR",
      poNumbers: ["8713777656"],
      lineItems: [
        { id: "l1", description: "American Grilled Chicken Burger Combo", quantity: 1, unitPrice: null, amount: 175.55, taxIncluded: true },
        { id: "l2", description: "Chicken Snacker Burger", quantity: 1, unitPrice: null, amount: 124.75, taxIncluded: true },
      ],
      subtotal: 300.3,
      tax: null,
      shipping: 30.03,
      total: 330.33,
      totalConfidence: 0.93,
      annotations: ["order:8713777656"],
      parties: [{ role: "seller" as const, name: "TACO BELL RESTRO" }],
      extras: [],
      slices: [],
      pageCount: 2,
      classification: { digitalPages: 2, scannedPages: 0, mixed: false },
    };
    const t = runPipeline(taco, ctx());
    expect(t.normalized.comparableCurrency).toBe("INR");
    expect(t.normalized.comparableAmount).toBe(330.33);
    expect(t.decision.recommendation).toBe("escalate");
    expect(t.rules.some((r) => r.ruleId === "vendor.approved" && r.outcome === "fail")).toBe(false);
    expect(t.rules.some((r) => r.ruleId === "arithmetic")).toBe(false);
    const brief = buildBrief(t);
    expect(brief.amount).toContain("330.33");
    expect(brief.facts.some((f) => /\$330/.test(f.value))).toBe(false);
    expect(brief.why.join(" ")).not.toMatch(/not an approved vendor/i);
  });

  it("low confidence refuses to invent and needs human", () => {
    const gaps = criticalGaps(FIXTURES["low-confidence"], DEFAULT_POLICY);
    expect(gaps).toContain("invoiceNumber");
    expect(gaps).toContain("total");
    const t = runPipeline(FIXTURES["low-confidence"], ctx());
    expect(t.decision.needsHuman).toBe(true);
    expect(t.decision.criticalFieldGaps.length).toBeGreaterThan(0);
  });
});

describe("allocate", () => {
  it("keeps a single PO allocation", () => {
    const a = allocate(
      FIXTURES.partial,
      [{ poNumber: "PO-31000", poId: "po-31000", score: 1, method: "explicit", reasons: [] }],
      pos,
      12400,
      DEFAULT_POLICY,
    );
    expect(a[0].status).toBe("partial_approve");
  });
});
