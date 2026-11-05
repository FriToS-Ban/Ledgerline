import { inngest } from "./client";
import { resumeCase } from "@/lib/process-case";
import { processInvoiceJob } from "@/lib/queue/handlers";
import type { DemoId } from "@/lib/fixtures/cases";

export const processInvoiceFn = inngest.createFunction(
  { id: "invoice-process", retries: 1, triggers: [{ event: "invoice/process" }] },
  async ({ event, step }) => {
    const data = event.data as {
      invoiceId: string;
      demoId?: DemoId;
      filename?: string;
    };
    return step.run("pipeline", async () => processInvoiceJob(data));
  },
);

export const resumeInvoiceFn = inngest.createFunction(
  { id: "invoice-resume", retries: 1, triggers: [{ event: "invoice/resume" }] },
  async ({ event, step }) => {
    const data = event.data as {
      invoiceId: string;
      action: "approve" | "reject" | "override";
      override?: string;
      note?: string;
    };
    return step.run("resume", async () => resumeCase(data));
  },
);

export const inngestFunctions = [processInvoiceFn, resumeInvoiceFn];
