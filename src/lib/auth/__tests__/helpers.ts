import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, vi } from "vitest";

/** Runs the suite with cwd in a fresh temp dir, so data/app.db and data/auth.secret are throwaway. */
export function useTempCwd(prefix: string) {
  const orig = process.cwd();
  beforeAll(() => process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), prefix))));
  afterAll(() => {
    process.chdir(orig);
    vi.useRealTimers();
  });
}

/** Fake only Date, so libsql's real timers/promises keep working. */
export function freezeClock(at = Date.now()) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
  return {
    advance: (ms: number) => vi.setSystemTime(Date.now() + ms),
  };
}
