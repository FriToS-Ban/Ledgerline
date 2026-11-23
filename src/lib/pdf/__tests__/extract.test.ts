import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extractInvoice } from "../extract";
import { loadPdfjs } from "../pdfjs";

const demo = (file: string) => new Uint8Array(fs.readFileSync(path.join(process.cwd(), "public", "demos", file)));

describe("PDF text extraction (real pdf.js, no fixtures)", () => {
  it("registers the pdf.js worker in-process, so builds never need to find pdf.worker.mjs on disk", async () => {
    await loadPdfjs();
    const worker = (globalThis as { pdfjsWorker?: { WorkerMessageHandler?: unknown } }).pdfjsWorker;
    expect(worker?.WorkerMessageHandler).toBeTruthy();
  });

  it("reads a digital invoice PDF", async () => {
    const x = await extractInvoice({ pdfBytes: demo("multi-po.pdf"), filename: "multi-po.pdf" });
    expect(x.source).toBe("digital");
    expect(x.vendorName).toBe("Meridian Facilities");
    expect(x.invoiceNumber).toBe("MF-3301");
    expect(x.total).toBe(4950);
    expect([...x.poNumbers].sort()).toEqual(["PO-7701", "PO-7702"]);
  });

  it("does not hand back the caller's buffer detached or emptied", async () => {
    const bytes = demo("partial.pdf");
    const before = bytes.length;
    await extractInvoice({ pdfBytes: bytes, filename: "partial.pdf" });
    expect(bytes.length).toBe(before);
  });

  it("treats a PDF it cannot open as unreadable instead of parsing raw bytes", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const bytes = new Uint8Array(Buffer.from("%PDF-1.4\nInvoice Number: FAKE-1\nTotal: 999.00\n%%EOF"));
    const x = await extractInvoice({ pdfBytes: bytes, filename: "broken.pdf" });
    quiet.mockRestore();
    expect(x.annotations).toContain("pdf-unreadable");
    expect(x.totalConfidence).toBeLessThan(0.7);
  });
});
