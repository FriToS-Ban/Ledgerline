import { query } from "@/lib/db/client";
import { defaultOrgId } from "@/lib/db/org";
import { importMaster, type ImportSummary } from "./import";

/**
 * Pulls the vendor / PO book from an ERP over HTTP (set ERP_URL, optionally ERP_TOKEN).
 * Expected JSON: { vendors: [...], purchaseOrders: [...], poLines: [...] } with camelCase or snake_case keys.
 * It reuses the CSV importer, so every row goes through the same validation and is reported, never half-applied.
 */
export const erpConfigured = () => !!process.env.ERP_URL;

type Row = Record<string, unknown>;

function toCsv(rows: Row[]): string {
  if (!rows.length) return "";
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [keys.map(cell).join(","), ...rows.map((r) => keys.map((k) => cell(r[k])).join(","))].join("\n");
}

const snake = (r: Row): Row =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/([A-Z])/g, "_$1").toLowerCase(), v]));

export async function syncFromErp(): Promise<ImportSummary & { skipped?: string }> {
  const url = process.env.ERP_URL;
  if (!url) return { vendors: 0, pos: 0, poLines: 0, errors: [], skipped: "ERP_URL not set" };
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      ...(process.env.ERP_TOKEN ? { authorization: `Bearer ${process.env.ERP_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ERP responded ${res.status}`);
  const body = (await res.json()) as { vendors?: Row[]; purchaseOrders?: Row[]; pos?: Row[]; poLines?: Row[] };
  const inputs = [
    { name: "vendors.csv", rows: body.vendors ?? [] },
    { name: "pos.csv", rows: body.purchaseOrders ?? body.pos ?? [] },
    { name: "po_lines.csv", rows: body.poLines ?? [] },
  ]
    .filter((f) => f.rows.length)
    .map((f) => ({ name: f.name, text: toCsv(f.rows.map(snake)) }));
  if (!inputs.length) return { vendors: 0, pos: 0, poLines: 0, errors: ["ERP returned no records"] };
  return importMaster(inputs, "erp");
}

/** Run at most every ERP_SYNC_MINUTES (default 15); safe to call on every worker tick. */
export async function syncErpIfDue() {
  if (!erpConfigured()) return null;
  const last = (
    await query<{ at: Date }>("SELECT at FROM master_imports WHERE org_id = $1 AND source = 'erp' ORDER BY at DESC LIMIT 1", [
      await defaultOrgId(),
    ])
  )[0];
  const every = Number(process.env.ERP_SYNC_MINUTES ?? 15) * 60_000;
  if (last && Date.now() - new Date(String(last.at)).getTime() < every) return null;
  return syncFromErp();
}
