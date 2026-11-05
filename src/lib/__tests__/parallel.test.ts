import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

// Each fake job waits 300ms (like a model call). 8 jobs on 4 lanes should take ~600ms, not 2400ms.
vi.mock("@/lib/queue/handlers", () => ({ runJob: () => new Promise((r) => setTimeout(r, 300)) }));

const origCwd = process.cwd();
beforeAll(() => process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "ap-par-"))));
afterAll(() => process.chdir(origCwd));

it("runs jobs in parallel lanes", async () => {
  process.env.WORKER_CONCURRENCY = "4";
  const { enqueue } = await import("@/lib/queue/jobs");
  const { drainQueue } = await import("@/lib/queue/worker");
  for (let i = 0; i < 8; i++) await enqueue("process-invoice", { invoiceId: `x${i}` });
  const t0 = Date.now();
  const r = await drainQueue();
  const ms = Date.now() - t0;
  expect(r.ran).toBe(8);
  expect(ms).toBeLessThan(1500);
});
