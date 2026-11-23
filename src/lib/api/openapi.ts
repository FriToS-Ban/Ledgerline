/** OpenAPI 3.1 description of the agent API, served at /api/v1/openapi.json. */
export function openApiSpec(origin: string) {
  const decision = {
    type: "object",
    properties: {
      recommendation: { type: "string", enum: ["auto_approve", "partial_approve", "escalate", "reject"] },
      action: { type: "string", enum: ["release", "release_partial", "hold", "block"], description: "What to do with the money." },
      final: { type: ["string", "null"], description: "A person's decision, once someone resolved a held invoice." },
      finalAction: { type: ["string", "null"] },
      needsHuman: { type: "boolean", description: "True while the invoice is waiting for a person. Do not pay it." },
      confidence: { type: "number" },
      reasons: { type: "array", items: { type: "string" } },
      checklist: { type: "array", items: { type: "string" }, description: "What the reviewer must check." },
      rules: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, outcome: { type: "string", enum: ["pass", "warn", "fail"] }, text: { type: "string" } },
        },
      },
      memo: { type: ["string", "null"] },
    },
  };
  const invoice = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      object: { const: "invoice" },
      status: { type: "string", enum: ["processing", "needs_review", "decided"] },
      externalId: { type: ["string", "null"] },
      invoiceNumber: { type: ["string", "null"] },
      vendor: { type: ["string", "null"] },
      invoiceDate: { type: ["string", "null"], format: "date" },
      total: { type: ["number", "null"] },
      currency: { type: ["string", "null"] },
      decision: { oneOf: [decision, { type: "null" }] },
      payment: {
        type: "object",
        properties: {
          dueDate: { type: ["string", "null"], format: "date" },
          discount: { type: ["object", "null"], properties: { pct: { type: "number" }, byDate: { type: "string", format: "date" } } },
          payTo: { type: ["string", "null"], description: "Masked account the money would go to." },
          paidAt: { type: ["string", "null"], format: "date-time" },
          paymentRef: { type: ["string", "null"] },
        },
      },
      caseUrl: { type: "string", format: "uri", description: "Where a person reviews it." },
      createdAt: { type: "string", format: "date-time" },
    },
  };
  const submit = {
    type: "object",
    required: ["vendorName", "invoiceNumber", "invoiceDate", "total"],
    properties: {
      externalId: { type: "string", description: "Your id for this invoice; echoed back." },
      vendorName: { type: "string" },
      invoiceNumber: { type: ["string", "null"] },
      invoiceDate: { type: ["string", "null"], format: "date" },
      currency: { type: "string", default: "USD" },
      total: { type: ["number", "null"] },
      subtotal: { type: ["number", "null"] },
      tax: { type: ["number", "null"] },
      shipping: { type: ["number", "null"] },
      poNumbers: { type: "array", items: { type: "string" } },
      lineItems: {
        type: "array",
        items: {
          type: "object",
          required: ["description", "amount"],
          properties: {
            description: { type: "string" },
            amount: { type: "number" },
            quantity: { type: ["number", "null"] },
            unitPrice: { type: ["number", "null"] },
            poNumber: { type: ["string", "null"] },
          },
        },
      },
      bankDetails: {
        type: ["object", "null"],
        description: "Remittance details printed on the invoice. Compared with the verified vendor record.",
        properties: {
          accountNumber: { type: ["string", "null"] },
          iban: { type: ["string", "null"] },
          ifsc: { type: ["string", "null"] },
          swift: { type: ["string", "null"] },
          routingNumber: { type: ["string", "null"] },
          accountName: { type: ["string", "null"] },
        },
      },
      sellerTaxId: { type: ["string", "null"], description: "GSTIN (validated) or other tax id." },
      placeOfSupply: { type: ["string", "null"] },
      paymentTerms: { type: ["string", "null"], examples: ["Net 30", "2/10 Net 30"] },
      confidence: {
        type: "object",
        description: "Your extractor's confidence per critical field (0-1). Low values force human review.",
        properties: {
          vendorName: { type: "number" },
          invoiceNumber: { type: "number" },
          invoiceDate: { type: "number" },
          total: { type: "number" },
        },
      },
    },
  };
  const error = {
    type: "object",
    properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Ledgerline Guard API",
      version: "1.0.0",
      description:
        "Ask the payment guard before money moves. Submit an invoice (file or extracted fields) and get release / hold / block with reasons. API keys can submit and read; they can never release a payment. Webhooks (signed with HMAC-SHA256) report decisions and payments.",
    },
    servers: [{ url: origin }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Workspace API key (ll_live_…), created on the API page." } },
      schemas: { Invoice: invoice, Decision: decision, SubmitInvoice: submit, Error: error },
    },
    paths: {
      "/api/v1/invoices": {
        post: {
          summary: "Submit an invoice and get the guard's decision",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/SubmitInvoice" } },
              "multipart/form-data": {
                schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" }, externalId: { type: "string" } } },
              },
            },
          },
          responses: {
            "201": { description: "Decided", content: { "application/json": { schema: { $ref: "#/components/schemas/Invoice" } } } },
            "202": { description: "Accepted, still processing. Poll the Location header.", content: { "application/json": { schema: { $ref: "#/components/schemas/Invoice" } } } },
            "400": { description: "Invalid fields", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "401": { description: "Missing or revoked key" },
            "413": { description: "File over 15 MB" },
            "415": { description: "Not a PDF/image, or wrong content type" },
            "429": { description: "Rate limited (Retry-After header)" },
          },
        },
        get: {
          summary: "List recent invoices",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { object: { const: "list" }, data: { type: "array", items: { $ref: "#/components/schemas/Invoice" } } } } } } } },
        },
      },
      "/api/v1/invoices/{id}": {
        get: {
          summary: "Get one invoice's status and decision",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Invoice" } } } },
            "404": { description: "Not found in this workspace" },
          },
        },
      },
    },
    webhooks: {
      "invoice.decided": { post: { summary: "The guard decided an invoice", responses: { "2XX": { description: "Acknowledge" } } } },
      "invoice.resolved": { post: { summary: "A person resolved a held invoice", responses: { "2XX": { description: "Acknowledge" } } } },
      "payment_batch.created": { post: { summary: "A payment batch (bank file) was created", responses: { "2XX": { description: "Acknowledge" } } } },
      "payment_batch.paid": { post: { summary: "A payment batch was confirmed paid", responses: { "2XX": { description: "Acknowledge" } } } },
      "payment_batch.cancelled": { post: { summary: "A payment batch was cancelled", responses: { "2XX": { description: "Acknowledge" } } } },
    },
  };
}
