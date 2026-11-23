import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { DEMO_CASES, FIXTURES, type DemoId } from "@/lib/fixtures/cases";

export async function generateDemoPdfs() {
  const dir = path.join(process.cwd(), "public", "demos");
  fs.mkdirSync(dir, { recursive: true });
  for (const demo of DEMO_CASES) {
    const out = path.join(dir, demo.file);
    if (fs.existsSync(out)) continue;
    const bytes = await buildPdf(demo.id);
    fs.writeFileSync(out, bytes);
  }
}

async function buildPdf(id: DemoId): Promise<Uint8Array> {
  const x = FIXTURES[id];
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.09, 0.12);
  const mute = rgb(0.35, 0.38, 0.42);

  const draw = (text: string, y: number, size = 11, b = false) => {
    page.drawText(text, { x: 48, y, size, font: b ? bold : font, color: ink });
  };

  if (id === "low-confidence") {
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.86, 0.86, 0.84) });
    draw("SCANNED COPY — quality degraded", 740, 10);
    draw(x.vendorName, 700, 16, true);
    draw("Invoice No. (smudged)", 660, 12);
    draw("Date: 21 Oct 2026?", 640);
    draw("Total ~ 4100 ??", 500, 14);
    return doc.save();
  }

  draw("INVOICE", 740, 22, true);
  draw(x.vendorName, 712, 14, true);
  draw(`Invoice Number: ${x.invoiceNumber ?? "—"}`, 680);
  draw(`Date: ${x.invoiceDate ?? "—"}`, 662);
  draw(`Currency: ${x.currency}`, 644);
  draw(
    `PO: ${x.poNumbers.length ? x.poNumbers.join(", ") : "(none stated)"}`,
    626,
  );

  let y = 580;
  draw("Description", y, 11, true);
  page.drawText("Amount", { x: 460, y, size: 11, font: bold, color: ink });
  y -= 22;
  for (const line of x.lineItems) {
    draw(line.description.slice(0, 70), y, 10);
    page.drawText(String(line.amount.toFixed(2)), {
      x: 460,
      y,
      size: 10,
      font,
      color: ink,
    });
    if (line.poNumber) {
      y -= 14;
      page.drawText(`  PO ${line.poNumber}`, { x: 48, y, size: 9, font, color: mute });
    }
    y -= 20;
  }

  y -= 12;
  if (x.subtotal != null) draw(`Subtotal: ${x.subtotal.toFixed(2)}`, y);
  y -= 16;
  if (x.tax != null) draw(`Tax: ${x.tax.toFixed(2)}`, y);
  y -= 16;
  if (x.shipping != null) draw(`Shipping: ${x.shipping.toFixed(2)}`, y);
  y -= 20;
  draw(`Total: ${x.total?.toFixed(2) ?? "—"} ${x.currency}`, y, 14, true);

  if (id === "tax-shipping") {
    y -= 36;
    draw("Note: freight and VAT included in line total.", y, 9);
  }
  if (id === "implied") {
    y -= 36;
    draw("Please apply to the open fastener order.", y, 9);
  }
  const bank = x.bankDetails;
  if (bank && (bank.accountNumber || bank.iban)) {
    y -= 40;
    if (id === "bank-change") draw("IMPORTANT: our bank details have changed. Please update your records.", y, 10, true);
    y -= 18;
    draw("Remit to", y, 10, true);
    if (bank.accountName) { y -= 14; draw(`Account Name: ${bank.accountName}`, y, 10); }
    if (bank.routingNumber) { y -= 14; draw(`Routing Number: ${bank.routingNumber}`, y, 10); }
    if (bank.ifsc) { y -= 14; draw(`IFSC: ${bank.ifsc}`, y, 10); }
    if (bank.iban) { y -= 14; draw(`IBAN: ${bank.iban}`, y, 10); }
    if (bank.accountNumber) { y -= 14; draw(`Account Number: ${bank.accountNumber}`, y, 10); }
  }

  return doc.save();
}
