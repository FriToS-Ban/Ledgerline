import fs from "node:fs";
import path from "node:path";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
export type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;

const g = globalThis as unknown as { pdfjsWorker?: unknown; __pdfjs?: Promise<PdfJs> };

/**
 * Loads pdf.js for server-side use.
 *
 * pdf.js parses on a "fake worker" in Node, and finds it with `import("./pdf.worker.mjs")` on a
 * computed path. Neither bundlers nor Next's output file tracer can see that import, so standalone
 * builds (Docker, `node .next/standalone/server.js`, Vercel) shipped pdf.mjs WITHOUT the worker and
 * every PDF failed to open. Importing the worker here by a literal specifier gets it traced into the
 * build, and registering it on `globalThis.pdfjsWorker` makes pdf.js use it directly instead of
 * looking for the file.
 */
export function loadPdfjs(): Promise<PdfJs> {
  g.__pdfjs ??= (async () => {
    if (!g.pdfjsWorker) {
      g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    }
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })().catch((err) => {
    g.__pdfjs = undefined; // let the next call retry instead of caching the failure forever
    throw err;
  });
  return g.__pdfjs;
}

let assetDirs: Record<string, string> | null = null;

/**
 * pdf.js resource folders (CMaps for CID fonts, standard font data, JBIG2/JPEG2000 decoders that
 * scanned PDFs often use). In Node they are read from disk, and pdf.js requires a trailing "/".
 * Missing folders are simply left out: text extraction still works, only some glyphs degrade.
 */
function resourceUrls(): Record<string, string> {
  if (assetDirs) return assetDirs;
  const root = path.join(process.cwd(), "node_modules", "pdfjs-dist");
  const dirs: Record<string, string> = {};
  const add = (key: string, sub: string) => {
    const dir = path.join(root, sub);
    if (fs.existsSync(dir)) dirs[key] = dir.replace(/\\/g, "/") + "/";
  };
  add("cMapUrl", "cmaps");
  add("standardFontDataUrl", "standard_fonts");
  add("wasmUrl", "wasm");
  add("iccUrl", "iccs");
  assetDirs = dirs;
  return dirs;
}

export async function openPdf(bytes: Uint8Array): Promise<PdfDocument> {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({
    // A copy: pdf.js may take ownership of the buffer, and callers still need the original bytes.
    data: bytes.slice(),
    verbosity: 0,
    cMapPacked: true,
    ...resourceUrls(),
  }).promise;
}

/** Renders one page to a PNG (for OCR). Needs the optional @napi-rs/canvas package. */
export async function renderPageToPng(doc: PdfDocument, pageNumber: number, scale = 2.5): Promise<Buffer> {
  const page = await doc.getPage(pageNumber);
  try {
    // Keep huge pages (posters, A0 scans) to a sane pixel budget for OCR.
    const base = page.getViewport({ scale: 1 });
    const maxSide = 4000;
    const s = Math.min(scale, maxSide / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale: s });
    const factory = doc.canvasFactory as {
      create(w: number, h: number): { canvas: { toBuffer(type: string): Buffer }; context: unknown };
      destroy(c: unknown): void;
    };
    const target = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    try {
      await page.render({
        canvasContext: target.context as CanvasRenderingContext2D,
        viewport,
        background: "#ffffff",
      } as Parameters<typeof page.render>[0]).promise;
      return target.canvas.toBuffer("image/png");
    } finally {
      factory.destroy(target);
    }
  } finally {
    page.cleanup();
  }
}
