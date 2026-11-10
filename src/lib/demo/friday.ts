import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { randomUUID } from "node:crypto";
import { query } from "@/lib/db/client";
import { seedDatabase } from "@/lib/db/seed";
import { importMaster } from "@/lib/master/import";
import { ingestRawEmail } from "@/lib/email/ingest";

/**
 * "Friday inbox": ~30 messy supplier invoices, each with a known right answer.
 * The vendor/PO book is loaded through the same CSV importer a real ERP export would use,
 * and every invoice arrives as an email attachment through the real intake + queue.
 * `expected` is the set of acceptable engine recommendations; `truth` is what the extractor should read.
 */

export type Truth = { vendor: string; invoiceNumber: string | null; total: number | null; poNumbers: string[] };
type Spec = {
  scenario: string;
  expected: string[];
  vendor: string;
  invoiceNumber: string | null;
  date: string | null;
  currency: string;
  poNumber: string | null;
  lines: { description: string; amount: number }[];
  total: number | null;
  scanned?: boolean;
  truth: Truth;
};

const VENDORS = [
  { name: "Atlas Fasteners Co", approved: "yes", currency: "USD" },
  { name: "Brightline Packaging", approved: "yes", currency: "USD" },
  { name: "Cobalt Electronics", approved: "yes", currency: "USD" },
  { name: "Dunmore Safety Supply", approved: "yes", currency: "USD" },
  { name: "Evergreen Janitorial", approved: "yes", currency: "USD" },
  { name: "Fulcrum Tooling", approved: "yes", currency: "USD" },
  { name: "Rhein Tools GmbH", approved: "yes", currency: "EUR" },
  { name: "Shadow Supplies LLC", approved: "no", currency: "USD" },
];
const ITEMS = [
  "Hex bolts grade 8 assorted",
  "Corrugated shipping cartons 24x18",
  "Control board assemblies rev C",
  "Hi-vis vests and hard hats",
  "Monthly facility cleaning service",
  "Carbide end mills set",
  "Hydraulic couplings and fittings",
  "Pallet wrap and strapping",
];

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
const r2 = (n: number) => Math.round(n * 100) / 100;

function buildSpecs() {
  const specs: Spec[] = [];
  const pos: { number: string; vendor: string; amount: number; currency: string; description: string }[] = [];
  let n = 0;
  const add = (
    scenario: string,
    expected: string[],
    o: {
      vendorIdx: number;
      poAmount: number;
      invoiceTotal?: number | null;
      poStated?: boolean;
      invoiceNumber?: string | null;
      date?: string | null;
      scanned?: boolean;
      currency?: string;
      poCurrency?: string;
      poOverride?: string;
      description?: string;
    },
  ) => {
    n++;
    const v = VENDORS[o.vendorIdx];
    const poNumber = o.poOverride ?? `PO-F${100 + n}`;
    const description = o.description ?? `${ITEMS[o.vendorIdx]} lot ${n}`;
    if (!o.poOverride) {
      pos.push({ number: poNumber, vendor: v.name, amount: o.poAmount, currency: o.poCurrency ?? "USD", description });
    }
    const total = o.invoiceTotal === undefined ? o.poAmount : o.invoiceTotal;
    const invoiceNumber = o.invoiceNumber === undefined ? `FR-${5000 + n}` : o.invoiceNumber;
    const stated = o.poStated !== false && !o.scanned;
    specs.push({
      scenario,
      expected,
      vendor: v.name,
      invoiceNumber,
      date: o.date === undefined ? `2026-11-0${2 + (n % 3)}` : o.date,
      currency: o.currency ?? "USD",
      poNumber: stated ? poNumber : null,
      lines: [{ description, amount: total ?? 0 }],
      total,
      scanned: o.scanned,
      truth: {
        vendor: v.name,
        invoiceNumber: o.scanned ? null : invoiceNumber,
        total: o.scanned ? null : total,
        poNumbers: stated ? [poNumber] : [],
      },
    });
    return specs[specs.length - 1];
  };

  const AUTO = ["auto_approve"];
  const NOT_PAID = ["escalate", "reject", "partial_approve"];
  for (let i = 0; i < 12; i++) add("Clean match", AUTO, { vendorIdx: i % 6, poAmount: 1200 + i * 310.5 });
  for (let i = 0; i < 3; i++) add("Within tolerance (+1%)", AUTO, { vendorIdx: i, poAmount: 2000 + i * 400, invoiceTotal: r2((2000 + i * 400) * 1.01) });
  for (let i = 0; i < 3; i++) add("Over tolerance (+9%)", NOT_PAID, { vendorIdx: 3 + i, poAmount: 3000 + i * 500, invoiceTotal: r2((3000 + i * 500) * 1.09) });
  for (let i = 0; i < 2; i++) add("Unapproved vendor", ["escalate", "reject"], { vendorIdx: 7, poAmount: 1800 + i * 250 });
  for (let i = 0; i < 3; i++) add("No PO number (implied)", ["auto_approve", "escalate"], { vendorIdx: i, poAmount: 2600 + i * 175, poStated: false });
  for (let i = 0; i < 2; i++) add("Unreadable scan", ["escalate"], { vendorIdx: 4 + i, poAmount: 900 + i * 100, scanned: true });
  for (let i = 0; i < 2; i++) {
    const poAmount = 5000 + i * 1000;
    add("EUR invoice vs USD PO", AUTO, { vendorIdx: 6, poAmount: r2(poAmount * 1.082), currency: "EUR", invoiceTotal: poAmount, poCurrency: "USD", date: "2026-11-03" });
  }
  // Resent invoices: same vendor, number and amount as an earlier clean invoice.
  for (let i = 0; i < 2; i++) {
    const src = specs[i];
    const dup = add("Duplicate resend", ["reject", "escalate"], {
      vendorIdx: VENDORS.findIndex((v) => v.name === src.vendor),
      poAmount: src.total ?? 0,
      invoiceNumber: src.invoiceNumber,
      poOverride: src.poNumber ?? undefined,
      description: src.lines[0].description,
    });
    dup.date = src.date;
  }
  return { specs, pos };
}

async function renderPdf(s: Spec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.09, 0.12);
  const draw = (t: string, y: number, size = 11, b = false, x = 48) =>
    page.drawText(t, { x, y, size, font: b ? bold : font, color: ink });

  if (s.scanned) {
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.86, 0.86, 0.84) });
    draw("SCANNED COPY — quality degraded", 740, 10);
    draw(s.vendor, 700, 16, true);
    draw("Invoice No. (smudged)", 660, 12);
    draw("Date: 03 Nov 2026?", 640);
    draw("Total ~ ?? ", 500, 14);
    return doc.save();
  }
  draw("INVOICE", 740, 22, true);
  draw(s.vendor, 712, 14, true);
  draw(`Invoice Number: ${s.invoiceNumber}`, 680);
  draw(`Date: ${s.date}`, 662);
  draw(`Currency: ${s.currency}`, 644);
  draw(`PO: ${s.poNumber ?? "(none stated)"}`, 626);
  let y = 580;
  draw("Description", y, 11, true);
  draw("Amount", y, 11, true, 460);
  y -= 22;
  for (const l of s.lines) {
    draw(l.description.slice(0, 70), y, 10);
    draw(l.amount.toFixed(2), y, 10, false, 460);
    y -= 20;
  }
  y -= 12;
  draw(`Subtotal: ${s.total?.toFixed(2)}`, y);
  draw("Tax: 0.00", y - 16);
  draw("Shipping: 0.00", y - 32);
  draw(`Total: ${s.total?.toFixed(2)} ${s.currency}`, y - 52, 14, true);
  return doc.save();
}

function toEml(s: Spec, i: number, pdf: Uint8Array, batch: string) {
  const b = `----ledgerline-${i}`;
  const from = `billing@${s.vendor.toLowerCase().replace(/[^a-z]+/g, "")}.example`;
  const b64 = Buffer.from(pdf).toString("base64").replace(/(.{76})/g, "$1\r\n");
  return Buffer.from(
    [
      `From: ${s.vendor} <${from}>`,
      "To: ap@ledgerline.example",
      `Subject: Invoice ${s.invoiceNumber ?? "(scan)"} from ${s.vendor}`,
      `Message-ID: <${batch}-${i}@friday.ledgerline.example>`,
      `Content-Type: multipart/mixed; boundary="${b}"`,
      "",
      `--${b}`,
      "Content-Type: text/plain",
      "",
      "Please find our invoice attached. Thanks!",
      `--${b}`,
      `Content-Type: application/pdf; name="invoice-${i}.pdf"`,
      `Content-Disposition: attachment; filename="invoice-${i}.pdf"`,
      "Content-Transfer-Encoding: base64",
      "",
      b64,
      `--${b}--`,
      "",
    ].join("\r\n"),
  );
}

/** Load the Friday book and drop every invoice into the inbox (queued, not yet processed). */
export async function loadFridayInbox(orgId: string) {
  await seedDatabase(orgId);
  const existing = await query<{ c: string }>("SELECT COUNT(*) c FROM eval_cases WHERE org_id = $1", [orgId]);
  if (Number(existing[0].c) > 0) return { alreadyLoaded: true, invoices: Number(existing[0].c) };

  const { specs, pos } = buildSpecs();
  await importMaster(
    orgId,
    [
      { name: "vendors.csv", text: csv([["name", "approved", "currency"], ...VENDORS.map((v) => [v.name, v.approved, v.currency])]) },
      {
        name: "pos.csv",
        text: csv([
          ["number", "vendor", "amount", "currency", "issue_date", "description", "status"],
          ...pos.map((p) => [p.number, p.vendor, p.amount, p.currency, "2026-10-20", p.description, "open"]),
        ]),
      },
    ],
    "friday-demo",
  );

  const batch = `fri-${randomUUID().slice(0, 6)}`;
  let i = 0;
  for (const s of specs) {
    i++;
    const pdf = await renderPdf(s);
    const res = await ingestRawEmail(orgId, toEml(s, i, pdf, batch), "cli");
    const invoiceId = res.invoiceIds[0];
    if (!invoiceId) continue;
    await query("INSERT INTO eval_cases (org_id,invoice_id,scenario,expected,truth,batch) VALUES ($1,$2,$3,$4,$5,$6)", [
      orgId,
      invoiceId,
      s.scenario,
      JSON.stringify(s.expected),
      JSON.stringify(s.truth),
      batch,
    ]);
  }
  return { alreadyLoaded: false, invoices: specs.length };
}
