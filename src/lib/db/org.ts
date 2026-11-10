import { eq } from "drizzle-orm";
import { databaseUrl, getDb } from "./client";
import { organizations } from "./schema";

export const DEFAULT_ORG = { name: "Zamp Demo", slug: "zamp-demo" } as const;

const cached = new Map<string, Promise<string>>();

/**
 * The org that owns data until request-scoped tenancy is wired in: the "zamp-demo" organization,
 * created on first use. Every tenant-table insert takes its org_id from here for now.
 */
export function defaultOrgId(): Promise<string> {
  const key = databaseUrl();
  let p = cached.get(key);
  if (!p) {
    p = (async () => {
      const db = getDb();
      await db.insert(organizations).values(DEFAULT_ORG).onConflictDoNothing({ target: organizations.slug });
      const [row] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, DEFAULT_ORG.slug));
      return row.id;
    })().catch((e) => {
      cached.delete(key);
      throw e;
    });
    cached.set(key, p);
  }
  return p;
}
