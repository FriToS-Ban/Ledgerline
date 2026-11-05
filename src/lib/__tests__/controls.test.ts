import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createToken, hashPassword, readToken, verifyPassword } from "@/lib/auth/session";

describe("sessions and passwords", () => {
  it("round-trips a signed session", () => {
    const t = createToken({ email: "a@b.c", name: "A", role: "approver" });
    expect(readToken(t)).toMatchObject({ email: "a@b.c", role: "approver" });
  });
  it("rejects a tampered role", () => {
    const t = createToken({ email: "a@b.c", name: "A", role: "clerk" });
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), role: "admin" })).toString("base64url");
    expect(readToken(`${forged}.${sig}`)).toBeNull();
    expect(readToken("garbage")).toBeNull();
    expect(readToken(undefined)).toBeNull();
  });
  it("rejects an expired session", () => {
    vi.useFakeTimers();
    const t = createToken({ email: "a@b.c", name: "A", role: "clerk" });
    vi.setSystemTime(Date.now() + 9 * 60 * 60 * 1000);
    expect(readToken(t)).toBeNull();
    vi.useRealTimers();
  });
  it("hashes passwords with a salt and verifies them", () => {
    const h = hashPassword("s3cret");
    expect(h).not.toContain("s3cret");
    expect(verifyPassword("s3cret", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
    expect(hashPassword("s3cret")).not.toBe(h);
  });
});

describe("ERP connector and approval limits (isolated temp cwd)", () => {
  const origCwd = process.cwd();
  beforeAll(() => process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "ap-erp-"))));
  afterAll(() => {
    process.chdir(origCwd);
    vi.unstubAllGlobals();
    delete process.env.ERP_URL;
  });

  it("imports vendors and POs from the ERP, with auth header, and skips bad rows", async () => {
    process.env.ERP_URL = "https://erp.example/api/book";
    process.env.ERP_TOKEN = "tok";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          vendors: [{ name: "Orbit Parts", approved: "yes", currency: "USD", paymentTerms: "Net 15" }],
          purchaseOrders: [
            { number: "PO-E1", vendor: "Orbit Parts", amount: 750, issueDate: "2026-10-30", description: "Gaskets" },
            { number: "PO-E2", vendor: "Ghost Co", amount: 10 },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { syncFromErp, syncErpIfDue } = await import("@/lib/master/erp");
    const res = await syncFromErp();
    expect(res).toMatchObject({ vendors: 1, pos: 1 });
    expect(res.errors.join(" ")).toContain("Ghost Co");
    const call = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(call[1].headers.authorization).toBe("Bearer tok");
    // just synced -> not due again
    expect(await syncErpIfDue()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces ERP outages instead of silently keeping stale data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const { syncFromErp } = await import("@/lib/master/erp");
    await expect(syncFromErp()).rejects.toThrow("503");
  });

  it("applies role approval limits from policy", async () => {
    const { seedDatabase } = await import("@/lib/db/seed");
    const { approvalLimit } = await import("@/lib/auth/users");
    await seedDatabase();
    expect(await approvalLimit("clerk")).toBe(5000);
    expect(await approvalLimit("approver")).toBe(100000);
    expect(await approvalLimit("admin")).toBe(Infinity);
  });
});
