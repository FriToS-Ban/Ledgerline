import fs from "node:fs";
import path from "node:path";
import { sniffKind } from "./parse-text";

/** Only inert document/image types are ever written to public/uploads (never .html, .svg, .js ...). */
export const UPLOAD_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"];

export function saveUpload(opts: {
  invoiceId: string;
  filename?: string;
  bytes: Uint8Array;
}): string {
  const dir = path.join(process.cwd(), "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const kind = sniffKind(opts.filename, opts.bytes);
  const named = opts.filename?.match(/(\.[a-z0-9]+)$/i)?.[1]?.toLowerCase();
  // Allow-list: a .html/.svg/.js name is never kept; the file is stored as .pdf/.jpg by content.
  const extFromName = named && UPLOAD_EXTENSIONS.includes(named) ? named : undefined;
  const ext =
    extFromName ??
    (kind === "image" ? ".jpg" : ".pdf");
  const dest = path.join(dir, `${opts.invoiceId}${ext.toLowerCase()}`);
  fs.writeFileSync(dest, opts.bytes);
  return `/api/files/${opts.invoiceId}${ext.toLowerCase()}`;
}
