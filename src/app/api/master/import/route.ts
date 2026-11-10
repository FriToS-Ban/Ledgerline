import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, rawDbClient, usingHostedDb } from "@/lib/db/client";
import { seedDatabase } from "@/lib/db/seed";
import { importMaster } from "@/lib/master/import";
import { syncMasterFolder } from "@/lib/master/sync";
import { erpConfigured, syncFromErp } from "@/lib/master/erp";
import { denyUnless, requireSignedIn } from "@/lib/auth/users";

export async function GET() {
  const unauth = await requireSignedIn();
  if (unauth) return unauth;
  await seedDatabase();
  const db = rawDbClient();
  const [v, p, l, imports] = await Promise.all([
    db.execute("SELECT * FROM vendors ORDER BY name"),
    db.execute("SELECT * FROM purchase_orders ORDER BY number"),
    db.execute("SELECT COUNT(*) c FROM po_lines"),
    db.execute("SELECT * FROM master_imports ORDER BY at DESC LIMIT 10"),
  ]);
  return NextResponse.json({
    vendors: v.rows,
    pos: p.rows,
    poLineCount: Number(l.rows[0]?.c ?? 0),
    imports: imports.rows,
    erp: erpConfigured(),
    hostedDb: usingHostedDb(),
  });
}

/** multipart `file` (one or more CSVs) -> import. JSON {sync:true} -> re-read data/master. */
export async function POST(req: NextRequest) {
  const denied = await denyUnless(["admin"]);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
  await ensureSchema();
  await seedDatabase();
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const inputs: { name: string; text: string }[] = [];
    for (const f of form.getAll("file")) {
      if (f instanceof File) inputs.push({ name: f.name, text: await f.text() });
    }
    if (!inputs.length) return NextResponse.json({ error: "no files" }, { status: 400 });
    return NextResponse.json(await importMaster(inputs, "upload"));
  }
  const body = (await req.json().catch(() => ({}))) as { erp?: boolean };
  if (body.erp) {
    if (!erpConfigured()) return NextResponse.json({ error: "ERP_URL is not set" }, { status: 400 });
    try {
      return NextResponse.json(await syncFromErp());
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "ERP sync failed" }, { status: 502 });
    }
  }
  return NextResponse.json(await syncMasterFolder());
}
