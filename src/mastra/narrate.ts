import { z } from "zod";
import { decideAgent } from "./agents/specialists";
import { hasLlmKey, modelLabel } from "./model";
import { money } from "@/lib/utils";
import type { PipelineTrace } from "@/lib/invoice/schema";

export type AnalystMemo = {
  headline: string;
  soWhat: string;
  memo: string;
  bullets: string[];
  model: string;
};

const VERB: Record<string, string> = {
  auto_approve: "Release payment",
  partial_approve: "Release the matched amount",
  escalate: "Hold payment",
  reject: "Block payment",
};

const memoSchema = z.object({
  headline: z.string(),
  soWhat: z.string(),
  memo: z.string(),
  bullets: z.array(z.string()).max(5).optional(),
});

export function engineMemo(trace: PipelineTrace): AnalystMemo {
  const x = trace.extraction;
  const verb = VERB[trace.decision.recommendation] ?? trace.decision.recommendation;
  const amount = x.total != null ? money(x.total, x.currency) : "an unknown amount";
  const issues = trace.rules.filter((r) => r.outcome !== "pass").map((r) => r.humanText);
  const why = issues.length
    ? issues.slice(0, 3).join(" ")
    : "No policy issues fired; this can post as proposed.";
  return {
    headline: `${verb} ${amount}`,
    soWhat: why,
    memo: `${verb} ${amount} to ${x.vendorName}. ${why}`,
    bullets: issues.slice(0, 4),
    model: "engine",
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`mastra timed out after ${ms}ms`)), ms);
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

export async function narrateDecision(trace: PipelineTrace): Promise<AnalystMemo | null> {
  if (!hasLlmKey()) return null;
  const model = modelLabel() ?? "unknown";
  const agent = decideAgent();
  const locked = VERB[trace.decision.recommendation] ?? trace.decision.recommendation;
  const issues = trace.rules.filter((r) => r.outcome !== "pass").map((r) => r.humanText);
  const x = trace.extraction;
  const prompt = `Locked call (immutable): ${locked}.
Facts a partner can see — treat these as ground truth:
- Document kind: ${x.documentKind ?? "unknown"}
- Seller: ${x.vendorName}
- Invoice: ${x.invoiceNumber} on ${x.invoiceDate}
- Amount on page: ${x.total} ${x.currency}  (THIS IS ${x.currency}, NEVER call it USD or dollars unless FX actually converted)
- Book amount: ${trace.normalized.comparableAmount} ${trace.normalized.comparableCurrency}
- FX: ${trace.normalized.fx?.missing ? `NOT converted; do not write dollars` : `${trace.normalized.fx?.pair ?? "n/a"} @ ${trace.normalized.fx?.rate ?? ""}`}
- Order refs: ${x.poNumbers.join(", ") || "none"}
- Parties: ${(x.parties ?? []).map((p) => `${p.role} ${p.name}`).join("; ") || "n/a"}
- File contains: ${(x.slices ?? []).map((s) => `${s.title} ${s.total} ${s.currency}`).join(" + ") || "one bill"}
- Policy issues: ${issues.join(" | ") || "none"}

If this is a marketplace/restaurant bill, say it is an expense receipt, not a missing-PO supplier invoice. Do not invent a dollar amount. Do not claim rupees equal dollars.

Return structured output. Headline ≤ 8 words. soWhat is the one sentence they remember. Memo is 4–6 sentences.`;

  const result = await withTimeout(
    agent.generate(prompt, { structuredOutput: { schema: memoSchema } } as never),
    45_000,
  );
  const object = (result as { object?: z.infer<typeof memoSchema> }).object;
  const text = String((result as { text?: string }).text ?? "").trim();
  if (object?.memo) {
    return {
      headline: object.headline,
      soWhat: object.soWhat,
      memo: object.memo,
      bullets: object.bullets ?? issues.slice(0, 4),
      model,
    };
  }
  if (text) {
    return { headline: locked, soWhat: text.slice(0, 180), memo: text, bullets: issues.slice(0, 4), model };
  }
  return null;
}
