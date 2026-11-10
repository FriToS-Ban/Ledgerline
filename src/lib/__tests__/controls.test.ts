import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/hash";

describe("password hashing", () => {
  it("hashes passwords with a salt and verifies them", async () => {
    const h = await hashPassword("s3cret");
    expect(h).not.toContain("s3cret");
    expect(await verifyPassword("s3cret", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await hashPassword("s3cret")).not.toBe(h);
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
    const { makeOrg } = await import("@/test/orgs");
    const orgId = await makeOrg();
    const res = await syncFromErp(orgId);
    expect(res).toMatchObject({ vendors: 1, pos: 1 });
    expect(res.errors.join(" ")).toContain("Ghost Co");
    const call = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(call[1].headers.authorization).toBe("Bearer tok");
    // just synced -> not due again
    expect(await syncErpIfDue(orgId)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces ERP outages instead of silently keeping stale data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const { syncFromErp } = await import("@/lib/master/erp");
    const { makeOrg } = await import("@/test/orgs");
    await expect(syncFromErp(await makeOrg())).rejects.toThrow("503");
  });

  it("applies org-role approval limits from the org's own policy", async () => {
    const { seedDatabase } = await import("@/lib/db/seed");
    const { approvalLimit } = await import("@/lib/auth/users");
    const { makeOrg } = await import("@/test/orgs");
    const orgId = await makeOrg();
    await seedDatabase(orgId, { pdfs: false });
    expect(await approvalLimit(orgId, "member")).toBe(5000);
    expect(await approvalLimit(orgId, "admin")).toBe(100000);
    expect(await approvalLimit(orgId, "owner")).toBe(Infinity);
  });
});
