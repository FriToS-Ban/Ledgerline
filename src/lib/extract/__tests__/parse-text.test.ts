import { describe, expect, it } from "vitest";
import { cleanPersonName, parseInvoiceText, sniffKind } from "../parse-text";

const SAMPLE = `Tax Invoice
Legal Entity Name : Barbeque Nation Hospitality Ltd.
Restaurant Name : Barbeque Nation
Invoice No. : 25HIGUZC00004327
Invoice Date : 02/01/2026
Customer Name :   Shibasish Banerjee  Delivery Address :   3 KP Roy Lane
1 x Chicken Kebabs Platter 424.726
1 x Butter Chicken 334.95
Total Value 747.5 18.688 18.688 784.876
Amount of INR 784.876 settled through digital mode/payment received against Order ID: 7645955087 dated
2026-01-02.
Platform fee 12.49 1.13 1.13 14.75
Amount of ₹14.75 settled through digital mode`;

describe("parseInvoiceText", () => {
  it("extracts a Zomato / Barbeque Nation tax invoice", () => {
    const x = parseInvoiceText(SAMPLE);
    expect(x.vendorName).toMatch(/Barbeque Nation/);
    expect(x.invoiceNumber).toBe("25HIGUZC00004327");
    expect(x.invoiceDate).toBe("2026-01-02");
    expect(x.currency).toBe("INR");
    expect(x.total).toBe(784.88);
    expect(x.poNumbers).toContain("7645955087");
    expect(x.lineItems.map((l) => l.description)).toEqual(
      expect.arrayContaining(["Chicken Kebabs Platter", "Butter Chicken"]),
    );
    expect(x.lineItems.some((l) => /platform fee/i.test(l.description))).toBe(false);
    expect(x.extras!.some((e) => e.key === "order_id" && e.value === "7645955087")).toBe(true);
    expect(x.parties!.some((p) => p.role === "seller")).toBe(true);
    expect(x.slices!.length).toBeGreaterThanOrEqual(1);
    expect(x.extras!.find((e) => e.key === "customer")?.value).toBe("Shibasish Banerjee");
    expect(x.parties!.find((p) => p.role === "buyer")?.name).toBe("Shibasish Banerjee");
  });
});

describe("Zomato item rows", () => {
  it("takes the row total even when it has one decimal place", () => {
    const x = parseInvoiceText(`Tax Invoice
Legal Entity Name : THAKUR MAHENDRA ASHOK
Invoice No. : 25AAIEFP00016116
1 x Tandoori Chicken\t169\t0\t169\t2.5%\t4.225\t2.5%\t4.225 177.45
1 x Chicken Biryani\t214\t0\t214\t2.5%\t5.35\t2.5%\t5.35\t224.7
Item(s) Total\t383\t0\t383\t9.575\t9.575 402.15`);
    expect(x.lineItems.map((l) => [l.description, l.amount])).toEqual([
      ["Tandoori Chicken", 177.45],
      ["Chicken Biryani", 224.7],
    ]);
  });
});

describe("cleanPersonName", () => {
  it("strips Delivery Address glued onto the name", () => {
    expect(cleanPersonName("Shibasish Banerjee Delivery Address")).toBe("Shibasish Banerjee");
    expect(cleanPersonName("Shibasish Banerjee  Delivery Address: Ravindra Bhawan")).toBe(
      "Shibasish Banerjee",
    );
  });
});

describe("sniffKind", () => {
  it("detects images and pdfs from filename", () => {
    expect(sniffKind("order.jpeg")).toBe("image");
    expect(sniffKind("Invoice_7645955087.pdf")).toBe("pdf");
  });
  it("detects pdf magic bytes", () => {
    const bytes = new Uint8Array(Buffer.from("%PDF-1.4"));
    expect(sniffKind(undefined, bytes)).toBe("pdf");
  });
});

