import { classifyFromText } from "./classify";
import { FIXTURES, type DemoId } from "@/lib/fixtures/cases";
import type { Extraction } from "@/lib/invoice/schema";
import { extractFromImage } from "@/lib/extract/ocr-image";
import { parseInvoiceText, sniffKind } from "@/lib/extract/parse-text";

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
    return extractFromImage(opts.pdfBytes);
  }

  const pages = await readPdfPages(opts.pdfBytes);
  const classified = classifyFromText(pages);
  const digital = parseInvoiceText(classified.text);
  digital.classification = {
    digitalPages: classified.digitalPages,
    scannedPages: classified.scannedPages,
    mixed: classified.mixed,
  };
  digital.pageCount = pages.length || 1;
  digital.rawText = classified.text;
  digital.source = "digital";

  const hasKey = !!(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY
  );
  const needsVision = classified.scannedPages > 0 || !digital.total || !digital.invoiceNumber;

  if (needsVision && hasKey && opts.pdfBytes) {
    try {
      const vision = await visionExtract(opts.pdfBytes, classified.text);
      vision.classification = digital.classification;
      vision.source = "vision";
      return vision;
    } catch {
      /* fall through */
    }
  }

  if (classified.scannedPages > 0) {
    const ocr = await tesseractFallback(opts.pdfBytes, classified.text);
    return { ...digital, ...ocr, source: "tesseract", classification: digital.classification };
  }

  return digital;
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

async function readPdfPages(bytes?: Uint8Array): Promise<string[]> {
  if (!bytes) return [""];
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(itemsToLines(content.items as TextItem[]));
    }
    return pages;
  } catch {
    return [new TextDecoder().decode(bytes).replace(/[^\x20-\x7E\n]/g, " ")];
  }
}

async function visionExtract(pdfBytes: Uint8Array, hint: string): Promise<Extraction> {
  const { Agent } = await import("@mastra/core/agent");
  const { resolveMastraModel } = await import("@/mastra/model");
  const model = resolveMastraModel();
  if (!model) throw new Error("no vision model");
  const agent = new Agent({
    id: "extract-invoice",
    name: "Invoice extractor",
    instructions:
      "Extract invoice fields. Never invent invoice number, date, or total. If unreadable, null with low confidence.",
    model,
  });
  const b64 = Buffer.from(pdfBytes).toString("base64");
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
      structuredOutput: {
        schema: (await import("@/lib/invoice/schema")).extractionSchema,
      },
    } as never,
  );
  const object = (result as { object?: Extraction }).object;
  if (!object) throw new Error("no structured extraction");
  return object;
}

async function tesseractFallback(
  pdfBytes: Uint8Array | undefined,
  existingText: string,
): Promise<Partial<Extraction>> {
  if (!pdfBytes) {
    return {
      invoiceNumberConfidence: 0.3,
      totalConfidence: 0.3,
      invoiceDateConfidence: 0.3,
    };
  }
  const parsed = parseInvoiceText(existingText);
  return {
    ...parsed,
    source: "tesseract",
    invoiceNumberConfidence: parsed.invoiceNumber ? 0.55 : 0.25,
    invoiceDateConfidence: parsed.invoiceDate ? 0.55 : 0.25,
    totalConfidence: parsed.total != null ? 0.55 : 0.25,
    rawText: existingText,
  };
}
