import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { authenticateApiKey, takeRateLimit, type ApiCaller } from "@/lib/api-keys";
import type { Extraction, PipelineTrace } from "@/lib/invoice/schema";

/* ------------------------------------------------------------------- errors */

export function apiError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

/** Authenticates the bearer key and applies the per-key rate limit. */
export async function apiAuth(req: Request): Promise<{ caller: ApiCaller; deny?: undefined } | { caller?: undefined; deny: NextResponse }> {
  const caller = await authenticateApiKey(req.headers.get("authorization"));
  if (!caller) {
    return { deny: apiError(401, "unauthorized", "Send a workspace API key as `Authorization: Bearer ll_live_…`.", { "WWW-Authenticate": "Bearer" }) };
  }
  const rl = takeRateLimit(caller.keyId);
  if (!rl.ok) return { deny: apiError(429, "rate_limited", "Too many requests for this key; slow down.", { "Retry-After": String(rl.retryAfter) }) };
  return { caller };
}

/* -------------------------------------------------------------------- input */

const money = z.number().finite();

/** "Bring your own extraction": fields your agent already read off the invoice. */
export const submitSchema = z.object({
  externalId: z.string().max(100).optional(),
  vendorName: z.string().trim().min(1).max(200),
  invoiceNumber: z.string().trim().max(80).nullable(),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
    .nullable(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .transform((s) => s.toUpperCase())
    .default("USD"),
  total: money.nullable(),
  subtotal: money.nullable().optional(),
  tax: money.nullable().optional(),
  shipping: money.nullable().optional(),
  poNumbers: z.array(z.string().max(60)).max(20).default([]),
  lineItems: z
    .array(
      z.object({
        description: z.string().max(300),
        amount: money,
        quantity: z.number().finite().nullable().optional(),
        unitPrice: money.nullable().optional(),
        poNumber: z.string().max(60).nullable().optional(),
      }),
    )
    .max(500)
    .default([]),
  bankDetails: z
    .object({
      accountNumber: z.string().max(40).nullable().optional(),
      iban: z.string().max(40).nullable().optional(),
      ifsc: z.string().max(20).nullable().optional(),
      swift: z.string().max(20).nullable().optional(),
      routingNumber: z.string().max(20).nullable().optional(),
      accountName: z.string().max(120).nullable().optional(),
    })
    .nullable()
    .optional(),
  sellerTaxId: z.string().max(30).nullable().optional(),
  placeOfSupply: z.string().max(60).nullable().optional(),
  paymentTerms: z.string().max(40).nullable().optional(),
  /** How sure your extractor is about each critical field (0-1). Defaults to 0.95. */
  confidence: z
    .object({
      vendorName: z.number().min(0).max(1).optional(),
      invoiceNumber: z.number().min(0).max(1).optional(),
      invoiceDate: z.number().min(0).max(1).optional(),
      total: z.number().min(0).max(1).optional(),
    })
    .optional(),
});
export type SubmitInput = z.infer<typeof submitSchema>;

export function toExtraction(i: SubmitInput): Extraction {
  const c = i.confidence ?? {};
  const extras: NonNullable<Extraction["extras"]> = [];
  if (i.sellerTaxId) extras.push({ key: "seller_gstin", label: "Seller tax id", value: i.sellerTaxId.replace(/\s/g, "").toUpperCase(), kind: "tax" });
  if (i.placeOfSupply) extras.push({ key: "place_of_supply", label: "Place of supply", value: i.placeOfSupply, kind: "text" });
  if (i.externalId) extras.push({ key: "external_id", label: "External id", value: i.externalId, kind: "id" });
  return {
    source: "api",
    documentKind: "supplier_invoice",
    vendorName: i.vendorName,
    vendorConfidence: c.vendorName ?? 0.95,
    invoiceNumber: i.invoiceNumber,
    invoiceNumberConfidence: i.invoiceNumber ? (c.invoiceNumber ?? 0.95) : 0.2,
    invoiceDate: i.invoiceDate,
    invoiceDateConfidence: i.invoiceDate ? (c.invoiceDate ?? 0.95) : 0.2,
    currency: i.currency,
    poNumbers: i.poNumbers.map((p) => p.trim().toUpperCase()),
    lineItems: i.lineItems.map((l, n) => ({
      id: `l${n + 1}`,
      description: l.description,
      quantity: l.quantity ?? null,
      unitPrice: l.unitPrice ?? null,
      amount: l.amount,
      taxIncluded: false,
      poNumber: l.poNumber ?? null,
    })),
    subtotal: i.subtotal ?? null,
    tax: i.tax ?? null,
    shipping: i.shipping ?? null,
    total: i.total,
    totalConfidence: i.total != null ? (c.total ?? 0.95) : 0.2,
    paymentTerms: i.paymentTerms ?? null,
    annotations: [],
    parties: [{ role: "seller", name: i.vendorName, taxId: i.sellerTaxId ?? null }],
    extras,
    slices: [],
    bankDetails: i.bankDetails ?? null,
    pageCount: 1,
    classification: { digitalPages: 1, scannedPages: 0, mixed: false },
    rawText: "",
  };
}

/* ------------------------------------------------------------------- output */

const ACTION: Record<string, string> = {
  auto_approve: "release",
  partial_approve: "release_partial",
  escalate: "hold",
  reject: "block",
};

export type InvoiceView = ReturnType<typeof view>;

function view(
  inv: typeof t.invoices.$inferSelect,
  dec: (typeof t.decisions.$inferSelect & { traceObj: PipelineTrace | null }) | null,
  origin: string,
) {
  const trace = dec?.traceObj ?? null;
  const final = dec?.final ?? null;
  return {
    id: inv.id,
    object: "invoice",
    status: !dec ? "processing" : dec.needsHuman && !final ? "needs_review" : "decided",
    externalId: inv.source === "api" ? inv.subject : null,
    invoiceNumber: inv.invoiceNumber,
    vendor: trace?.extraction.vendorName ?? null,
    invoiceDate: inv.invoiceDate,
    total: inv.total,
    currency: inv.currency,
    decision: dec
      ? {
          recommendation: dec.recommendation,
          action: ACTION[dec.recommendation] ?? dec.recommendation,
          final,
          finalAction: final ? (ACTION[final] ?? final) : null,
          needsHuman: dec.needsHuman && !final,
          confidence: dec.confidence,
          reasons: trace ? trace.rules.filter((r) => r.outcome !== "pass").map((r) => r.humanText) : [],
          checklist: trace?.decision.checklist ?? [],
          rules: trace ? trace.rules.map((r) => ({ id: r.ruleId, outcome: r.outcome, text: r.humanText })) : [],
          memo: trace?.decision.analystNote ?? null,
        }
      : null,
    payment: {
      dueDate: inv.dueDate ?? trace?.payment?.dueDate ?? null,
      discount: trace?.payment?.discount ?? null,
      payTo: trace?.payment?.payTo ?? null,
      paidAt: inv.paidAt?.toISOString() ?? null,
      paymentRef: inv.paymentRef,
    },
    caseUrl: `${origin}/cases/${inv.id}`,
    createdAt: inv.createdAt.toISOString(),
  };
}

function parseTrace(raw: string | undefined): PipelineTrace | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PipelineTrace;
  } catch {
    return null;
  }
}

export async function invoiceView(orgId: string, id: string, origin: string) {
  const db = getDb();
  const [inv] = await db.select().from(t.invoices).where(and(eq(t.invoices.orgId, orgId), eq(t.invoices.id, id)));
  if (!inv) return null;
  const [dec] = await db.select().from(t.decisions).where(and(eq(t.decisions.orgId, orgId), eq(t.decisions.invoiceId, id)));
  return view(inv, dec ? { ...dec, traceObj: parseTrace(dec.trace) } : null, origin);
}

export async function listInvoiceViews(orgId: string, origin: string, limit: number) {
  const db = getDb();
  const invs = await db
    .select()
    .from(t.invoices)
    .where(eq(t.invoices.orgId, orgId))
    .orderBy(desc(t.invoices.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  const decs = await db.select().from(t.decisions).where(eq(t.decisions.orgId, orgId));
  const byInvoice = new Map(decs.map((d) => [d.invoiceId, d]));
  return invs
    .filter((i) => !i.demoId?.startsWith("seed-"))
    .map((i) => {
      const d = byInvoice.get(i.id);
      return view(i, d ? { ...d, traceObj: parseTrace(d.trace) } : null, origin);
    });
}

/** The public origin for links in API responses. */
export function originOf(req: Request): string {
  const configured = process.env.AUTH_URL || process.env.APP_ORIGINS?.split(",")[0];
  if (configured) {
    try {
      return new URL(configured.trim()).origin;
    } catch {
      /* fall through */
    }
  }
  return new URL(req.url).origin;
}
