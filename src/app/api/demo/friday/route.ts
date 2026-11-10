import { NextResponse } from "next/server";
import { loadFridayInbox } from "@/lib/demo/friday";
import { requireOrgRole } from "@/lib/auth/guard";

/** Loads the vendor/PO book and queues ~30 invoices as emails. Processing is left to the worker. */
export async function POST() {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  return NextResponse.json(await loadFridayInbox(g.actor.orgId));
}
