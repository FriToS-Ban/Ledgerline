import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { query } from "@/lib/db/client";
import { importMaster } from "./import";

export const MASTER_DIR = path.join(process.cwd(), "data", "master");

/**
 * Drop vendors.csv / pos.csv / po_lines.csv (e.g. a nightly export from the ERP or
 * a shared spreadsheet) into data/master. Re-imports only when contents changed.
 */
export async function syncMasterFolder(orgId: string): Promise<{ imported: boolean; reason?: string }> {
  if (!fs.existsSync(MASTER_DIR)) return { imported: false, reason: "no data/master folder" };
  const files = fs
    .readdirSync(MASTER_DIR)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .sort();
  if (!files.length) return { imported: false, reason: "no csv files" };
  const inputs = files.map((name) => ({ name, text: fs.readFileSync(path.join(MASTER_DIR, name), "utf8") }));
  const signature = createHash("sha1").update(inputs.map((i) => i.text).join("\u0000")).digest("hex");

  const last = (
    await query<{ signature: string | null }>(
      "SELECT signature FROM master_imports WHERE org_id = $1 AND source = 'folder' ORDER BY at DESC LIMIT 1",
      [orgId],
    )
  )[0];
  if (last && String(last.signature) === signature) return { imported: false, reason: "unchanged" };
  await importMaster(orgId, inputs, "folder");
  return { imported: true };
}
