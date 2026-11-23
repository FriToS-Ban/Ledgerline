import { NextRequest, NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/auth/guard";
import { createApiKey, listApiKeys } from "@/lib/api-keys";

export async function GET() {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  return NextResponse.json(await listApiKeys(g.actor.orgId));
}

/** Creates a key. The full key is in this response only; it is never shown again. */
export async function POST(req: NextRequest) {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  try {
    const k = await createApiKey({ orgId: g.actor.orgId, name: String(body?.name ?? ""), createdBy: g.actor.email });
    return NextResponse.json(k, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "could not create key" }, { status: 400 });
  }
}
