import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/client";
import { defaultOrgId } from "@/lib/db/org";
import { seedDatabase } from "@/lib/db/seed";
import { importMaster } from "@/lib/master/import";
import { syncMasterFolder } from "@/lib/master/sync";
import { erpConfigured, syncFromErp } from "@/lib/master/erp";
import { denyUnless, requireSignedIn } from "@/lib/auth/guard";

export async function GET() {
  const unauth = await requireSignedIn();
  if (unauth) return unauth;
  await seedDatabase();
  const orgId = await defaultOrgId();
  const [v, p, l, imports] = await Promise.all([
    query("SELECT * FROM vendors WHERE org_id = $1 ORDER BY name", [orgId]),
    query("SELECT * FROM purchase_orders WHERE org_id = $1 ORDER BY number", [orgId]),
    query<{ c: string }>("SELECT COUNT(*) c FROM po_lines WHERE org_id = $1", [orgId]),
    query("SELECT * FROM master_imports WHERE org_id = $1 ORDER BY at DESC LIMIT 10", [orgId]),
  ]);
  return NextResponse.json({
    vendors: v,
    pos: p,
    poLineCount: Number(l[0]?.c ?? 0),
    imports,
    erp: erpConfigured(),
  });
}

/** multipart `file` (one or more CSVs) -> import. JSON {sync:true} -> re-read data/master. */
export async function POST(req: NextRequest) {
  const denied = await denyUnless(["admin"]);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
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
