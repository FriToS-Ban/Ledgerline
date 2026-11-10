/** Legacy per-user role (users.role). Not used for authorization; org roles below are. */
export type Role = "clerk" | "approver" | "admin";
export const ORG_ROLES = ["owner", "admin", "member"] as const;
export const ROLES: Role[] = ["clerk", "approver", "admin"];
export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as string[]).includes(v);

/** AUTH_DISABLED=1 turns sign-in off (everyone is admin). Refused outright in production. */
export function authEnabled() {
  if (process.env.AUTH_DISABLED !== "1") return true;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_DISABLED=1 is not allowed in production");
  return false;
}

/** Dollar ceiling a role may approve without a more senior person. */
export const DEFAULT_LIMITS: Record<Role, number> = { clerk: 5_000, approver: 100_000, admin: Infinity };
