import fs from "node:fs";
import { extractInvoice } from "../src/lib/pdf/extract";

async function main() {
  const file = process.argv[2];
  const bytes = new Uint8Array(fs.readFileSync(file));
  const x = await extractInvoice({ pdfBytes: bytes, filename: file });
  console.log(
    JSON.stringify(
      {
        vendorName: x.vendorName,
        invoiceNumber: x.invoiceNumber,
        invoiceDate: x.invoiceDate,
        currency: x.currency,
        total: x.total,
        poNumbers: x.poNumbers,
        tax: x.tax,
        shipping: x.shipping,
        subtotal: x.subtotal,
        source: x.source,
        lines: x.lineItems,
        preview: (x.rawText || "").slice(0, 2500),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
