import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { loadFx, loadHistory, loadOpenPos } from "@/lib/domain";
import { remainingBalance } from "@/lib/invoice/match";
import { convertAmount, TableFxProvider } from "@/lib/invoice/fx";
import { DEFAULT_POLICY } from "@/lib/invoice/schema";

/** Tools only ever see one organization: the caller must put `orgId` in the request context. */
function orgOf(context: { requestContext?: { get(key: string): unknown } } | undefined): string {
  const orgId = context?.requestContext?.get("orgId");
  if (typeof orgId !== "string" || !orgId) throw new Error("tool called without an orgId in the request context");
  return orgId;
}

export const poLookupTool = createTool({
  id: "po-lookup",
  description: "Look up open purchase orders and remaining balances",
  inputSchema: z.object({ poNumber: z.string().optional(), vendorName: z.string().optional() }),
  outputSchema: z.array(
    z.object({
      number: z.string(),
      remaining: z.number(),
      status: z.string(),
      description: z.string(),
    }),
  ),
  execute: async ({ poNumber, vendorName }, context) => {
    const pos = await loadOpenPos(orgOf(context));
    return pos
      .filter((p) => {
        if (poNumber && p.number !== poNumber) return false;
        if (vendorName && !p.vendorName.toLowerCase().includes(vendorName.toLowerCase())) return false;
        return true;
      })
      .map((p) => ({
        number: p.number,
        remaining: remainingBalance(p),
        status: p.status,
        description: p.description,
      }));
  },
});

export const fxConvertTool = createTool({
  id: "fx-convert",
  description: "Convert an amount using dated seeded FX rates",
  inputSchema: z.object({
    amount: z.number(),
    from: z.string(),
    to: z.string(),
    onDate: z.string(),
  }),
  outputSchema: z.object({ amount: z.number(), pair: z.string(), missing: z.boolean(), stale: z.boolean() }),
  execute: async ({ amount, from, to, onDate }, context) => {
    const rates = await loadFx(orgOf(context));
    const r = convertAmount(amount, from, to, onDate, new TableFxProvider(rates), DEFAULT_POLICY);
    return { amount: r.amount, pair: r.fx.pair, missing: r.fx.missing, stale: r.fx.stale };
  },
});

export const duplicateScanTool = createTool({
  id: "duplicate-scan",
  description: "List historical invoices for duplicate checks",
  inputSchema: z.object({ vendorName: z.string() }),
  outputSchema: z.array(
    z.object({ invoiceNumber: z.string(), amount: z.number(), date: z.string().nullable() }),
  ),
  execute: async ({ vendorName }, context) => {
    const history = await loadHistory(orgOf(context));
    return history
      .filter((h) => h.vendorName.toLowerCase() === vendorName.toLowerCase())
      .map((h) => ({ invoiceNumber: h.invoiceNumber, amount: h.amount, date: h.date }));
  },
});
