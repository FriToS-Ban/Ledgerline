import fs from "node:fs";
import path from "node:path";
import { extractInvoice } from "../src/lib/pdf/extract";
import { DEMO_CASES, FIXTURES } from "../src/lib/fixtures/cases";

/** Runs the REAL extractor over each demo PDF and diffs it against the fixture ground truth. */
async function main() {
  let ok = 0;
  let total = 0;
  const seen = new Set<string>();
  for (const c of DEMO_CASES) {
    if (seen.has(c.file)) continue;
    seen.add(c.file);
    const truth = FIXTURES[c.id];
    const bytes = new Uint8Array(fs.readFileSync(path.join("public", "demos", c.file)));
    const got = await extractInvoice({ pdfBytes: bytes, filename: c.file });
    // The smudged scan must NOT be guessed: unreadable critical fields stay null (low confidence -> human review).
    const refuse = c.id === "low-confidence";
    const checks: [string, unknown, unknown][] = refuse
      ? [
          ["vendor", truth.vendorName, got.vendorName],
          ["invoiceNumber (must stay null)", null, got.invoiceNumber],
          ["invoiceDate (must stay null)", null, got.invoiceDate],
          ["total (must stay null)", null, got.total],
          ["invoiceNumberConfidence<0.7", true, got.invoiceNumberConfidence < 0.7],
        ]
      : [
      ["vendor", truth.vendorName, got.vendorName],
      ["invoiceNumber", truth.invoiceNumber, got.invoiceNumber],
      ["invoiceDate", truth.invoiceDate, got.invoiceDate],
      ["currency", truth.currency, got.currency],
      ["total", truth.total, got.total],
      ["poNumbers", [...(truth.poNumbers ?? [])].sort().join(","), [...(got.poNumbers ?? [])].sort().join(",")],
      ["lineCount", truth.lineItems.length, got.lineItems.length],
    ];
    console.log(`\n== ${c.file} (${got.source}, ${got.classification?.scannedPages ? "scanned" : "digital"})`);
    for (const [name, want, have] of checks) {
      total++;
      const pass = want === have || (want == null && have == null);
      if (pass) ok++;
      console.log(`${pass ? "  ok  " : " FAIL "} ${name}: want=${JSON.stringify(want)} got=${JSON.stringify(have)}`);
    }
  }
  console.log(`\n${ok}/${total} field checks passed`);
  process.exit(ok === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
