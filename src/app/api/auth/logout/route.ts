import { NextRequest, NextResponse } from "next/server";
import { readJson } from "@/lib/auth/schemas";
import { COOKIE, readToken, sessionCookieOptions } from "@/lib/auth/session";
import { resolveSession, revokeSession, revokeUserSessions } from "@/lib/auth/sessions";

/**
 * POST /api/auth/logout            -> ends this session
 * POST /api/auth/logout {everywhere:true} -> ends every session of this user ("sign out everywhere")
 * Always clears the cookie and answers 200, even when the session was already gone.
 */
export async function POST(req: NextRequest) {
  const body = (await readJson(req)) as { everywhere?: unknown };
  const token = req.cookies.get(COOKIE)?.value;
  let revoked = 0;
  if (body?.everywhere === true) {
    const s = await resolveSession(token);
    if (s) revoked = await revokeUserSessions(s.email);
  } else {
    const sid = readToken(token)?.sid;
    if (sid) {
      await revokeSession(sid);
      revoked = 1;
    }
  }
  const res = NextResponse.json({ ok: true, revokedSessions: revoked });
  res.cookies.set(COOKIE, "", sessionCookieOptions(0)); // same flags/path as when set
  return res;
}
