import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tstz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => tstz("created_at").notNull().defaultNow();

/* ------------------------------------------------------------------ tenancy */

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** sha256 hex of the org's email-intake token (shown once on creation); null = no per-org token. */
  intakeSecretHash: text("intake_secret_hash"),
  createdAt: createdAt(),
});

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "member"]);

/* ------------------------------------------------- Auth.js (drizzle adapter) */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: tstz("email_verified"),
  image: text("image"),
  passwordHash: text("password_hash"),
  /** Legacy app role (clerk / approver / admin); superseded by memberships.role in the tenancy rollout. */
  role: text("role").notNull().default("clerk"),
  createdAt: createdAt(),
  passwordChangedAt: tstz("password_changed_at"),
  /** Bumped on password change / "sign out everywhere"; a JWT carrying an older value is rejected. */
  tokenVersion: integer("token_version").notNull().default(0),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<"oauth" | "oidc" | "email" | "webauthn">().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (a) => [primaryKey({ columns: [a.provider, a.providerAccountId] }), index("accounts_user_id").on(a.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expires: tstz("expires").notNull(),
  },
  (s) => [index("sessions_user_id").on(s.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: tstz("expires").notNull(),
  },
  (v) => [primaryKey({ columns: [v.identifier, v.token] })],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (m) => [unique("memberships_org_user").on(m.orgId, m.userId), index("memberships_user_id").on(m.userId)],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: membershipRole("role").notNull().default("member"),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: tstz("expires_at").notNull(),
    acceptedAt: tstz("accepted_at"),
    createdAt: createdAt(),
  },
  (i) => [index("invites_org_id").on(i.orgId), index("invites_email").on(i.email)],
);

/* ---------------------------- sign-in throttle (epoch ms) */

export const authThrottle = pgTable(
  "auth_throttle",
  {
    key: text("key").primaryKey(),
    failures: integer("failures").notNull(),
    firstAt: bigint("first_at", { mode: "number" }).notNull(),
    lockedUntil: bigint("locked_until", { mode: "number" }),
  },
  (t) => [index("auth_throttle_first_at").on(t.firstAt)],
);

/* --------------------------------------------------------- tenant-owned tables */

const orgId = () => uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" });

export const vendors = pgTable(
  "vendors",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    legalName: text("legal_name").notNull(),
    approved: boolean("approved").notNull().default(true),
    currency: text("currency").notNull().default("USD"),
    paymentTerms: text("payment_terms").notNull().default("Net 30"),
    /** Verified tax id (GSTIN / VAT / EIN) and remittance details, entered out of band, never from an invoice. */
    taxId: text("tax_id"),
    bankAccount: text("bank_account"),
    bankCode: text("bank_code"),
    bankVerifiedAt: tstz("bank_verified_at"),
    bankVerifiedBy: text("bank_verified_by"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("vendors_org_id").on(t.orgId)],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    number: text("number").notNull(),
    vendorId: text("vendor_id").notNull(),
    amount: doublePrecision("amount").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("open"),
    issueDate: text("issue_date").notNull(),
    description: text("description").notNull(),
    goodsReceived: boolean("goods_received").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("purchase_orders_org_id").on(t.orgId)],
);

export const poLines = pgTable(
  "po_lines",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    poId: text("po_id").notNull(),
    description: text("description").notNull(),
    amount: doublePrecision("amount").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("po_lines_org_id").on(t.orgId)],
);

export const invoices = pgTable(
  "invoices",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    demoId: text("demo_id"),
    vendorId: text("vendor_id"),
    invoiceNumber: text("invoice_number"),
    invoiceDate: text("invoice_date"),
    currency: text("currency"),
    total: doublePrecision("total"),
    pdfPath: text("pdf_path"),
    status: text("status").notNull().default("queued"),
    runId: text("run_id"),
    source: text("source").notNull().default("upload"),
    sender: text("sender"),
    subject: text("subject"),
    createdAt: createdAt(),
    /** Payment scheduling: due date from vendor terms; batch + paid stamp once money moves. */
    dueDate: text("due_date"),
    paymentBatchId: text("payment_batch_id"),
    paidAt: tstz("paid_at"),
    paymentRef: text("payment_ref"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("invoices_org_id").on(t.orgId)],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    description: text("description").notNull(),
    amount: doublePrecision("amount").notNull(),
    poNumber: text("po_number"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("invoice_lines_org_id").on(t.orgId)],
);

export const matches = pgTable(
  "matches",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    poId: text("po_id").notNull(),
    amount: doublePrecision("amount").notNull(),
    method: text("method").notNull(),
    status: text("status").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("matches_org_id").on(t.orgId)],
);

export const allocations = pgTable(
  "allocations",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    payload: text("payload").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("allocations_org_id").on(t.orgId)],
);

export const fxRates = pgTable(
  "fx_rates",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    rate: doublePrecision("rate").notNull(),
    asOf: text("as_of").notNull(),
    source: text("source").notNull().default("seed"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("fx_rates_org_id").on(t.orgId)],
);

export const decisions = pgTable(
  "decisions",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    recommendation: text("recommendation").notNull(),
    final: text("final"),
    confidence: doublePrecision("confidence").notNull(),
    explanation: text("explanation").notNull(),
    needsHuman: boolean("needs_human").notNull(),
    trace: text("trace").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("decisions_org_id").on(t.orgId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    step: text("step").notNull(),
    status: text("status").notNull(),
    payload: text("payload").notNull(),
    at: tstz("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("audit_events_org_id").on(t.orgId)],
);

export const policyRules = pgTable(
  "policy_rules",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    label: text("label").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("policy_rules_org_id").on(t.orgId)],
);

export const decisionCorrections = pgTable(
  "decision_corrections",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    situation: text("situation").notNull(),
    original: text("original").notNull(),
    human: text("human").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("decision_corrections_org_id").on(t.orgId)],
);

export const jobs = pgTable(
  "jobs",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(4),
    runAt: tstz("run_at").notNull(),
    lockedUntil: tstz("locked_until"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: tstz("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    index("jobs_org_id").on(t.orgId),
    index("jobs_status_run_at").on(t.status, t.runAt),
  ],
);

export const emailMessages = pgTable(
  "email_messages",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    messageId: text("message_id").notNull(),
    sender: text("sender"),
    subject: text("subject"),
    receivedAt: tstz("received_at").notNull(),
    attachments: integer("attachments").notNull().default(0),
    invoiceIds: text("invoice_ids").notNull().default("[]"),
    source: text("source").notNull().default("webhook"),
    note: text("note"),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    index("email_messages_org_id").on(t.orgId),
    uniqueIndex("email_messages_org_message").on(t.orgId, t.messageId),
  ],
);

export const masterImports = pgTable(
  "master_imports",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    source: text("source").notNull(),
    signature: text("signature"),
    vendors: integer("vendors").notNull().default(0),
    pos: integer("pos").notNull().default(0),
    poLines: integer("po_lines").notNull().default(0),
    errors: text("errors").notNull().default("[]"),
    at: tstz("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("master_imports_org_id").on(t.orgId)],
);

export const evalCases = pgTable(
  "eval_cases",
  {
    orgId: orgId(),
    invoiceId: text("invoice_id").notNull(),
    scenario: text("scenario").notNull(),
    expected: text("expected").notNull(),
    truth: text("truth").notNull(),
    batch: text("batch").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.invoiceId] }), index("eval_cases_org_id").on(t.orgId)],
);

/* ----------------------------------------------------------------- payments */

export const paymentBatches = pgTable(
  "payment_batches",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    reference: text("reference").notNull(),
    currency: text("currency").notNull(),
    total: doublePrecision("total").notNull(),
    count: integer("count").notNull(),
    /** exported: bank file downloaded, waiting for confirmation · paid: confirmed sent · cancelled */
    status: text("status").notNull().default("exported"),
    /** The exact bank file handed out (CSV), so a re-download can never differ from what was paid. */
    file: text("file").notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    paidAt: tstz("paid_at"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("payment_batches_org_id").on(t.orgId)],
);

/* --------------------------------------------------- integrations (agent API) */

export const apiKeys = pgTable(
  "api_keys",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    /** First characters of the key, shown in the UI to tell keys apart ("ll_live_ab12"). */
    prefix: text("prefix").notNull(),
    /** sha256 hex of the full key; the key itself is shown once and never stored. */
    keyHash: text("key_hash").notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    lastUsedAt: tstz("last_used_at"),
    revokedAt: tstz("revoked_at"),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    index("api_keys_org_id").on(t.orgId),
    uniqueIndex("api_keys_key_hash").on(t.keyHash),
  ],
);

export const webhooks = pgTable(
  "webhooks",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    url: text("url").notNull(),
    /** Signing secret, AES-256-GCM encrypted with a key derived from AUTH_SECRET. */
    secretEnc: text("secret_enc").notNull(),
    events: text("events").notNull().default("*"),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    lastStatus: integer("last_status"),
    lastDeliveryAt: tstz("last_delivery_at"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("webhooks_org_id").on(t.orgId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    orgId: orgId(),
    id: text("id").notNull(),
    webhookId: text("webhook_id").notNull(),
    event: text("event").notNull(),
    payload: text("payload").notNull(),
    statusCode: integer("status_code"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
    deliveredAt: tstz("delivered_at"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("webhook_deliveries_org_id").on(t.orgId)],
);
