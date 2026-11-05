import fs from "node:fs";
import path from "node:path";
import { sniffKind } from "./parse-text";

export function saveUpload(opts: {
  invoiceId: string;
  filename?: string;
  bytes: Uint8Array;
}): string {
  const dir = path.join(process.cwd(), "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const kind = sniffKind(opts.filename, opts.bytes);
  const extFromName = opts.filename?.match(/(\.[a-z0-9]+)$/i)?.[1];
  const ext =
    extFromName ??
    (kind === "image" ? ".jpg" : ".pdf");
  const dest = path.join(dir, `${opts.invoiceId}${ext.toLowerCase()}`);
  fs.writeFileSync(dest, opts.bytes);
  return `/api/files/${opts.invoiceId}${ext.toLowerCase()}`;
}
