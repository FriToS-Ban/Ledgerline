import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { seedDatabase } from "@/lib/db/seed";
import * as t from "@/lib/db/schema";
import { denyUnless } from "@/lib/auth/users";

export async function GET() {
  await seedDatabase();
  const db = getDb();
  const rows = await db.select().from(t.policyRules);
  return NextResponse.json(rows);
}

export async function PUT(req: NextRequest) {
  const denied = await denyUnless(["admin"]);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
  const body = (await req.json()) as { key: string; value: string };
  const db = getDb();
  await db.update(t.policyRules).set({ value: body.value }).where(eq(t.policyRules.key, body.key));
  return NextResponse.json({ ok: true });
}
