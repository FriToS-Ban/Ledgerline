import { ensureSchema, rawDbClient } from "./client";
import { generateDemoPdfs } from "@/lib/pdf/generate";

const MASTER = {
  vendors: [
    { id: "v-apex", name: "Apex Industrial Supply", legalName: "Apex Industrial Supply Inc.", approved: 1, currency: "USD", paymentTerms: "Net 30" },
    { id: "v-north", name: "Northwind Logistics", legalName: "Northwind Logistics Ltd.", approved: 1, currency: "USD", paymentTerms: "Net 45" },
    { id: "v-helios", name: "Helios Components GmbH", legalName: "Helios Components GmbH", approved: 1, currency: "EUR", paymentTerms: "Net 30" },
    { id: "v-meridian", name: "Meridian Facilities", legalName: "Meridian Facilities LLC", approved: 1, currency: "USD", paymentTerms: "Net 30" },
  ],
  pos: [
    { id: "po-31000", number: "PO-31000", vendorId: "v-apex", amount: 31000, currency: "USD", status: "open", issueDate: "2026-09-01", description: "Stainless fastener kit blanket — progressive billing", goodsReceived: 1 },
    { id: "po-88021", number: "PO-88021", vendorId: "v-apex", amount: 8450, currency: "USD", status: "open", issueDate: "2026-10-02", description: "Stainless fasteners kit hex cap screws M8", goodsReceived: 1 },
    { id: "po-4410", number: "PO-4410", vendorId: "v-north", amount: 5380, currency: "USD", status: "open", issueDate: "2026-10-01", description: "Inbound logistics with estimated freight 180", goodsReceived: 1 },
    { id: "po-5519", number: "PO-5519", vendorId: "v-apex", amount: 4210, currency: "USD", status: "open", issueDate: "2026-10-10", description: "Metric hex nuts assortment 8-12mm", goodsReceived: 1 },
    { id: "po-eur-19", number: "PO-EUR-19", vendorId: "v-helios", amount: 10603.6, currency: "USD", status: "open", issueDate: "2026-10-05", description: "Precision bearings 6204-2RS", goodsReceived: 1 },
    { id: "po-7701", number: "PO-7701", vendorId: "v-meridian", amount: 3000, currency: "USD", status: "open", issueDate: "2026-10-08", description: "Q4 HVAC filter replacement", goodsReceived: 1 },
    { id: "po-7702", number: "PO-7702", vendorId: "v-meridian", amount: 1800, currency: "USD", status: "open", issueDate: "2026-10-08", description: "Emergency rooftop unit service", goodsReceived: 1 },
  ],
  poLines: [
    { id: "pl1", poId: "po-31000", description: "Fastener kit phase deliveries", amount: 31000 },
    { id: "pl2", poId: "po-4410", description: "Palletized inbound handling", amount: 5200 },
    { id: "pl3", poId: "po-4410", description: "Estimated shipping / freight", amount: 180 },
    { id: "pl4", poId: "po-7701", description: "HVAC filters", amount: 3000 },
    { id: "pl5", poId: "po-7702", description: "RTU service", amount: 1800 },
  ],
  historyInvoices: [
    { id: "inv-hist-1", demoId: "seed-partial-1", vendorId: "v-apex", invoiceNumber: "INV-P-1100", invoiceDate: "2026-09-20", currency: "USD", total: 12400, pdfPath: null, status: "approved", runId: null, createdAt: "2026-09-20T12:00:00Z" },
    { id: "inv-hist-2", demoId: "seed-dup", vendorId: "v-apex", invoiceNumber: "INV-8842", invoiceDate: "2026-10-20", currency: "USD", total: 4210, pdfPath: null, status: "approved", runId: null, createdAt: "2026-10-20T12:00:00Z" },
  ],
  historyMatches: [
    { id: "m1", invoiceId: "inv-hist-1", poId: "po-31000", amount: 12400, method: "explicit", status: "approved" },
    { id: "m2", invoiceId: "inv-hist-2", poId: "po-5519", amount: 4210, method: "explicit", status: "approved" },
  ],
  historyLines: [
    { id: "hl1", invoiceId: "inv-hist-2", description: "Metric hex nuts assortment 8–12mm", amount: 4210, poNumber: "PO-5519" },
  ],
  fx: [
    { id: "fx1", base: "EUR", quote: "USD", rate: 1.082, asOf: "2026-10-28", source: "seed" },
    { id: "fx2", base: "GBP", quote: "USD", rate: 1.31, asOf: "2026-10-28", source: "seed" },
    { id: "fx3", base: "USD", quote: "USD", rate: 1, asOf: "2026-01-01", source: "seed" },
    { id: "fx4", base: "INR", quote: "USD", rate: 0.012, asOf: "2026-10-01", source: "seed" },
  ],
  policy: [
    { id: "p1", key: "amountTolerancePct", value: "0.02", label: "Amount tolerance %", enabled: 1 },
    { id: "p2", key: "amountToleranceAbs", value: "50", label: "Amount tolerance $", enabled: 1 },
    { id: "p3", key: "duplicateAmountPct", value: "0.015", label: "Near-duplicate amount %", enabled: 1 },
    { id: "p4", key: "confidenceFloor", value: "0.7", label: "Extraction confidence floor", enabled: 1 },
    { id: "p5", key: "fxMaxAgeDays", value: "7", label: "FX rate max age (days)", enabled: 1 },
    { id: "p6", key: "approvalThreshold", value: "25000", label: "Approval threshold", enabled: 1 },
    { id: "p7", key: "impliedMatchAuto", value: "0.85", label: "Implied match auto-approve score", enabled: 1 },
    { id: "p8", key: "impliedMatchEscalate", value: "0.55", label: "Implied match candidate floor", enabled: 1 },
    { id: "p9", key: "dateWindowDays", value: "45", label: "PO date window (days)", enabled: 1 },
    { id: "p10", key: "duplicateDateWindowDays", value: "14", label: "Duplicate date window (days)", enabled: 1 },
  ],
};

export async function seedDatabase() {
  await ensureSchema();
  const client = rawDbClient();

  const count = await client.execute("SELECT COUNT(*) as c FROM vendors");
  const n = Number(count.rows[0]?.c ?? 0);
  if (n === 0) {
    for (const v of MASTER.vendors) {
      await client.execute({
        sql: "INSERT INTO vendors (id,name,legal_name,approved,currency,payment_terms) VALUES (?,?,?,?,?,?)",
        args: [v.id, v.name, v.legalName, v.approved, v.currency, v.paymentTerms],
      });
    }
    for (const p of MASTER.pos) {
      await client.execute({
        sql: "INSERT INTO purchase_orders (id,number,vendor_id,amount,currency,status,issue_date,description,goods_received) VALUES (?,?,?,?,?,?,?,?,?)",
        args: [p.id, p.number, p.vendorId, p.amount, p.currency, p.status, p.issueDate, p.description, p.goodsReceived],
      });
    }
    for (const l of MASTER.poLines) {
      await client.execute({
        sql: "INSERT INTO po_lines (id,po_id,description,amount) VALUES (?,?,?,?)",
        args: [l.id, l.poId, l.description, l.amount],
      });
    }
    for (const inv of MASTER.historyInvoices) {
      await client.execute({
        sql: "INSERT INTO invoices (id,demo_id,vendor_id,invoice_number,invoice_date,currency,total,pdf_path,status,run_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        args: [inv.id, inv.demoId, inv.vendorId, inv.invoiceNumber, inv.invoiceDate, inv.currency, inv.total, inv.pdfPath, inv.status, inv.runId, inv.createdAt],
      });
    }
    for (const m of MASTER.historyMatches) {
      await client.execute({
        sql: "INSERT INTO matches (id,invoice_id,po_id,amount,method,status) VALUES (?,?,?,?,?,?)",
        args: [m.id, m.invoiceId, m.poId, m.amount, m.method, m.status],
      });
    }
    for (const l of MASTER.historyLines) {
      await client.execute({
        sql: "INSERT INTO invoice_lines (id,invoice_id,description,amount,po_number) VALUES (?,?,?,?,?)",
        args: [l.id, l.invoiceId, l.description, l.amount, l.poNumber],
      });
    }
    for (const f of MASTER.fx) {
      await client.execute({
        sql: "INSERT INTO fx_rates (id,base,quote,rate,as_of,source) VALUES (?,?,?,?,?,?)",
        args: [f.id, f.base, f.quote, f.rate, f.asOf, f.source],
      });
    }
    for (const p of MASTER.policy) {
      await client.execute({
        sql: "INSERT INTO policy_rules (id,key,value,label,enabled) VALUES (?,?,?,?,?)",
        args: [p.id, p.key, p.value, p.label, p.enabled],
      });
    }
  }

  for (const r of [
    { id: "p11", key: "clerkLimit", value: "5000", label: "Clerk approval limit ($)" },
    { id: "p12", key: "approverLimit", value: "100000", label: "Approver approval limit ($)" },
  ]) {
    const have = await client.execute({ sql: "SELECT id FROM policy_rules WHERE key = ?", args: [r.key] });
    if (!have.rows.length) {
      await client.execute({
        sql: "INSERT INTO policy_rules (id,key,value,label,enabled) VALUES (?,?,?,?,1)",
        args: [r.id, r.key, r.value, r.label],
      });
    }
  }

  const inr = await client.execute("SELECT id FROM fx_rates WHERE id = 'fx4'");
  if (!inr.rows.length) {
    await client.execute({
      sql: "INSERT INTO fx_rates (id,base,quote,rate,as_of,source) VALUES (?,?,?,?,?,?)",
      args: ["fx4", "INR", "USD", 0.012, "2026-10-01", "seed"],
    });
  }

  await generateDemoPdfs();
  return { seeded: n === 0 };
}

if (process.argv[1]?.includes("seed")) {
  seedDatabase().then((r) => {
    console.log(r);
  });
}
