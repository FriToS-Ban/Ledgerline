import { describe, expect, it } from "vitest";
import { parseInvoiceText } from "../parse-text";
import { itemsToLines } from "@/lib/pdf/extract";

const MULTI_PO = `INVOICE
Meridian Facilities
Invoice Number: MF-3301
Date: 2026-10-27
Currency: USD
PO: PO-7701, PO-7702
Description\tAmount
Q4 HVAC filter replacement\t3000.00
PO PO-7701
Emergency rooftop unit service call\t1950.00
PO PO-7702
Subtotal: 4950.00
Tax: 0.00
Shipping: 0.00
Total: 4950.00 USD`;

describe("B2B supplier invoice parsing (regressions found by the extractor audit)", () => {
  const x = parseInvoiceText(MULTI_PO);
  it("takes the vendor from its own line, not the next label", () => {
    expect(x.vendorName).toBe("Meridian Facilities");
  });
  it("reads full PO tokens with no stray fragments", () => {
    expect([...x.poNumbers].sort()).toEqual(["PO-7701", "PO-7702"]);
  });
  it("extracts table lines and attaches their PO", () => {
    expect(x.lineItems.map((l) => [l.description, l.amount, l.poNumber])).toEqual([
      ["Q4 HVAC filter replacement", 3000, "PO-7701"],
      ["Emergency rooftop unit service call", 1950, "PO-7702"],
    ]);
  });
  it("uses Total, not Subtotal", () => {
    expect(x.total).toBe(4950);
    expect(x.subtotal).toBe(4950);
  });
  it("'Invoice' then a company name is not an invoice number", () => {
    const t = parseInvoiceText("INVOICE\nNorthwind Logistics\nInvoice Number: NW-5521\nDate: 2026-10-22\nTotal: 5395.00 USD");
    expect(t.invoiceNumber).toBe("NW-5521");
  });
  it("refuses an unsure scanned date and missing total", () => {
    const t = parseInvoiceText("SCANNED COPY — quality degraded\nApex Industrial Supply\nInvoice No. (smudged)\nDate: 21 Oct 2026?\nTotal ~ 4100 ??");
    expect(t.vendorName).toBe("Apex Industrial Supply");
    expect(t.invoiceNumber).toBeNull();
    expect(t.invoiceDate).toBeNull();
    expect(t.total).toBeNull();
  });
  it("parses month-name dates when the scan is sure", () => {
    expect(parseInvoiceText("Acme Co\nInvoice No: A-1001\nDate: 21 Oct 2026\nTotal: 10.00").invoiceDate).toBe("2026-10-21");
  });
});

describe("itemsToLines", () => {
  it("groups by baseline and tabs wide gaps", () => {
    const text = itemsToLines([
      { str: "Widget", transform: [1, 0, 0, 1, 10, 100], width: 30 },
      { str: "5.00", transform: [1, 0, 0, 1, 200, 100], width: 20 },
      { str: "Header", transform: [1, 0, 0, 1, 10, 120], width: 30 },
    ]);
    expect(text).toBe("Header\nWidget\t5.00");
  });
});
