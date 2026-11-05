import { NextResponse } from "next/server";
import { imapConfigured, pollMailbox } from "@/lib/email/imap";
import { drainQueue } from "@/lib/queue/worker";

export async function POST() {
  if (!imapConfigured()) {
    return NextResponse.json({ error: "IMAP_HOST / IMAP_USER / IMAP_PASSWORD not set" }, { status: 400 });
  }
  const polled = await pollMailbox();
  void drainQueue();
  return NextResponse.json(polled);
}
