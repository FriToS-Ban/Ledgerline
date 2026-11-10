import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireActor } from "@/lib/auth/guard";
import { getDb } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { contentTypeForKey } from "@/lib/extract/save-upload";
import { getStorage, keyBelongsToOrg } from "@/lib/storage";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/**
 * Streams a stored invoice file. The path segment is the invoice id; the object key comes from that
 * invoice's row, so it is only served to the organization that owns the invoice and the key.
 * There are no public or presigned URLs: every byte goes through this check.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const g = await requireActor();
  if (g.deny) return g.deny;
  const { name } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) return notFound();
  const [inv] = await getDb()
    .select({ pdfPath: invoices.pdfPath })
    .from(invoices)
    .where(and(eq(invoices.orgId, g.actor.orgId), eq(invoices.id, name)));
  const key = inv?.pdfPath;
  if (!key || !keyBelongsToOrg(key, g.actor.orgId)) return notFound();
  // Allow-list: anything that isn't a PDF or raster image (e.g. .html, .svg) is never served.
  const type = contentTypeForKey(key);
  if (!type) return notFound();
  const stream = await getStorage().get(key);
  if (!stream) return notFound();
  const ext = key.match(/(\.[a-z0-9]+)$/i)?.[1] ?? "";
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "content-type": type,
      "content-disposition": `inline; filename="${name}${ext}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
