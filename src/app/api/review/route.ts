import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { seedDatabase } from "@/lib/db/seed";
import * as t from "@/lib/db/schema";
import { requireSignedIn } from "@/lib/auth/users";

export async function GET() {
  const unauth = await requireSignedIn();
  if (unauth) return unauth;
  await seedDatabase();
  const db = getDb();
  const invoices = await db.select().from(t.invoices).where(eq(t.invoices.status, "suspended"));
  const decisions = await db.select().from(t.decisions).orderBy(desc(t.decisions.createdAt));
  return NextResponse.json(
    invoices.map((inv) => ({
      invoice: inv,
      decision: decisions.find((d) => d.invoiceId === inv.id) ?? null,
    })),
  );
}
