import fs from "node:fs";
import { extractInvoice } from "../src/lib/pdf/extract";
// Truth read by eye from the PDF text (Zomato-issued restaurant invoices, INR).
const truth: Record<string, Record<string, unknown>> = {
  "7645955087": { vendorName: "Barbeque Nation Hospitality Ltd.", invoiceNumber: "25HIGUZC00004327", invoiceDate: "2026-01-02", currency: "INR", total: 784.88, subtotal: 759.68, shipping: 24, tax: 37.38, lines: [424.73, 334.95] },
  "8713777656": { vendorName: "TACO BELL RESTRO", invoiceNumber: "26DM1P3I00016606", invoiceDate: "2026-10-12", currency: "INR", total: 330.33, subtotal: 300.3, shipping: 28.6, tax: 15.74, lines: [175.55, 124.75] },
};
(async () => {
  let ok = 0, n = 0;
  for (const [id, want] of Object.entries(truth)) {
    const x = await extractInvoice({ pdfBytes: new Uint8Array(fs.readFileSync(`C:/Users/SHRAMAN/Downloads/Invoice_${id}.pdf`)), filename: id + ".pdf" });
    const got: Record<string, unknown> = { ...x, lines: x.lineItems.map((l) => l.amount) };
    console.log("\nInvoice", id);
    for (const [k, v] of Object.entries(want)) {
      const pass = JSON.stringify(got[k]) === JSON.stringify(v);
      n++; if (pass) ok++;
      console.log(pass ? "  ok  " : "  MISS", k.padEnd(14), "want", JSON.stringify(v), "got", JSON.stringify(got[k]));
    }
  }
  console.log(`\n${ok}/${n} fields match`);
})();
