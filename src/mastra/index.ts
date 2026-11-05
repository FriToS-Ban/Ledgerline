import { Mastra } from "@mastra/core/mastra";
import { invoiceDecisionWorkflow } from "./workflows/invoice-decision";
import { decideAgent, extractAgent, matchAgent, riskAgent } from "./agents/specialists";
import { hasLlmKey } from "./model";

/**
 * Studio / CLI only. Next.js routes must not import this file.
 * Live path: processCase → narrate.ts (Agent.generate only, no Mastra storage).
 */
export const mastra = new Mastra({
  // Without an LLM key there are no agents; the cast keeps the Studio config type-checking.
  agents: (hasLlmKey()
    ? {
        extractAgent: extractAgent(),
        matchAgent: matchAgent(),
        riskAgent: riskAgent(),
        decideAgent: decideAgent(),
      }
    : {}) as { extractAgent: ReturnType<typeof extractAgent>; matchAgent: ReturnType<typeof matchAgent>; riskAgent: ReturnType<typeof riskAgent>; decideAgent: ReturnType<typeof decideAgent> },
  workflows: { invoiceDecisionWorkflow },
});
