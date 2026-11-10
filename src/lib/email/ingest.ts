import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { seedOrgDefaults } from "@/lib/db/seed";
import { saveUpload } from "@/lib/extract/save-upload";
import { sniffKind } from "@/lib/extract/parse-text";
import { enqueue } from "@/lib/queue/jobs";

export type IngestResult = {
  status: "ingested" | "duplicate" | "no-attachments";
  messageId: string;
  sender: string | null;
  subject: string | null;
  invoiceIds: string[];
};

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/**
 * Parse a raw RFC822 message, store each PDF/image attachment as an invoice and
 * enqueue it. Idempotent on Message-ID so IMAP re-polls and webhook retries are safe.
 */
export async function ingestRawEmail(
  orgId: string,
  raw: Buffer | Uint8Array,
  source: "webhook" | "imap" | "cli" = "webhook",
): Promise<IngestResult> {
  await seedOrgDefaults(orgId);
  const mail = await simpleParser(Buffer.from(raw));
  const sender = mail.from?.value[0]?.address ?? null;
  const subject = mail.subject ?? null;
  const messageId = mail.messageId ?? `generated-${randomUUID()}`;

  const db = getDb();
  const [seen] = await db
    .select()
    .from(t.emailMessages)
    .where(and(eq(t.emailMessages.orgId, orgId), eq(t.emailMessages.messageId, messageId)));
  if (seen) {
    return { status: "duplicate", messageId, sender, subject, invoiceIds: JSON.parse(seen.invoiceIds) };
  }

  const files = mail.attachments.filter((a) => {
    if (!a.content || a.content.length === 0 || a.content.length > MAX_ATTACHMENT_BYTES) return false;
    return sniffKind(a.filename ?? undefined, new Uint8Array(a.content)) !== "unknown";
  });

  const invoiceIds: string[] = [];
  for (const file of files) {
    const invoiceId = randomUUID();
    const bytes = new Uint8Array(file.content);
    const filename = file.filename ?? undefined;
    const pdfPath = saveUpload({ invoiceId, filename, bytes });
    await db.insert(t.invoices).values({
      orgId,
      id: invoiceId,
      status: "queued",
      runId: randomUUID(),
      pdfPath,
      source: "email",
      sender,
      subject,
      createdAt: new Date(),
    });
    await enqueue(orgId, "process-invoice", { invoiceId, filename });
    invoiceIds.push(invoiceId);
  }

  await db.insert(t.emailMessages).values({
      orgId,
    id: randomUUID(),
    messageId,
    sender,
    subject,
    receivedAt: new Date(),
    attachments: files.length,
    invoiceIds: JSON.stringify(invoiceIds),
    source,
    note: files.length ? null : "no PDF or image attachment found",
  });

  return {
    status: files.length ? "ingested" : "no-attachments",
    messageId,
    sender,
    subject,
    invoiceIds,
  };
}
