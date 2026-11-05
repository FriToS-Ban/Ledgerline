import { parseInvoiceText } from "./parse-text";
import type { Extraction } from "@/lib/invoice/schema";

export async function extractFromImage(bytes: Uint8Array): Promise<Extraction> {
  const Tesseract = await import("tesseract.js");
  const result = await Tesseract.recognize(Buffer.from(bytes), "eng");
  const parsed = parseInvoiceText(result.data.text ?? "");
  const conf = Math.min(0.85, Math.max(0.25, (result.data.confidence ?? 50) / 100));
  return {
    ...parsed,
    source: "tesseract",
    vendorConfidence: parsed.vendorName === "Unknown vendor" ? Math.min(conf, 0.45) : conf,
    invoiceNumberConfidence: parsed.invoiceNumber ? conf : 0.25,
    invoiceDateConfidence: parsed.invoiceDate ? conf : 0.25,
    totalConfidence: parsed.total != null ? conf : 0.25,
    classification: { digitalPages: 0, scannedPages: 1, mixed: false },
    rawText: result.data.text,
  };
}
