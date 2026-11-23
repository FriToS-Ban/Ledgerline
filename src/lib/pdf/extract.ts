import { classifyFromText, type PageClass } from "./classify";
import { openPdf, renderPageToPng, type PdfDocument } from "./pdfjs";
import { FIXTURES, type DemoId } from "@/lib/fixtures/cases";
import type { Extraction } from "@/lib/invoice/schema";
import { extractFromImage, extractionFromOcr, ocrImages } from "@/lib/extract/ocr-image";
import { parseInvoiceText, sniffKind } from "@/lib/extract/parse-text";

/** Scanned pages beyond this are not OCR'd (invoices are short; this bounds the time per file). */
const MAX_OCR_PAGES = Number(process.env.MAX_OCR_PAGES ?? 6);

/** An extraction that says "nothing could be read": every critical field empty, low confidence. */
function unreadable(note: string): Extraction {
  return {
    ...parseInvoiceText(""),
    vendorConfidence: 0.2,
    invoiceNumberConfidence: 0.2,
    invoiceDateConfidence: 0.2,
    totalConfidence: 0.2,
    classification: { digitalPages: 0, scannedPages: 1, mixed: false },
    annotations: [note],
    rawText: "",
  };
}

export async function extractInvoice(opts: {
  demoId?: DemoId;
  pdfBytes?: Uint8Array;
  filename?: string;
}): Promise<Extraction> {
  if (opts.demoId && FIXTURES[opts.demoId]) {
    return structuredClone(FIXTURES[opts.demoId]);
  }

  const kind = sniffKind(opts.filename, opts.pdfBytes);
  if (kind === "image" && opts.pdfBytes) {
    try {
      return await extractFromImage(opts.pdfBytes);
    } catch (err) {
      console.error("[extract] image OCR failed", err);
      return unreadable("ocr-failed");
    }
  }

  const pdf = await readPdf(opts.pdfBytes);
  try {
    return await extractPdf(pdf, opts.pdfBytes);
  } finally {
    await pdf.doc?.loadingTask.destroy().catch(() => {});
  }
}

async function extractPdf(
  pdf: { doc: PdfDocument | null; pages: string[] },
  pdfBytes: Uint8Array | undefined,
): Promise<Extraction> {
  const classified = classifyFromText(pdf.pages);
  const digital = parseInvoiceText(classified.text);
  digital.classification = {
    digitalPages: classified.digitalPages,
    scannedPages: classified.scannedPages,
    mixed: classified.mixed,
  };
  digital.pageCount = pdf.pages.length || 1;
  digital.rawText = classified.text;
  digital.source = "digital";

  const needsVision = classified.scannedPages > 0 || !digital.total || !digital.invoiceNumber;
  if (needsVision && pdfBytes) {
    const vision = await visionExtract(pdfBytes, classified.text).catch((err) => {
      console.warn("[extract] vision extraction failed; using local parse/OCR:", err instanceof Error ? err.message : err);
      return null;
    });
    if (vision) {
      vision.classification = digital.classification;
      vision.pageCount = digital.pageCount;
      vision.rawText ??= classified.text;
      vision.source = "vision";
      return vision;
    }
  }

  if (classified.scannedPages === 0) return digital;

  const ocr = pdf.doc ? await ocrScannedPages(pdf.doc, classified.pages, pdf.pages) : null;
  if (ocr) return { ...ocr, pageCount: digital.pageCount, classification: digital.classification };

  // No OCR possible: keep what the text layer gave, but never with confidence that skips review.
  return {
    ...digital,
    source: "tesseract",
    invoiceNumberConfidence: digital.invoiceNumber ? 0.55 : 0.25,
    invoiceDateConfidence: digital.invoiceDate ? 0.55 : 0.25,
    totalConfidence: digital.total != null ? 0.55 : 0.25,
    annotations: [...(digital.annotations ?? []), pdf.doc ? "ocr-unavailable" : "pdf-unreadable"],
  };
}

type TextItem = { str?: string; transform: number[]; width?: number };

/** Group text runs by baseline (y) into lines; wide x gaps become tabs so table columns stay separable. */
export function itemsToLines(items: TextItem[]): string {
  const rows: { y: number; parts: { x: number; w: number; s: string }[] }[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5];
    const row = rows.find((r) => Math.abs(r.y - y) < 2.5);
    const part = { x: it.transform[4], w: it.width ?? 0, s: it.str };
    if (row) row.parts.push(part);
    else rows.push({ y, parts: [part] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      const parts = r.parts.sort((a, b) => a.x - b.x);
      let out = "";
      let prevEnd = 0;
      for (const [i, p] of parts.entries()) {
        const gap = p.x - prevEnd;
        out += i === 0 ? "" : gap > 18 ? "\t" : gap > 1 ? " " : "";
        out += p.s;
        prevEnd = p.x + p.w;
      }
      return out.trim();
    })
    .join("\n");
}

/**
 * Text of every page. If pdf.js cannot open the file (corrupt, encrypted, or pdf.js itself failed
 * to load) the error is logged and the file is treated as unreadable. This used to fall back to
 * decoding the raw bytes, which silently turned every failure into binary noise that parsed as
 * "nothing found".
 */
async function readPdf(bytes?: Uint8Array): Promise<{ doc: PdfDocument | null; pages: string[] }> {
  if (!bytes) return { doc: null, pages: [""] };
  let doc: PdfDocument | null = null;
  try {
    doc = await openPdf(bytes);
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(itemsToLines(content.items as TextItem[]));
      page.cleanup();
    }
    return { doc, pages };
  } catch (err) {
    console.error("[extract] could not read PDF text", err);
    await doc?.loadingTask.destroy().catch(() => {});
    return { doc: null, pages: [""] };
  }
}

/** Render the scanned pages, OCR them, and parse them together with the digital pages, in page order. */
async function ocrScannedPages(doc: PdfDocument, classes: PageClass[], pageTexts: string[]): Promise<Extraction | null> {
  try {
    const scanned = classes.filter((p) => p.kind === "scanned").slice(0, MAX_OCR_PAGES);
    const images: Uint8Array[] = [];
    for (const p of scanned) images.push(await renderPageToPng(doc, p.page));
    const { pages, confidence } = await ocrImages(images);
    const ocrByPage = new Map(scanned.map((p, i) => [p.page, pages[i] ?? ""]));
    const text = classes
      .map((p, i) => (p.kind === "digital" ? pageTexts[i] : (ocrByPage.get(p.page) ?? "")))
      .join("\n\n");
    return extractionFromOcr(text, confidence);
  } catch (err) {
    console.error("[extract] OCR of scanned PDF pages failed", err);
    return null;
  }
}

/** Reads the PDF with a vision-capable LLM. Returns null when no such model is configured. */
async function visionExtract(pdfBytes: Uint8Array, hint: string): Promise<Extraction | null> {
  const { resolveVisionModel } = await import("@/mastra/model");
  const model = resolveVisionModel();
  if (!model) return null;
  const { Agent } = await import("@mastra/core/agent");
  const agent = new Agent({
    id: "extract-invoice",
    name: "Invoice extractor",
    instructions:
      "Extract invoice fields. Never invent invoice number, date, or total. If unreadable, null with low confidence.",
    model,
  });
  const b64 = Buffer.from(pdfBytes).toString("base64");
  // Bounded like every other model call, so one slow provider cannot stall the queue.
  const ms = Number(process.env.VISION_TIMEOUT_MS ?? 30_000);
  const abort = AbortSignal.timeout(ms);
  const result = await agent.generate(
    [
      {
        role: "user",
        content: [
          { type: "text", text: `Extract the invoice. Hint text:\n${hint.slice(0, 4000)}` },
          { type: "file", data: b64, mimeType: "application/pdf" },
        ],
      },
    ],
    {
      abortSignal: abort,
      structuredOutput: {
        schema: (await import("@/lib/invoice/schema")).extractionSchema,
      },
    } as never,
  );
  const object = (result as { object?: Extraction }).object;
  if (!object) throw new Error("no structured extraction");
  return object;
}
