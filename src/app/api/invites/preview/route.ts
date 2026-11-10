import { NextRequest, NextResponse } from "next/server";
import { INVALID_INVITE, previewInvite } from "@/lib/auth/orgs";

/** Open route for the accept page: org name, invited email and role for a valid token; a generic 404 for anything else. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const p = token.length >= 20 && token.length <= 200 ? await previewInvite(token) : null;
  if (!p) return NextResponse.json({ error: INVALID_INVITE }, { status: 404, headers: { "cache-control": "no-store" } });
  return NextResponse.json({ invite: p }, { headers: { "cache-control": "no-store" } });
}
