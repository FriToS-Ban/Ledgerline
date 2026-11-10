import { eq } from "drizzle-orm";
import { DEMO_ORGS } from "@/lib/auth/demo-users";
import { databaseUrl, getDb } from "./client";
import { organizations } from "./schema";

export const DEFAULT_ORG = DEMO_ORGS[0];

const cached = new Map<string, Promise<string>>();

/**
 * Seed, scripts and the AUTH_DISABLED dev actor only: the "zamp-demo" organization, created on
 * first use. No request path may call this; request code takes its org from the session actor.
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

export async function orgIdBySlug(slug: string): Promise<string | null> {
  const [row] = await getDb().select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug.trim().toLowerCase()));
  return row?.id ?? null;
}

const demoFallbackAllowed = () => process.env.NODE_ENV !== "production" || process.env.DEMO_USERS === "1";

/**
 * The org a machine caller (INTAKE_SECRET webhook, worker-side folder/ERP/mailbox sync) acts for.
 * `slug` is explicit (header or SERVICE_ORG_SLUG env); only demo / non-production deployments fall
 * back to zamp-demo. Returns null when nothing resolves, and callers must then refuse.
 */
export async function resolveServiceOrg(slug?: string | null): Promise<string | null> {
  const wanted = (slug ?? process.env.SERVICE_ORG_SLUG ?? "").trim();
  if (wanted) return orgIdBySlug(wanted);
  return demoFallbackAllowed() ? orgIdBySlug(DEFAULT_ORG.slug) : null;
}

/** True when `orgId` is the org the deployment-wide folder / ERP / mailbox connectors feed. */
export async function isServiceOrg(orgId: string): Promise<boolean> {
  return (await resolveServiceOrg()) === orgId;
}
