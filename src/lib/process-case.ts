import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { loadFx, loadHistory, loadOpenPos, loadPolicy, loadCorrections, situationFingerprint, vendorApproved } from "@/lib/domain";
import { runPipeline } from "@/lib/invoice/pipeline";
import { decisionEnum, type PipelineTrace } from "@/lib/invoice/schema";
import { extractInvoice } from "@/lib/pdf/extract";
import type { DemoId } from "@/lib/fixtures/cases";
import { DEMO_CASES } from "@/lib/fixtures/cases";

export type AuditEvent = {
  id: string;
  invoiceId: string;
  step: string;
  status: string;
  payload: unknown;
  at: Date;
};

/**
 * The AI memo and AI field-extraction are helpers, never gatekeepers: if a model is slow or down
 * (retries, 503s) we stop waiting and use the deterministic result, so one provider outage can't
 * stall the whole queue. Override with LLM_TIMEOUT_MS.
 */
function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  const ms = Number(process.env.LLM_TIMEOUT_MS ?? 12_000);
  let timer: NodeJS.Timeout;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  work.catch(() => {}); // a late failure after the timeout must not become an unhandled rejection
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

async function emit(
  orgId: string,
  invoiceId: string,
  step: string,
  status: string,
  payload: unknown,
) {
  const db = getDb();
  const row = {
    orgId,
    id: randomUUID(),
    invoiceId,
    step,
    status,
    payload: JSON.stringify(payload),
    at: new Date(),
  };
  await db.insert(t.auditEvents).values(row);
  return { ...row, payload };
}

export async function processCase(opts: {
  orgId: string;
  invoiceId: string;
  demoId?: DemoId;
  pdfBytes?: Uint8Array;
  filename?: string;
}): Promise<{ trace: PipelineTrace; needsHuman: boolean }> {
  const { invoiceId, orgId } = opts;
  const db0 = getDb();
  const [owned] = await db0
    .select({ id: t.invoices.id })
    .from(t.invoices)
    .where(and(eq(t.invoices.orgId, orgId), eq(t.invoices.id, invoiceId)));
  if (!owned) throw new Error(`invoice ${invoiceId} not found`);
  const existing = await db0
    .select()
    .from(t.decisions)
    .where(and(eq(t.decisions.orgId, orgId), eq(t.decisions.invoiceId, invoiceId)));
  if (existing[0]) {
    const trace = JSON.parse(existing[0].trace) as PipelineTrace;
    return { trace, needsHuman: existing[0].needsHuman && !existing[0].final };
  }
  await emit(orgId, invoiceId, "ingest", "running", { demoId: opts.demoId ?? null });

  let extraction = await extractInvoice({
    demoId: opts.demoId,
    pdfBytes: opts.pdfBytes,
    filename: opts.filename,
  });
  try {
    const { enrichExtraction } = await import("@/mastra/enrich-extract");
    const { hasLlmKey } = await import("@/mastra/model");
    if (hasLlmKey() && !opts.demoId) {
      await emit(orgId, invoiceId, "mastra-extract", "running", {});
      extraction = await withTimeout(enrichExtraction(extraction), "AI extraction");
      await emit(orgId, invoiceId, "mastra-extract", "success", {
        lines: extraction.lineItems.length,
        extras: (extraction.extras ?? []).length,
      });
    }
  } catch (err) {
    await emit(orgId, invoiceId, "mastra-extract", "fail", {
      error: err instanceof Error ? err.message : "enrich failed",
    });
  }
  await emit(orgId, invoiceId, "ingest", "success", {
    classification: extraction.classification,
    source: extraction.source,
  });
  await emit(orgId, invoiceId, "extract", "success", {
    vendorName: extraction.vendorName,
    invoiceNumber: extraction.invoiceNumber,
    total: extraction.total,
    currency: extraction.currency,
    poNumbers: extraction.poNumbers,
    confidences: {
      invoiceNumber: extraction.invoiceNumberConfidence,
      invoiceDate: extraction.invoiceDateConfidence,
      total: extraction.totalConfidence,
    },
  });

  const [policy, pos, history, fxRates, vendor] = await Promise.all([
    loadPolicy(orgId),
    loadOpenPos(orgId),
    loadHistory(orgId),
    loadFx(orgId),
    vendorApproved(orgId, extraction.vendorName),
  ]);

  await emit(orgId, invoiceId, "normalize", "running", {});
  const trace = runPipeline(extraction, {
    pos,
    history,
    fxRates,
    policy,
    vendorApproved: vendor.approved,
  });
  await emit(orgId, invoiceId, "normalize", "success", trace.normalized);
  await emit(orgId, invoiceId, "match", "success", trace.match);
  await emit(orgId, invoiceId, "rules", "success", { rules: trace.rules, duplicates: trace.duplicates });

  const fingerprint = situationFingerprint({
    vendor: extraction.vendorName,
    method: trace.match.method,
    rules: trace.rules.filter((r) => r.outcome === "fail").map((r) => r.ruleId),
  });
  const corrections = await loadCorrections(orgId, fingerprint);
  if (corrections.length) {
    trace.decision.explanation +=
      ` Similar prior override: humans chose ${corrections[0].human} instead of ${corrections[0].original}.`;
    await emit(orgId, invoiceId, "memory", "success", { corrections });
  }

  await emit(orgId, invoiceId, "decide", "success", trace.decision);

  try {
    const { narrateDecision, engineMemo } = await import("@/mastra/narrate");
    const { modelLabel, hasLlmKey } = await import("@/mastra/model");
    const fallback = engineMemo(trace);
    if (!hasLlmKey()) {
      trace.decision.analystNote = fallback.memo;
      trace.decision.analystModel = fallback.model;
      await emit(orgId, invoiceId, "mastra", "skipped", { reason: "no LLM key", used: "engine memo" });
    } else {
      await emit(orgId, invoiceId, "mastra", "running", { model: modelLabel() });
      try {
        const memo = await withTimeout(narrateDecision(trace), "AI memo");
        if (memo?.memo) {
          trace.decision.analystNote = memo.memo;
          trace.decision.analystModel = memo.model;
          trace.decision.analystHeadline = memo.headline;
          trace.decision.analystSoWhat = memo.soWhat;
          await emit(orgId, invoiceId, "mastra", "success", {
            model: memo.model,
            headline: memo.headline,
            memo: memo.memo,
          });
        } else {
          trace.decision.analystNote = fallback.memo;
          trace.decision.analystModel = fallback.model;
          await emit(orgId, invoiceId, "mastra", "skipped", { reason: "empty model output", used: "engine memo" });
        }
      } catch (err) {
        trace.decision.analystNote = fallback.memo;
        trace.decision.analystModel = fallback.model;
        await emit(orgId, invoiceId, "mastra", "fail", {
          error: err instanceof Error ? err.message : "mastra failed",
          used: "engine memo",
          model: modelLabel(),
        });
      }
    }
  } catch (err) {
    await emit(orgId, invoiceId, "mastra", "fail", {
      error: err instanceof Error ? err.message : "mastra failed",
    });
  }

  const db = getDb();
  await db.insert(t.decisions).values({
    orgId,
    id: randomUUID(),
    invoiceId,
    recommendation: trace.decision.recommendation,
    final: trace.decision.needsHuman ? null : trace.decision.recommendation,
    confidence: trace.decision.confidence,
    explanation: trace.decision.explanation,
    needsHuman: trace.decision.needsHuman,
    trace: JSON.stringify(trace),
    createdAt: new Date(),
  });

  if (extraction.lineItems.length) {
    await db.insert(t.invoiceLines).values(
      extraction.lineItems.map((l) => ({
        orgId,
        id: randomUUID(),
        invoiceId,
        description: l.description,
        amount: l.amount,
        poNumber: l.poNumber ?? null,
      })),
    );
  }

  if (!trace.decision.needsHuman) {
    for (const a of trace.match.allocations) {
      await db.insert(t.matches).values({
    orgId,
        id: randomUUID(),
        invoiceId,
        poId: a.poId,
        amount: a.allocatedAmount,
        method: trace.match.method,
        status: trace.decision.recommendation,
      });
    }
  }

  await db.insert(t.allocations).values({
    orgId,
    id: randomUUID(),
    invoiceId,
    payload: JSON.stringify(trace.match.allocations),
  });

  const status = trace.decision.needsHuman ? "suspended" : trace.decision.recommendation;
  await db
    .update(t.invoices)
    .set({
      vendorId: vendor.id,
      invoiceNumber: extraction.invoiceNumber,
      invoiceDate: extraction.invoiceDate,
      currency: extraction.currency,
      total: extraction.total,
      status,
    })
    .where(and(eq(t.invoices.orgId, orgId), eq(t.invoices.id, invoiceId)));

  if (trace.decision.needsHuman) {
    await emit(orgId, invoiceId, "review", "suspended", {
      proposed: trace.decision.recommendation,
      checklist: trace.decision.checklist,
      gaps: trace.decision.criticalFieldGaps,
    });
  } else {
    await emit(orgId, invoiceId, "persist", "success", { status });
  }

  return { trace, needsHuman: trace.decision.needsHuman };
}

/** The decision is missing, already finalized, or the requested outcome is invalid. */
export class ResumeError extends Error {
  constructor(
    public readonly kind: "not-found" | "already-final" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export async function resumeCase(opts: {
  orgId: string;
  invoiceId: string;
  action: "approve" | "reject" | "override";
  override?: string;
  note?: string;
  by?: string;
}) {
  const { orgId } = opts;
  if (opts.override !== undefined && !decisionEnum.safeParse(opts.override).success) {
    throw new ResumeError("invalid", "override must be one of auto_approve, partial_approve, escalate, reject");
  }
  return getDb().transaction(async (tx) => {
    const [decision] = await tx
      .select()
      .from(t.decisions)
      .where(and(eq(t.decisions.orgId, orgId), eq(t.decisions.invoiceId, opts.invoiceId)));
    if (!decision) throw new ResumeError("not-found", "No decision to resume");
    const trace = JSON.parse(decision.trace) as PipelineTrace;
    const human =
      opts.action === "reject"
        ? "reject"
        : opts.action === "override"
          ? (opts.override ?? "escalate")
          : opts.override ??
            (trace.decision.recommendation === "reject" ? "auto_approve" : trace.decision.recommendation);

    // Atomic claim: only the caller that flips final from NULL proceeds; repeats and races get a conflict.
    const claimed = await tx
      .update(t.decisions)
      .set({ final: human })
      .where(and(eq(t.decisions.orgId, orgId), eq(t.decisions.id, decision.id), isNull(t.decisions.final)))
      .returning({ id: t.decisions.id });
    if (claimed.length !== 1) throw new ResumeError("already-final", "This invoice has already been decided.");

    const fingerprint = situationFingerprint({
      vendor: trace.extraction.vendorName,
      method: trace.match.method,
      rules: trace.rules.filter((r) => r.outcome === "fail").map((r) => r.ruleId),
    });
    if (human !== decision.recommendation) {
      await tx.insert(t.decisionCorrections).values({
        orgId,
        id: randomUUID(),
        fingerprint,
        situation: `${trace.extraction.vendorName} ${trace.match.method}`,
        original: decision.recommendation,
        human,
        note: opts.note ?? null,
        createdAt: new Date(),
      });
    }
    if (human !== "reject") {
      for (const a of trace.match.allocations) {
        await tx.insert(t.matches).values({
          orgId,
          id: randomUUID(),
          invoiceId: opts.invoiceId,
          poId: a.poId,
          amount: a.allocatedAmount,
          method: trace.match.method,
          status: human,
        });
      }
    }
    await tx
      .update(t.invoices)
      .set({ status: human })
      .where(and(eq(t.invoices.orgId, orgId), eq(t.invoices.id, opts.invoiceId)));
    const at = new Date();
    await tx.insert(t.auditEvents).values([
      { orgId, id: randomUUID(), invoiceId: opts.invoiceId, step: "review", status: "success", payload: JSON.stringify({ human, note: opts.note ?? null, by: opts.by ?? null }), at },
      { orgId, id: randomUUID(), invoiceId: opts.invoiceId, step: "persist", status: "success", payload: JSON.stringify({ status: human }), at },
    ]);
    return { human };
  });
}

export async function createInvoiceRecord(opts: {
  orgId: string;
  id?: string;
  demoId?: DemoId;
  filename?: string;
  runId: string;
  pdfPath?: string | null;
}) {
  const db = getDb();
  const { orgId } = opts;
  const id = opts.id ?? randomUUID();
  const demo = DEMO_CASES.find((c) => c.id === opts.demoId);
  const pdfPath = opts.pdfPath ?? (demo ? `/demos/${demo.file}` : null);
  await db.insert(t.invoices).values({
    orgId,
    id,
    demoId: opts.demoId ?? null,
    vendorId: null,
    invoiceNumber: null,
    invoiceDate: null,
    currency: null,
    total: null,
    pdfPath,
    status: "running",
    runId: opts.runId,
    createdAt: new Date(),
  });
  return id;
}
