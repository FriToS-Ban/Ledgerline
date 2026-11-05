export type PageClass = { page: number; kind: "digital" | "scanned"; chars: number };

export type ClassifyResult = {
  digitalPages: number;
  scannedPages: number;
  mixed: boolean;
  pages: PageClass[];
  text: string;
};

export function classifyFromText(pages: string[]): ClassifyResult {
  const classified: PageClass[] = pages.map((text, i) => {
    const chars = text.replace(/\s+/g, "").length;
    return { page: i + 1, kind: chars < 40 ? "scanned" : "digital", chars };
  });
  const digitalPages = classified.filter((p) => p.kind === "digital").length;
  const scannedPages = classified.filter((p) => p.kind === "scanned").length;
  return {
    digitalPages,
    scannedPages,
    mixed: digitalPages > 0 && scannedPages > 0,
    pages: classified,
    text: pages.join("\n\n"),
  };
}
