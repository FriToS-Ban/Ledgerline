import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const vendors = sqliteTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  approved: integer("approved", { mode: "boolean" }).notNull().default(true),
  currency: text("currency").notNull().default("USD"),
  paymentTerms: text("payment_terms").notNull().default("Net 30"),
});

export const purchaseOrders = sqliteTable("purchase_orders", {
  id: text("id").primaryKey(),
  number: text("number").notNull(),
  vendorId: text("vendor_id").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("open"),
  issueDate: text("issue_date").notNull(),
  description: text("description").notNull(),
  goodsReceived: integer("goods_received", { mode: "boolean" }).notNull().default(true),
});

export const poLines = sqliteTable("po_lines", {
  id: text("id").primaryKey(),
  poId: text("po_id").notNull(),
  description: text("description").notNull(),
  amount: real("amount").notNull(),
});

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  demoId: text("demo_id"),
  vendorId: text("vendor_id"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: text("invoice_date"),
  currency: text("currency"),
  total: real("total"),
  pdfPath: text("pdf_path"),
  status: text("status").notNull().default("queued"),
  runId: text("run_id"),
  source: text("source").notNull().default("upload"),
  sender: text("sender"),
  subject: text("subject"),
  createdAt: text("created_at").notNull(),
});

export const invoiceLines = sqliteTable("invoice_lines", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  description: text("description").notNull(),
  amount: real("amount").notNull(),
  poNumber: text("po_number"),
});

export const matches = sqliteTable("matches", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  poId: text("po_id").notNull(),
  amount: real("amount").notNull(),
  method: text("method").notNull(),
  status: text("status").notNull(),
});

export const allocations = sqliteTable("allocations", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  payload: text("payload").notNull(),
});

export const fxRates = sqliteTable("fx_rates", {
  id: text("id").primaryKey(),
  base: text("base").notNull(),
  quote: text("quote").notNull(),
  rate: real("rate").notNull(),
  asOf: text("as_of").notNull(),
  source: text("source").notNull().default("seed"),
});

export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  recommendation: text("recommendation").notNull(),
  final: text("final"),
  confidence: real("confidence").notNull(),
  explanation: text("explanation").notNull(),
  needsHuman: integer("needs_human", { mode: "boolean" }).notNull(),
  trace: text("trace").notNull(),
  createdAt: text("created_at").notNull(),
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  step: text("step").notNull(),
  status: text("status").notNull(),
  payload: text("payload").notNull(),
  at: text("at").notNull(),
});

export const policyRules = sqliteTable("policy_rules", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  label: text("label").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

export const decisionCorrections = sqliteTable("decision_corrections", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  situation: text("situation").notNull(),
  original: text("original").notNull(),
  human: text("human").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(4),
  runAt: text("run_at").notNull(),
  lockedUntil: text("locked_until"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const emailMessages = sqliteTable("email_messages", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull(),
  sender: text("sender"),
  subject: text("subject"),
  receivedAt: text("received_at").notNull(),
  attachments: integer("attachments").notNull().default(0),
  invoiceIds: text("invoice_ids").notNull().default("[]"),
  source: text("source").notNull().default("webhook"),
  note: text("note"),
});

export const masterImports = sqliteTable("master_imports", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  signature: text("signature"),
  vendors: integer("vendors").notNull().default(0),
  pos: integer("pos").notNull().default(0),
  poLines: integer("po_lines").notNull().default(0),
  errors: text("errors").notNull().default("[]"),
  at: text("at").notNull(),
});

export const evalCases = sqliteTable("eval_cases", {
  invoiceId: text("invoice_id").primaryKey(),
  scenario: text("scenario").notNull(),
  expected: text("expected").notNull(),
  truth: text("truth").notNull(),
  batch: text("batch").notNull(),
});
