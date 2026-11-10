import { eq } from "drizzle-orm";
import { DEMO_USERS } from "../src/lib/auth/demo-users";
import { hashPassword } from "../src/lib/auth/session";
import { closeDb, getDb } from "../src/lib/db/client";
import { seedDatabase } from "../src/lib/db/seed";
import * as t from "../src/lib/db/schema";

const ORGS = [
  { name: "Zamp Demo", slug: "zamp-demo" },
  { name: "Acme Holdings", slug: "acme" },
];

/** Idempotent: safe to run any number of times. */
export async function seed() {
  const db = getDb();
  const orgIds: Record<string, string> = {};
  for (const o of ORGS) {
    await db.insert(t.organizations).values(o).onConflictDoNothing({ target: t.organizations.slug });
    const [row] = await db.select({ id: t.organizations.id }).from(t.organizations).where(eq(t.organizations.slug, o.slug));
    orgIds[o.slug] = row.id;
  }

  // The demo vendor / PO book lives in the Zamp Demo org only; Acme stays empty for isolation tests.
  await seedDatabase(orgIds["zamp-demo"]);

  const demo = process.env.DEMO_USERS === "1" || process.env.NODE_ENV !== "production";
  let users = 0;
  if (demo) {
    const password = process.env.DEMO_PASSWORD || "ledgerline";
    for (const u of DEMO_USERS) {
      await db
        .insert(t.users)
        .values({ email: u.email, name: u.name, role: u.role, passwordHash: await hashPassword(password), emailVerified: new Date() })
        .onConflictDoNothing({ target: t.users.email });
      const [row] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, u.email));
      await db
        .insert(t.memberships)
        .values({ orgId: orgIds[u.org], userId: row.id, role: u.membership })
        .onConflictDoNothing({ target: [t.memberships.orgId, t.memberships.userId] });
      users++;
    }
  }
  return { orgs: ORGS.length, demoUsers: users };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed.ts")) {
  seed()
    .then((r) => console.log("seeded", r))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
