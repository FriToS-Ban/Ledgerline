import { inngest } from "./client";
import { resumeCase } from "@/lib/process-case";
import { processInvoiceJob } from "@/lib/queue/handlers";
import type { DemoId } from "@/lib/fixtures/cases";

export const processInvoiceFn = inngest.createFunction(
  { id: "invoice-process", retries: 1, triggers: [{ event: "invoice/process" }] },
  async ({ event, step }) => {
    const data = event.data as {
      orgId: string;
      invoiceId: string;
      demoId?: DemoId;
      filename?: string;
    };
    if (!data.orgId) throw new Error("invoice/process event is missing orgId");
    return step.run("pipeline", async () => processInvoiceJob(data));
  },
);

export const resumeInvoiceFn = inngest.createFunction(
  { id: "invoice-resume", retries: 1, triggers: [{ event: "invoice/resume" }] },
  async ({ event, step }) => {
    const data = event.data as {
      orgId: string;
      invoiceId: string;
      action: "approve" | "reject" | "override";
      override?: string;
      note?: string;
    };
    if (!data.orgId) throw new Error("invoice/resume event is missing orgId");
    return step.run("resume", async () => resumeCase(data));
  },
);

export const inngestFunctions = [processInvoiceFn, resumeInvoiceFn];
