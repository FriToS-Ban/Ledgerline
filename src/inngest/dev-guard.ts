/** True when an unsigned, state-changing /api/inngest call must be refused (non-production only). */
export function inngestDevBlocked(
  method: string,
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.NODE_ENV === "production") return false; // the SDK enforces signatures with INNGEST_SIGNING_KEY
  if (method !== "POST" && method !== "PUT") return false;
  if (env.INNGEST_DEV === "1") return false;
  return !headers.get("x-inngest-signature");
}
