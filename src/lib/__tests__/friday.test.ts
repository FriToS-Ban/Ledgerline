import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Friday inbox end to end (isolated temp cwd)", () => {
  const origCwd = process.cwd();
  beforeAll(() => {
    process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "ap-fri-")));
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.NVIDIA_API_KEY;
  });
  afterAll(() => process.chdir(origCwd));

  it("loads, processes everything, and scores it", async () => {
    const { loadFridayInbox } = await import("@/lib/demo/friday");
    const { drainQueue } = await import("@/lib/queue/worker");
    const { computeAccuracy } = await import("@/lib/accuracy");
    const { computeMetrics } = await import("@/lib/metrics");

    const loaded = await loadFridayInbox();
    expect(loaded.invoices).toBeGreaterThanOrEqual(28);
    expect((await loadFridayInbox()).alreadyLoaded).toBe(true);

    const r = await drainQueue(100);
    expect(r.ran).toBeGreaterThanOrEqual(28);

    const acc = await computeAccuracy();
    console.log(JSON.stringify({ ...acc, misses: acc.misses }, null, 1));
    const m = await computeMetrics();
    console.log(JSON.stringify(m, null, 1));

    expect(acc.pending).toBe(0);
    // The headline safety property: nothing that should be held is paid.
    expect(acc.wronglyPaid).toBe(0);
    expect(m.duplicatesCaught).toBeGreaterThanOrEqual(2);
  }, 240_000);
});
