import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseInvoiceText } from "./parse-text";
import type { Extraction } from "@/lib/invoice/schema";

/**
 * Tesseract downloads its English model once and caches it. The default cache is the current
 * directory, which is not writable for the Docker image's non-root user, so every OCR call would
 * re-download it; the OS temp dir always is.
 */
function cachePath(): string {
  const dir = process.env.TESSERACT_CACHE_DIR || path.join(os.tmpdir(), "ledgerline-tesseract");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* tesseract falls back to downloading without a cache */
  }
  return dir;
}

/** OCR one or more page images with a single Tesseract worker. Confidence is 0..100 (mean over pages). */
export async function ocrImages(images: Uint8Array[]): Promise<{ pages: string[]; confidence: number }> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, { cachePath: cachePath() });
  try {
    const pages: string[] = [];
    const confidences: number[] = [];
    for (const image of images) {
      const { data } = await worker.recognize(Buffer.from(image));
      pages.push(data.text ?? "");
      confidences.push(data.confidence ?? 0);
    }
    const confidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
    return { pages, confidence };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

/** Builds an extraction from OCR text, with confidences capped by how sure Tesseract was. */
export function extractionFromOcr(text: string, confidence: number): Extraction {
  const parsed = parseInvoiceText(text);
  const conf = Math.min(0.85, Math.max(0.25, confidence / 100));
  return {
    ...parsed,
    source: "tesseract",
    vendorConfidence: parsed.vendorName === "Unknown vendor" ? Math.min(conf, 0.45) : conf,
    invoiceNumberConfidence: parsed.invoiceNumber ? conf : 0.25,
    invoiceDateConfidence: parsed.invoiceDate ? conf : 0.25,
    totalConfidence: parsed.total != null ? conf : 0.25,
    rawText: text,
  };
}

export async function extractFromImage(bytes: Uint8Array): Promise<Extraction> {
  const { pages, confidence } = await ocrImages([bytes]);
  return {
    ...extractionFromOcr(pages.join("\n\n"), confidence),
    classification: { digitalPages: 0, scannedPages: 1, mixed: false },
  };
}
