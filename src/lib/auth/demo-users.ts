import type { Role } from "./session";

export const DEMO_DOMAIN = "@ledgerline.demo";

/** Demo accounts. `org` + `membership` say where the seed script places them. */
export const DEMO_USERS: {
  email: string;
  name: string;
  role: Role;
  org: "zamp-demo" | "acme";
  membership: "owner" | "admin" | "member";
}[] = [
  { email: `admin${DEMO_DOMAIN}`, name: "Alex Admin", role: "admin", org: "zamp-demo", membership: "owner" },
  { email: `approver${DEMO_DOMAIN}`, name: "Avery Approver", role: "approver", org: "zamp-demo", membership: "admin" },
  { email: `clerk${DEMO_DOMAIN}`, name: "Casey Clerk", role: "clerk", org: "zamp-demo", membership: "member" },
  { email: `acme-owner${DEMO_DOMAIN}`, name: "Morgan Acme", role: "admin", org: "acme", membership: "owner" },
  { email: `acme-clerk${DEMO_DOMAIN}`, name: "Sam Acme", role: "clerk", org: "acme", membership: "member" },
];
