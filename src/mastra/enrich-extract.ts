import { z } from "zod";
import { extractAgent } from "./agents/specialists";
import { hasLlmKey } from "./model";
import type { Extraction, ExtraField, LineItem } from "@/lib/invoice/schema";
import { cleanPersonName } from "@/lib/extract/parse-text";

const enrichSchema = z.object({
  missingLines: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.number().nullable(),
        amount: z.number(),
      }),
    )
    .default([]),
  extras: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        value: z.string(),
      }),
    )
    .default([]),
  restaurantName: z.string().nullable().optional(),
});

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`extract timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Fill gaps from page text. Never overwrite a high-confidence total or invoice number. */
export async function enrichExtraction(extraction: Extraction): Promise<Extraction> {
  if (!hasLlmKey() || !extraction.rawText || extraction.source === "fixture") return extraction;
  const agent = extractAgent();
  const result = await withTimeout(
    agent.generate(
      `Here is invoice text. The engine already has:
vendor=${extraction.vendorName}
invoiceNumber=${extraction.invoiceNumber}
date=${extraction.invoiceDate}
total=${extraction.total}
currency=${extraction.currency}
lines=${extraction.lineItems.map((l) => l.description).join(" | ")}

Add ONLY missing line items and extra identifiers (GSTIN, HSN, FSSAI, customer, restaurant brand) that are clearly on the page. Do not invent. Do not change the total.

TEXT:
${extraction.rawText.slice(0, 8000)}`,
      { structuredOutput: { schema: enrichSchema } } as never,
    ),
    35_000,
  );
  const object = (result as { object?: z.infer<typeof enrichSchema> }).object;
  if (!object) return extraction;

  const existing = new Set(extraction.lineItems.map((l) => l.description.toLowerCase()));
  const extras: ExtraField[] = [...(extraction.extras ?? [])];
  const extraKeys = new Set(extras.map((e) => e.key));
  for (const e of object.extras ?? []) {
    if (!e.value || extraKeys.has(e.key)) continue;
    const isPerson = /customer|buyer|name/i.test(e.key) || /customer|name/i.test(e.label);
    const value = isPerson ? (cleanPersonName(e.value) ?? e.value) : e.value;
    extras.push({ key: e.key, label: e.label, value, kind: "text" });
    extraKeys.add(e.key);
  }
  extras.forEach((e) => {
    if (/customer|buyer/i.test(e.key) || /customer/i.test(e.label)) {
      e.value = cleanPersonName(e.value) ?? e.value;
    }
  });
  const lockedTotal = extraction.total;
  const lines: LineItem[] = [...extraction.lineItems];
  let i = lines.length;
  for (const l of object.missingLines ?? []) {
    if (!l.description || existing.has(l.description.toLowerCase())) continue;
    if (/platform fee/i.test(l.description)) continue;
    if (!Number.isFinite(l.amount)) continue;
    if (lockedTotal != null) {
      const before = lines.reduce((s, row) => s + row.amount, 0);
      const after = before + l.amount;
      if (Math.abs(after - lockedTotal) > Math.abs(before - lockedTotal) + 0.5) continue;
    }
    lines.push({
      id: `l${++i}`,
      description: l.description,
      quantity: l.quantity ?? 1,
      unitPrice: null,
      amount: l.amount,
      taxIncluded: extraction.currency === "INR",
    });
  }
  const annotations = [...(extraction.annotations ?? []), "gemini-enriched"];
  if (object.restaurantName && !extraction.vendorName.toLowerCase().includes(object.restaurantName.toLowerCase())) {
    extras.push({
      key: "trade_name",
      label: "Brand on the page",
      value: object.restaurantName,
      kind: "text",
    });
  }
  const customer =
    extras.find((e) => e.key === "customer" || e.key === "customerName")?.value ?? null;
  const parties = (extraction.parties ?? []).map((p) =>
    p.role === "buyer" && customer ? { ...p, name: customer } : p,
  );
  return { ...extraction, lineItems: lines, extras, annotations, parties };
}
