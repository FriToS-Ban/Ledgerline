import { ImapFlow } from "imapflow";
import { ingestRawEmail } from "./ingest";

export function imapConfigured() {
  return !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD);
}

let polling = false;

/**
 * Poll the invoices mailbox for unseen messages. Messages are only marked \Seen
 * after they are safely stored, so a crash mid-poll just re-reads them
 * (ingestRawEmail dedupes on Message-ID).
 */
export async function pollMailbox(orgId: string): Promise<{ fetched: number; ingested: number }> {
  if (polling) return { fetched: 0, ingested: 0 };
  polling = true;
  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: process.env.IMAP_SECURE !== "0",
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    logger: false,
  });
  let fetched = 0;
  let ingested = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(process.env.IMAP_FOLDER ?? "INBOX");
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      for (const uid of uids) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        fetched++;
        const result = await ingestRawEmail(orgId, msg.source, "imap");
        if (result.status === "ingested") ingested++;
        await client.messageFlagsAdd(String(uid), ["\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } finally {
    polling = false;
  }
  return { fetched, ingested };
}
