import { NextResponse } from "next/server";
import { imapConfigured, pollMailbox } from "@/lib/email/imap";
import { drainQueue } from "@/lib/queue/worker";
import { requireSignedIn } from "@/lib/auth/guard";

export async function POST() {
  const unauth = await requireSignedIn();
  if (unauth) return unauth;
  if (!imapConfigured()) {
    return NextResponse.json({ error: "IMAP_HOST / IMAP_USER / IMAP_PASSWORD not set" }, { status: 400 });
  }
  const polled = await pollMailbox();
  void drainQueue();
  return NextResponse.json(polled);
}
