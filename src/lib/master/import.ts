import { createHash, randomUUID } from "node:crypto";
import { query } from "@/lib/db/client";
import { parseCsv } from "./csv";

export type ImportSummary = {
  vendors: number;
  pos: number;
  poLines: number;
  errors: string[];
};

export type MasterKind = "vendors" | "pos" | "po_lines";

export function detectKind(rows: Record<string, string>[], hint?: string): MasterKind | null {
  const h = (hint ?? "").toLowerCase();
  if (h.includes("line")) return "po_lines";
  if (h.includes("vendor") || h.includes("supplier")) return "vendors";
  if (/(^|[^a-z])po/.test(h) || h.includes("purchase")) return "pos";
  const cols = new Set(Object.keys(rows[0] ?? {}));
  if (cols.has("po_number") && cols.has("description") && !cols.has("vendor")) return "po_lines";
  if (cols.has("number") && cols.has("amount")) return "pos";
  if (cols.has("name") && (cols.has("approved") || cols.has("legal_name"))) return "vendors";
  return null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const bool = (v: string | undefined, d: boolean) =>
  v === undefined || v === "" ? d : /^(1|true|yes|y|approved|received)$/i.test(v);

function money(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v.replace(/[$€£₹,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Upsert vendors / POs / PO lines from CSV text. Rows with problems are skipped
 * and reported — the import never half-applies a bad row. The spreadsheet is the
 * source of truth: a vendor/PO present in the file overwrites the stored one.
 */
export async function importMaster(
  orgId: string,
  inputs: { name: string; text: string }[],
  source: string,
): Promise<ImportSummary> {
  const summary: ImportSummary = { vendors: 0, pos: 0, poLines: 0, errors: [] };

  const parsed = inputs.map((f) => {
    const rows = parseCsv(f.text);
    return { name: f.name, rows, kind: detectKind(rows, f.name) };
  });
  for (const p of parsed) {
    if (!p.kind) summary.errors.push(`${p.name}: could not tell if this is vendors, POs or PO lines`);
  }

  // Vendors first so POs can resolve vendor names.
  for (const f of parsed.filter((p) => p.kind === "vendors")) {
    for (const [i, r] of f.rows.entries()) {
      const where = `${f.name} row ${i + 2}`;
      const name = r.name;
      if (!name) {
        summary.errors.push(`${where}: missing name`);
        continue;
      }
      const id = r.id || `v-${slug(name)}`;
      await query(
        `INSERT INTO vendors (org_id,id,name,legal_name,approved,currency,payment_terms) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (org_id,id) DO UPDATE SET name=excluded.name, legal_name=excluded.legal_name,
           approved=excluded.approved, currency=excluded.currency, payment_terms=excluded.payment_terms`,
        [
          orgId,
          id,
          name,
          r.legal_name || name,
          bool(r.approved, true),
          (r.currency || "USD").toUpperCase(),
          r.payment_terms || "Net 30",
        ],
      );
      summary.vendors++;
    }
  }

  const vendors = await query<{ id: string; name: string; legal_name: string }>(
    "SELECT id,name,legal_name FROM vendors WHERE org_id = $1",
    [orgId],
  );
  const resolveVendor = (ref: string) => {
    const k = ref.toLowerCase();
    const hit = vendors.find(
      (v) =>
        String(v.id).toLowerCase() === k ||
        String(v.name).toLowerCase() === k ||
        String(v.legal_name).toLowerCase() === k,
    );
    return hit ? String(hit.id) : null;
  };

  for (const f of parsed.filter((p) => p.kind === "pos")) {
    for (const [i, r] of f.rows.entries()) {
      const where = `${f.name} row ${i + 2}`;
      const number = r.number || r.po_number;
      const amount = money(r.amount);
      const vendorRef = r.vendor_id || r.vendor || r.vendor_name || "";
      const vendorId = vendorRef ? resolveVendor(vendorRef) : null;
      if (!number) summary.errors.push(`${where}: missing PO number`);
      else if (amount === null || amount < 0) summary.errors.push(`${where} (${number}): invalid amount "${r.amount}"`);
      else if (!vendorId) summary.errors.push(`${where} (${number}): unknown vendor "${vendorRef}"`);
      else {
        const existing = (await query<{ id: string }>("SELECT id FROM purchase_orders WHERE org_id = $1 AND number = $2", [orgId, number]))[0];
        const id = existing ? String(existing.id) : `po-${slug(number)}`;
        await query(
          `INSERT INTO purchase_orders (org_id,id,number,vendor_id,amount,currency,status,issue_date,description,goods_received)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (org_id,id) DO UPDATE SET number=excluded.number, vendor_id=excluded.vendor_id, amount=excluded.amount,
             currency=excluded.currency, status=excluded.status, issue_date=excluded.issue_date,
             description=excluded.description, goods_received=excluded.goods_received`,
          [
            orgId,
            id,
            number,
            vendorId,
            amount,
            (r.currency || "USD").toUpperCase(),
            (r.status || "open").toLowerCase(),
            r.issue_date || new Date().toISOString().slice(0, 10),
            r.description || "",
            bool(r.goods_received, true),
          ],
        );
        summary.pos++;
      }
    }
  }

  const cleared = new Set<string>();
  for (const f of parsed.filter((p) => p.kind === "po_lines")) {
    for (const [i, r] of f.rows.entries()) {
      const where = `${f.name} row ${i + 2}`;
      const number = r.po_number || r.number || r.po;
      const amount = money(r.amount);
      const po = number
        ? (await query<{ id: string }>("SELECT id FROM purchase_orders WHERE org_id = $1 AND number = $2", [orgId, number]))[0]
        : null;
      if (!po) summary.errors.push(`${where}: unknown PO "${number ?? ""}"`);
      else if (amount === null) summary.errors.push(`${where}: invalid amount "${r.amount}"`);
      else {
        const poId = String(po.id);
        if (!cleared.has(poId)) {
          // File is source of truth for this PO's lines: replace, don't append.
          await query("DELETE FROM po_lines WHERE org_id = $1 AND po_id = $2", [orgId, poId]);
          cleared.add(poId);
        }
        await query("INSERT INTO po_lines (org_id,id,po_id,description,amount) VALUES ($1,$2,$3,$4,$5)", [
          orgId,
          randomUUID(),
          poId,
          r.description || "",
          amount,
        ]);
        summary.poLines++;
      }
    }
  }

  const signature = createHash("sha1").update(inputs.map((i) => i.text).join("\u0000")).digest("hex");
  await query("INSERT INTO master_imports (org_id,id,source,signature,vendors,pos,po_lines,errors,at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
    orgId,
    randomUUID(),
    source,
    signature,
    summary.vendors,
    summary.pos,
    summary.poLines,
    JSON.stringify(summary.errors),
    new Date(),
  ]);
  return summary;
}
