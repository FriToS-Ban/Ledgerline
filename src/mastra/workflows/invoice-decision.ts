import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { processCase, resumeCase } from "@/lib/process-case";
import { decisionEnum } from "@/lib/invoice/schema";

const inputSchema = z.object({
  orgId: z.string(),
  invoiceId: z.string(),
  demoId: z.string().optional(),
  filename: z.string().optional(),
});

const ingest = createStep({
  id: "ingest-classify",
  inputSchema,
  outputSchema: inputSchema,
  execute: async ({ inputData }) => inputData,
});

const run = createStep({
  id: "extract-to-decision",
  inputSchema,
  outputSchema: z.object({
    invoiceId: z.string(),
    needsHuman: z.boolean(),
    recommendation: decisionEnum,
  }),
  suspendSchema: z.object({
    invoiceId: z.string(),
    proposed: z.string(),
    checklist: z.array(z.string()),
  }),
  resumeSchema: z.object({
    action: z.enum(["approve", "reject", "override"]),
    override: z.string().optional(),
    note: z.string().optional(),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (resumeData) {
      const r = await resumeCase({
        orgId: inputData.orgId,
        invoiceId: inputData.invoiceId,
        action: resumeData.action,
        override: resumeData.override,
        note: resumeData.note,
      });
      return {
        invoiceId: inputData.invoiceId,
        needsHuman: false,
        recommendation: r.human as never,
      };
    }
    const { trace, needsHuman } = await processCase({
      orgId: inputData.orgId,
      invoiceId: inputData.invoiceId,
      demoId: inputData.demoId as never,
      filename: inputData.filename,
    });
    if (needsHuman) {
      return await suspend({
        invoiceId: inputData.invoiceId,
        proposed: trace.decision.recommendation,
        checklist: trace.decision.checklist,
      });
    }
    return {
      invoiceId: inputData.invoiceId,
      needsHuman: false,
      recommendation: trace.decision.recommendation,
    };
  },
});

export const invoiceDecisionWorkflow = createWorkflow({
  id: "invoice-decision",
  inputSchema,
  outputSchema: z.object({
    invoiceId: z.string(),
    needsHuman: z.boolean(),
    recommendation: decisionEnum,
  }),
})
  .then(ingest)
  .then(run)
  .commit();
