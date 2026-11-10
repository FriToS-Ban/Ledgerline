import { NextResponse } from "next/server";
import { loadFridayInbox } from "@/lib/demo/friday";
import { denyUnless } from "@/lib/auth/guard";

/** Loads the vendor/PO book and queues ~30 invoices as emails. Processing is left to the worker. */
export async function POST() {
  const denied = await denyUnless(["admin"]);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
  return NextResponse.json(await loadFridayInbox());
}
