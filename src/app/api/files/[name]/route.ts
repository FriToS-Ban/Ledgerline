import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireSignedIn } from "@/lib/auth/users";

const TYPES: Record<string, string> = {
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

/**
 * Serves stored invoice files. A production build only serves files that existed in public/ at
 * build time, so invoices that arrive later (email, upload) are streamed from here, behind sign-in.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const unauth = await requireSignedIn();
  if (unauth) return unauth;
  const { name } = await ctx.params;
  // The stored name is "<uuid>.<ext>": reject anything that could climb out of the folder.
  if (!/^[A-Za-z0-9-]+\.[a-z0-9]{2,5}$/i.test(name)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const file = path.join(process.cwd(), "public", "uploads", name);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const type = TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
  return new NextResponse(fs.readFileSync(file), {
    headers: { "content-type": type, "content-disposition": "inline", "cache-control": "private, max-age=3600" },
  });
}
