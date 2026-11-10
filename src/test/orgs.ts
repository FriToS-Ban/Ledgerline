import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

/** A new organization in the current test database. */
export async function makeOrg(slug = `org-${randomUUID().slice(0, 8)}`) {
  const [row] = await getDb().insert(t.organizations).values({ name: slug, slug }).returning({ id: t.organizations.id });
  return row.id;
}

/** A user with a membership in `orgId`. */
export async function makeMember(orgId: string, orgRole: "owner" | "admin" | "member", email = `${randomUUID().slice(0, 8)}@test.io`) {
  const db = getDb();
  const [u] = await db.insert(t.users).values({ email, name: email.split("@")[0], role: "clerk" }).returning({ id: t.users.id });
  await db.insert(t.memberships).values({ orgId, userId: u.id, role: orgRole });
  return { userId: u.id, email, orgId, orgRole };
}
