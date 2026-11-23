import { NextRequest, NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/auth/guard";
import { createWebhook, listWebhooks } from "@/lib/webhooks";

export async function GET() {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  return NextResponse.json(await listWebhooks(g.actor.orgId));
}

/** Registers an https endpoint. The signing secret is in this response only. */
export async function POST(req: NextRequest) {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  const body = (await req.json().catch(() => null)) as { url?: unknown; events?: unknown } | null;
  try {
    const w = await createWebhook({
      orgId: g.actor.orgId,
      url: String(body?.url ?? ""),
      events: Array.isArray(body?.events) ? body.events.map(String) : [],
      createdBy: g.actor.email,
    });
    return NextResponse.json(w, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "could not add webhook" }, { status: 400 });
  }
}
