import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/guard";
import { listVendors } from "@/lib/vendors";

export async function GET() {
  const g = await requireActor();
  if (g.deny) return g.deny;
  return NextResponse.json(await listVendors(g.actor.orgId));
}
