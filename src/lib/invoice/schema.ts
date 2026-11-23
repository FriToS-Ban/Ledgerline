import { z } from "zod";

export const decisionEnum = z.enum([
  "auto_approve",
  "partial_approve",
  "escalate",
  "reject",
]);
export type Decision = z.infer<typeof decisionEnum>;

export const fieldConfidenceSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  page: z.number().int().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

export const lineItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  quantity: z.number().nullable(),
  unitPrice: z.number().nullable(),
  amount: z.number(),
  taxIncluded: z.boolean().default(false),
  poNumber: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
});
export type LineItem = z.infer<typeof lineItemSchema>;

/** Dynamic facts that differ by country, marketplace, or document type. */
export const extraFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
  kind: z.enum(["text", "money", "date", "id", "tax"]).default("text"),
});
export type ExtraField = z.infer<typeof extraFieldSchema>;

export const partySchema = z.object({
  role: z.enum(["seller", "marketplace", "buyer", "ship_to"]),
  name: z.string(),
  taxId: z.string().nullable().optional(),
});
export type Party = z.infer<typeof partySchema>;

/** One PDF can wrap two bills (restaurant + platform fee). */
export const documentSliceSchema = z.object({
  title: z.string(),
  invoiceNumber: z.string().nullable(),
  total: z.number().nullable(),
  currency: z.string(),
  note: z.string().optional(),
});
export type DocumentSlice = z.infer<typeof documentSliceSchema>;

/** Remittance details printed on the invoice (compared with the verified vendor master). */
export const bankDetailsSchema = z.object({
  accountNumber: z.string().nullable().optional(),
  iban: z.string().nullable().optional(),
  ifsc: z.string().nullable().optional(),
  swift: z.string().nullable().optional(),
  routingNumber: z.string().nullable().optional(),
  accountName: z.string().nullable().optional(),
});

export const extractionSchema = z.object({
  source: z.enum(["fixture", "digital", "vision", "tesseract", "api"]),
  documentKind: z
    .enum(["supplier_invoice", "marketplace_invoice", "order_receipt", "mixed_pack", "unknown"])
    .optional(),
  vendorName: z.string(),
  vendorConfidence: z.number().min(0).max(1),
  invoiceNumber: z.string().nullable(),
  invoiceNumberConfidence: z.number().min(0).max(1),
  invoiceDate: z.string().nullable(),
  invoiceDateConfidence: z.number().min(0).max(1),
  currency: z.string().default("USD"),
  poNumbers: z.array(z.string()),
  lineItems: z.array(lineItemSchema),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  shipping: z.number().nullable(),
  total: z.number().nullable(),
  totalConfidence: z.number().min(0).max(1),
  paymentTerms: z.string().nullable().optional(),
  annotations: z.array(z.string()).default([]),
  parties: z.array(partySchema).optional(),
  extras: z.array(extraFieldSchema).optional(),
  slices: z.array(documentSliceSchema).optional(),
  bankDetails: bankDetailsSchema.nullable().optional(),
  pageCount: z.number().int().default(1),
  classification: z.object({
    digitalPages: z.number().int(),
    scannedPages: z.number().int(),
    mixed: z.boolean(),
  }),
  rawText: z.string().optional(),
});
export type Extraction = z.infer<typeof extractionSchema>;

export const fxUsedSchema = z.object({
  pair: z.string(),
  rate: z.number(),
  asOf: z.string(),
  source: z.enum(["seed", "provider", "identity"]),
  stale: z.boolean(),
  missing: z.boolean(),
});
export type FxUsed = z.infer<typeof fxUsedSchema>;

export const normalizedSchema = z.object({
  taxTreatment: z.enum(["exclusive", "inclusive", "unknown"]),
  shippingTreatment: z.enum(["separate", "embedded", "none"]),
  comparableAmount: z.number(),
  comparableCurrency: z.string(),
  originalTotal: z.number(),
  originalCurrency: z.string(),
  fx: fxUsedSchema.nullable(),
  lineComparable: z.array(
    z.object({
      id: z.string(),
      amount: z.number(),
      currency: z.string(),
    }),
  ),
  notes: z.array(z.string()),
});
export type Normalized = z.infer<typeof normalizedSchema>;

export const allocationSchema = z.object({
  poNumber: z.string(),
  poId: z.string(),
  lineIds: z.array(z.string()),
  allocatedAmount: z.number(),
  poAmount: z.number(),
  alreadyMatched: z.number(),
  remainingBefore: z.number(),
  remainingAfter: z.number(),
  variance: z.number(),
  withinTolerance: z.boolean(),
  status: decisionEnum,
  evidence: z.string(),
});
export type Allocation = z.infer<typeof allocationSchema>;

export const matchCandidateSchema = z.object({
  poNumber: z.string(),
  poId: z.string(),
  score: z.number(),
  method: z.enum(["explicit", "implied", "line", "multi"]),
  reasons: z.array(z.string()),
});
export type MatchCandidate = z.infer<typeof matchCandidateSchema>;

export const matchResultSchema = z.object({
  candidates: z.array(matchCandidateSchema),
  allocations: z.array(allocationSchema),
  primaryPoNumber: z.string().nullable(),
  method: z.enum(["explicit", "implied", "multi", "none"]),
});
export type MatchResult = z.infer<typeof matchResultSchema>;

export const firedRuleSchema = z.object({
  ruleId: z.string(),
  outcome: z.enum(["pass", "warn", "fail"]),
  evidence: z.record(z.string(), z.unknown()),
  humanText: z.string(),
});
export type FiredRule = z.infer<typeof firedRuleSchema>;

export const policySchema = z.object({
  amountTolerancePct: z.number(),
  amountToleranceAbs: z.number(),
  duplicateAmountPct: z.number(),
  confidenceFloor: z.number(),
  fxMaxAgeDays: z.number(),
  approvalThreshold: z.number(),
  impliedMatchAuto: z.number(),
  impliedMatchEscalate: z.number(),
  dateWindowDays: z.number(),
  duplicateDateWindowDays: z.number(),
  staleInvoiceDays: z.number(),
});
export type Policy = z.infer<typeof policySchema>;

export const DEFAULT_POLICY: Policy = {
  amountTolerancePct: 0.02,
  amountToleranceAbs: 50,
  duplicateAmountPct: 0.015,
  confidenceFloor: 0.7,
  fxMaxAgeDays: 7,
  approvalThreshold: 25_000,
  impliedMatchAuto: 0.85,
  impliedMatchEscalate: 0.55,
  dateWindowDays: 45,
  duplicateDateWindowDays: 14,
  staleInvoiceDays: 180,
};

export const duplicateHitSchema = z.object({
  invoiceNumber: z.string(),
  amount: z.number(),
  date: z.string().nullable(),
  similarity: z.number(),
  exactNumber: z.boolean(),
  near: z.boolean(),
});
export type DuplicateHit = z.infer<typeof duplicateHitSchema>;

export const decisionResultSchema = z.object({
  recommendation: decisionEnum,
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  needsHuman: z.boolean(),
  checklist: z.array(z.string()),
  criticalFieldGaps: z.array(z.string()),
  analystNote: z.string().optional(),
  analystModel: z.string().optional(),
  analystHeadline: z.string().optional(),
  analystSoWhat: z.string().optional(),
});
export type DecisionResult = z.infer<typeof decisionResultSchema>;

export const pipelineTraceSchema = z.object({
  extraction: extractionSchema,
  normalized: normalizedSchema,
  match: matchResultSchema,
  duplicates: z.array(duplicateHitSchema),
  rules: z.array(firedRuleSchema),
  decision: decisionResultSchema,
  /** When and where the money goes if released (absent on traces stored before payments existed). */
  payment: z
    .object({
      dueDate: z.string().nullable(),
      terms: z.string().nullable(),
      termsAssumed: z.boolean(),
      discount: z.object({ pct: z.number(), byDate: z.string() }).nullable(),
      payTo: z.string().nullable(),
    })
    .optional(),
});
export type PipelineTrace = z.infer<typeof pipelineTraceSchema>;
