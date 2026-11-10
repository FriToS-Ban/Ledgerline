import { NextResponse } from "next/server";
import { imapConfigured, pollMailbox } from "@/lib/email/imap";
import { drainQueue } from "@/lib/queue/worker";
import { isServiceOrg } from "@/lib/db/org";
import { requireOrgRole } from "@/lib/auth/guard";

export async function POST() {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  if (!(await isServiceOrg(g.actor.orgId))) {
    return NextResponse.json({ error: "the mailbox is deployment-wide and only feeds the service organization (SERVICE_ORG_SLUG)" }, { status: 403 });
  }
  if (!imapConfigured()) {
    return NextResponse.json({ error: "IMAP_HOST / IMAP_USER / IMAP_PASSWORD not set" }, { status: 400 });
  }
  const polled = await pollMailbox(g.actor.orgId);
  void drainQueue(50, g.actor.orgId);
  return NextResponse.json(polled);
}
