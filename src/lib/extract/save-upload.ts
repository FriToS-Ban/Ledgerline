import { sniffKind } from "./parse-text";
import { buildKey, getStorage, sanitizeFilename } from "@/lib/storage";

/** Only inert document/image types are ever stored (never .html, .svg, .js ...). */
export const UPLOAD_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"];
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

export function contentTypeForKey(key: string): string | undefined {
  const ext = key.match(/(\.[a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return ext ? CONTENT_TYPES[ext] : undefined;
}

export class UploadRejected extends Error {
  constructor(message: string, readonly status: 413 | 415) {
    super(message);
  }
}

/** Validates size/type, stores the bytes under org/<orgId>/..., and returns the storage key. */
export async function saveUpload(opts: { orgId: string; filename?: string; bytes: Uint8Array }): Promise<string> {
  if (opts.bytes.length === 0) throw new UploadRejected("empty file", 415);
  if (opts.bytes.length > MAX_UPLOAD_BYTES) throw new UploadRejected("file too large (15 MB max)", 413);
  const kind = sniffKind(opts.filename, opts.bytes);
  if (kind === "unknown") throw new UploadRejected("only PDF and image files are accepted", 415);
  const named = opts.filename?.match(/(\.[a-z0-9]+)$/i)?.[1]?.toLowerCase();
  // Allow-list: a .html/.svg/.js name is never kept; the file is stored as .pdf/.jpg by content.
  const ext = named && UPLOAD_EXTENSIONS.includes(named) ? named : kind === "image" ? ".jpg" : ".pdf";
  const base = (opts.filename ?? "invoice").replace(/\.[a-z0-9]+$/i, "");
  const key = buildKey(opts.orgId, `${sanitizeFilename(base).slice(0, 60)}${ext}`);
  await getStorage().put(key, opts.bytes, CONTENT_TYPES[ext]);
  return key;
}
