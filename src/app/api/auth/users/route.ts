import { NextRequest, NextResponse } from "next/server";
import { readJson, roleChangeSchema, validationError } from "@/lib/auth/schemas";
import type { Role } from "@/lib/auth/roles";
import { denyUnless } from "@/lib/auth/guard";
import { changeRole, listUsers } from "@/lib/auth/users";

/** Admin only: every account with its role. */
export async function GET() {
  const denied = await denyUnless(["admin"]);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
  return NextResponse.json({ users: await listUsers() }, { headers: { "cache-control": "no-store" } });
}

/** Admin only: `{ email, role }` sets that user's role. Demoting the last admin is refused (409). */
export async function PATCH(req: NextRequest) {
  const denied = await denyUnless(["admin"]);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
  const parsed = roleChangeSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  const r = await changeRole(parsed.data.email, parsed.data.role as Role);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ user: r.user });
}
