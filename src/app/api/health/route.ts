import { query } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** Liveness + database reachability for the container healthcheck. Unauthenticated, reveals nothing else. */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    await query("select 1");
    return Response.json({ status: "ok" }, { headers });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
