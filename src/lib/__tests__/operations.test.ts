import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/master/csv";
import { detectKind } from "@/lib/master/import";

describe("csv", () => {
  it("handles quotes, commas, CRLF and BOM", () => {
    const rows = parseCsv('﻿Name,Legal Name\r\n"Acme, Inc.","Acme ""The"" Inc."\r\n');
    expect(rows).toEqual([{ name: "Acme, Inc.", legal_name: 'Acme "The" Inc.' }]);
  });
  it("detects file kinds", () => {
    expect(detectKind(parseCsv("name,approved\nA,yes"))).toBe("vendors");
    expect(detectKind(parseCsv("number,vendor,amount\nPO-1,A,5"))).toBe("pos");
    expect(detectKind(parseCsv("po_number,description,amount\nPO-1,x,5"))).toBe("po_lines");
  });
});

describe("queue / master / email (isolated temp cwd)", () => {
  const origCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ap-ops-"));

  beforeAll(() => {
    process.chdir(tmp);
  });
  afterAll(() => {
    process.chdir(origCwd);
  });

  it("retries with backoff, goes dead after max attempts, recovers stale leases", async () => {
    const jobs = await import("@/lib/queue/jobs");
    const { getDb } = await import("@/lib/db/client");
    const t = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    expect(jobs.backoffMs(1)).toBe(5_000);
    expect(jobs.backoffMs(2)).toBe(20_000);
    expect(jobs.backoffMs(10)).toBe(600_000);

    const id = await jobs.enqueue("process-invoice", { invoiceId: "x" }, { maxAttempts: 2 });
    const first = await jobs.claimNext();
    expect(first?.id).toBe(id);
    expect(first?.attempts).toBe(1);
    expect(await jobs.claimNext()).toBeNull(); // leased, not claimable twice

    expect(await jobs.failJob(first!, new Error("boom"))).toBe(false);
    expect(await jobs.claimNext()).toBeNull(); // backing off

    const db = getDb();
    await db.update(t.jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(t.jobs.id, id));
    const second = await jobs.claimNext();
    expect(second?.attempts).toBe(2);
    expect(await jobs.failJob(second!, new Error("boom again"))).toBe(true);
    const [row] = await db.select().from(t.jobs).where(eq(t.jobs.id, id));
    expect(row.status).toBe("dead");
    expect(row.lastError).toBe("boom again");

    // simulate a crash: job left "running" with an expired lease
    const crashed = await jobs.enqueue("process-invoice", { invoiceId: "y" });
    const c = await jobs.claimNext();
    expect(c?.id).toBe(crashed);
    await db.update(t.jobs).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(t.jobs.id, crashed));
    const recovered = await jobs.claimNext();
    expect(recovered?.id).toBe(crashed);
    await jobs.completeJob(crashed);
  });

  it("imports vendors, POs and lines from CSV, reporting bad rows", async () => {
    const { importMaster } = await import("@/lib/master/import");
    const { getDb } = await import("@/lib/db/client");
    const t = await import("@/lib/db/schema");
    const res = await importMaster(
      [
        { name: "vendors.csv", text: "name,approved,currency\nZed Corp,yes,USD\nBlocked Co,no,USD\n" },
        {
          name: "pos.csv",
          text: "number,vendor,amount,issue_date,description\nPO-9001,Zed Corp,\"1,250.50\",2026-10-01,Widgets\nPO-9002,Nobody,10,2026-10-01,x\nPO-9003,Zed Corp,abc,2026-10-01,x\n",
        },
        { name: "po_lines.csv", text: "po_number,description,amount\nPO-9001,Widgets,1250.50\nPO-0000,ghost,1\n" },
      ],
      "test",
    );
    expect(res).toMatchObject({ vendors: 2, pos: 1, poLines: 1 });
    expect(res.errors).toHaveLength(3);
    const db = getDb();
    const pos = await db.select().from(t.purchaseOrders);
    expect(pos.find((p) => p.number === "PO-9001")?.amount).toBe(1250.5);
    const vendors = await db.select().from(t.vendors);
    expect(vendors.find((v) => v.name === "Blocked Co")?.approved).toBe(false);

    // re-import is an update, not a duplicate
    await importMaster([{ name: "pos.csv", text: "number,vendor,amount\nPO-9001,Zed Corp,2000\n" }], "test");
    const after = (await db.select().from(t.purchaseOrders)).filter((p) => p.number === "PO-9001");
    expect(after).toHaveLength(1);
    expect(after[0].amount).toBe(2000);
  });

  it("ingests an email with a PDF attachment once, queues it, ignores duplicates", async () => {
    const { ingestRawEmail } = await import("@/lib/email/ingest");
    const { queueStats } = await import("@/lib/queue/jobs");
    const { getDb } = await import("@/lib/db/client");
    const t = await import("@/lib/db/schema");
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    const boundary = "BOUND";
    const eml = [
      "From: Billing <billing@vendor.test>",
      "To: ap@company.test",
      "Subject: Invoice INV-1",
      "Message-ID: <abc123@vendor.test>",
      `Content-Type: multipart/mixed; boundary=${boundary}`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain",
      "",
      "Please find attached.",
      `--${boundary}`,
      'Content-Type: application/pdf; name="inv.pdf"',
      'Content-Disposition: attachment; filename="inv.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      pdf.toString("base64"),
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const before = (await queueStats()).counts.queued;
    const r1 = await ingestRawEmail(Buffer.from(eml));
    expect(r1.status).toBe("ingested");
    expect(r1.sender).toBe("billing@vendor.test");
    expect(r1.invoiceIds).toHaveLength(1);
    const r2 = await ingestRawEmail(Buffer.from(eml));
    expect(r2.status).toBe("duplicate");
    expect((await queueStats()).counts.queued).toBe(before + 1);

    const [inv] = await getDb().select().from(t.invoices);
    expect(inv.source).toBe("email");

    const noAtt = await ingestRawEmail(
      Buffer.from("From: a@b.test\r\nSubject: hi\r\nMessage-ID: <n1@b.test>\r\n\r\nhello"),
    );
    expect(noAtt.status).toBe("no-attachments");
  });
});
