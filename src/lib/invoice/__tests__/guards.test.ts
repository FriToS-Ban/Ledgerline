import { describe, expect, it } from "vitest";
import { FIXTURES } from "@/lib/fixtures/cases";
import { parseInvoiceText } from "@/lib/extract/parse-text";
import { runPipeline, type PipelineContext } from "../pipeline";
import type { OpenPo } from "../match";
import type { VendorProfile } from "../rules";
import { DEFAULT_POLICY, type Extraction } from "../schema";
import { compareBank, isValidIban, isValidIfsc, isValidRouting, maskAccount, parseBankDetails } from "../bank";
import { placeOfSupplyCode, validateGstin } from "../gst";
import { dueFromTerms } from "../terms";

const NOW = new Date("2026-11-24T00:00:00Z");

const po = (over: Partial<OpenPo>): OpenPo => ({
  id: "po-7740",
  number: "PO-7740",
  vendorId: "v-meridian",
  vendorName: "Meridian Facilities",
  amount: 2450,
  currency: "USD",
  status: "open",
  issueDate: "2026-10-20",
  description: "Q4 janitorial services",
  alreadyMatched: 0,
  goodsReceived: true,
  ...over,
});

const meridian: VendorProfile = {
  id: "v-meridian",
  name: "Meridian Facilities",
  approved: true,
  taxId: null,
  bankAccount: "4839201928",
  bankCode: "021000021",
  paymentTerms: "2/10 Net 30",
};

function ctx(over: Partial<PipelineContext> = {}): PipelineContext {
  return {
    pos: [po({})],
    history: [],
    fxRates: [],
    policy: DEFAULT_POLICY,
    vendorApproved: true,
    vendor: meridian,
    now: NOW,
    ...over,
  };
}

const ids = (t: ReturnType<typeof runPipeline>) => t.rules.map((r) => `${r.ruleId}:${r.outcome}`);

describe("bank-detail change (business email compromise)", () => {
  it("holds a known vendor's invoice that asks to pay a new account, and says what to do", () => {
    const t = runPipeline(structuredClone(FIXTURES["bank-change"]), ctx());
    expect(ids(t)).toContain("bank.changed:fail");
    expect(t.decision.recommendation).toBe("escalate");
    expect(t.decision.needsHuman).toBe(true);
    expect(t.decision.checklist[0]).toMatch(/phone number from your own records/);
    const rule = t.rules.find((r) => r.ruleId === "bank.changed")!;
    expect(rule.humanText).toContain("…4431");
    expect(rule.humanText).toContain("…1928");
    expect(rule.humanText).not.toContain("7712004431"); // never the full account number
  });

  it("passes when the invoice's account is the verified one", () => {
    const x = structuredClone(FIXTURES["bank-change"]);
    x.bankDetails = { accountNumber: "4839201928", routingNumber: "021000021" };
    const t = runPipeline(x, ctx());
    expect(ids(t)).toContain("bank.verified:pass");
    expect(t.decision.recommendation).toBe("auto_approve");
  });

  it("flags a same-account, different-bank change", () => {
    expect(compareBank({ accountNumber: "4839201928", routingNumber: "026009593" }, { account: "4839201928", code: "021000021" })).toMatchObject({
      status: "changed",
      codeChanged: true,
    });
  });

  it("warns (without blocking) when nothing is on file to compare with", () => {
    const t = runPipeline(structuredClone(FIXTURES["bank-change"]), ctx({ vendor: { ...meridian, bankAccount: null, bankCode: null } }));
    expect(ids(t)).toContain("bank.unverified:warn");
    expect(t.decision.recommendation).toBe("auto_approve");
  });

  it("reads remittance blocks and validates IBAN, IFSC and ABA routing numbers", () => {
    expect(parseBankDetails("Routing Number: 026009593\nAccount Number: 7712004431")).toMatchObject({
      accountNumber: "7712004431",
      routingNumber: "026009593",
    });
    expect(parseBankDetails("A/C No: 50200012345678\nIFSC: HDFC0001234")).toMatchObject({ accountNumber: "50200012345678", ifsc: "HDFC0001234" });
    expect(parseBankDetails("IBAN: DE89 3704 0044 0532 0130 00")?.iban).toBe("DE89370400440532013000");
    expect(parseBankDetails("IBAN: DE89 3704 0044 0532 0130 01")).toBeNull(); // bad checksum is ignored, not trusted
    expect(isValidIban("GB82WEST12345698765432")).toBe(true);
    expect(isValidIfsc("HDFC0001234")).toBe(true);
    expect(isValidIfsc("HDFC1001234")).toBe(false);
    expect(isValidRouting("021000021")).toBe(true);
    expect(isValidRouting("123456789")).toBe(false);
    expect(maskAccount("50200012345678")).toBe("…5678");
  });

  it("the real extractor reads the bank block off the generated demo PDF text", () => {
    const x = parseInvoiceText("INVOICE\nMeridian Facilities\nRemit to\nRouting Number: 026009593\nAccount Number: 7712004431");
    expect(x.bankDetails).toMatchObject({ accountNumber: "7712004431", routingNumber: "026009593" });
  });
});

describe("3-way match (goods receipt)", () => {
  it("holds an invoice for goods not yet received", () => {
    const x = structuredClone(FIXTURES["no-receipt"]);
    const t = runPipeline(
      x,
      ctx({
        vendor: { ...meridian, id: "v-north", name: "Northwind Logistics", bankAccount: null, bankCode: null },
        pos: [po({ id: "po-6120", number: "PO-6120", vendorId: "v-north", vendorName: "Northwind Logistics", amount: 7800, goodsReceived: false })],
      }),
    );
    expect(ids(t)).toContain("receipt.missing:fail");
    expect(t.decision.recommendation).toBe("escalate");
    expect(t.decision.checklist.join(" ")).toMatch(/goods receipt/);
  });

  it("releases the same invoice once the goods are received", () => {
    const t = runPipeline(
      structuredClone(FIXTURES["no-receipt"]),
      ctx({
        vendor: null,
        pos: [po({ id: "po-6120", number: "PO-6120", vendorId: "v-north", vendorName: "Northwind Logistics", amount: 7800, goodsReceived: true })],
      }),
    );
    expect(ids(t)).not.toContain("receipt.missing:fail");
  });
});

describe("GSTIN checks", () => {
  it("validates real GSTINs and catches a one-character typo", () => {
    expect(validateGstin("05AADCD4946L1ZG")).toMatchObject({ valid: true, state: "Uttarakhand", pan: "AADCD4946L" });
    expect(validateGstin("05AADCD4946L1ZH")).toMatchObject({ valid: false });
    expect(validateGstin("ABC")).toMatchObject({ valid: false });
    expect(placeOfSupplyCode("Uttarakhand(5)")).toBe("05");
    expect(placeOfSupplyCode("Karnataka")).toBe("29");
  });

  const gstBill = (gstin: string, heads: string): Extraction => ({
    ...structuredClone(FIXTURES["partial"]),
    poNumbers: [],
    documentKind: "supplier_invoice",
    extras: [
      { key: "seller_gstin", label: "Seller GSTIN", value: gstin, kind: "tax" },
      { key: "place_of_supply", label: "Place of supply", value: "Uttarakhand (05)", kind: "text" },
    ],
    rawText: `Tax Invoice\nGSTIN: ${gstin}\n${heads}`,
  });

  it("fails an invoice whose GSTIN has a bad checksum", () => {
    const t = runPipeline(gstBill("05AADCD4946L1ZH", "CGST 9% SGST 9%"), ctx({ vendor: null, pos: [] }));
    expect(ids(t)).toContain("tax.gstin_invalid:fail");
    expect(t.decision.needsHuman).toBe(true);
  });

  it("flags a GSTIN that differs from the vendor master", () => {
    const t = runPipeline(
      { ...gstBill("05AADCD4946L1ZG", "CGST 9% SGST 9%"), vendorName: "Meridian Facilities" },
      ctx({ vendor: { ...meridian, taxId: "27AAPFU0939F1ZV" }, pos: [] }),
    );
    expect(ids(t)).toContain("tax.id_mismatch:fail");
  });

  it("warns when an intra-state supply charges IGST", () => {
    const t = runPipeline(gstBill("05AADCD4946L1ZG", "IGST 18%"), ctx({ vendor: null, pos: [] }));
    expect(ids(t)).toContain("tax.gst_type:warn");
    const ok = runPipeline(gstBill("05AADCD4946L1ZG", "CGST 9% SGST 9%"), ctx({ vendor: null, pos: [] }));
    expect(ids(ok)).toContain("tax.gstin:pass");
    expect(ids(ok)).not.toContain("tax.gst_type:warn");
  });
});

describe("invoice date sanity", () => {
  it("fails a future-dated invoice", () => {
    const x = { ...structuredClone(FIXTURES["bank-change"]), bankDetails: null, invoiceDate: "2027-01-15" };
    const t = runPipeline(x, ctx());
    expect(ids(t)).toContain("date.future:fail");
  });
  it("warns on an invoice older than the policy limit", () => {
    const x = { ...structuredClone(FIXTURES["bank-change"]), bankDetails: null, invoiceDate: "2026-01-02" };
    const t = runPipeline(x, ctx());
    expect(ids(t)).toContain("date.stale:warn");
  });
});

describe("payment terms and due dates", () => {
  it("computes due dates and early-payment discounts", () => {
    expect(dueFromTerms("2026-10-28", "Net 30")).toMatchObject({ dueDate: "2026-11-27", discount: null, assumed: false });
    expect(dueFromTerms("2026-10-28", "2/10 Net 30")).toMatchObject({ dueDate: "2026-11-27", discount: { pct: 0.02, byDate: "2026-11-07" } });
    expect(dueFromTerms("2026-10-28", "Due on receipt")?.dueDate).toBe("2026-10-28");
    expect(dueFromTerms("2026-10-15", "Net 30 EOM")?.dueDate).toBe("2026-11-30");
    expect(dueFromTerms("2026-10-28", "whatever")).toMatchObject({ dueDate: "2026-11-27", assumed: true });
    expect(dueFromTerms(null, "Net 30")).toBeNull();
  });

  it("puts the due date, discount and masked pay-to account on the decision trace", () => {
    const x = structuredClone(FIXTURES["bank-change"]);
    x.bankDetails = { accountNumber: "4839201928", routingNumber: "021000021" };
    const t = runPipeline(x, ctx());
    expect(t.payment).toEqual({
      dueDate: "2026-12-05",
      terms: "2/10 Net 30",
      termsAssumed: false,
      discount: { pct: 0.02, byDate: "2026-11-15" },
      payTo: "…1928",
    });
  });
});
