import { randomUUID } from "node:crypto";

export const MAX_FILENAME_LENGTH = 80;

/** Reduce a client-supplied filename to a safe leaf: no separators, no control chars, length-capped. */
export function sanitizeFilename(name: string | undefined | null): string {
  const leaf = (name ?? "").split(/[/\\]/).pop() ?? "";
  const cleaned = leaf
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .replace(/_+/g, "_");
  if (!cleaned) return "file";
  if (cleaned.length <= MAX_FILENAME_LENGTH) return cleaned;
  const ext = cleaned.match(/(\.[A-Za-z0-9]{1,8})$/)?.[1] ?? "";
  return cleaned.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
}

export function orgPrefix(orgId: string): string {
  return `org/${orgId}/`;
}

/** org/<orgId>/<uuid>-<sanitized-filename> */
export function buildKey(orgId: string, filename: string | undefined | null): string {
  return `${orgPrefix(orgId)}${randomUUID()}-${sanitizeFilename(filename)}`;
}

export function keyBelongsToOrg(key: string, orgId: string): boolean {
  return key.startsWith(orgPrefix(orgId)) && !key.includes("..") && !key.slice(orgPrefix(orgId).length).includes("/");
}
