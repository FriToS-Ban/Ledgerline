/**
 * Policy keys an org may edit, with validation. Money / control keys are owner-only: an admin who
 * could raise their own approval limit (or neutralize it) would defeat the segregation of duties.
 */
export const OWNER_ONLY_POLICY_KEYS = new Set([
  "clerkLimit",
  "approverLimit",
  "approvalThreshold",
  "amountTolerancePct",
  "amountToleranceAbs",
]);

/** value ceiling per numeric key (all are finite numbers >= 0). */
const FRACTION_KEYS = new Set(["amountTolerancePct", "duplicateAmountPct", "confidenceFloor", "impliedMatchAuto", "impliedMatchEscalate"]);
const NUMERIC_KEYS = new Set([
  ...OWNER_ONLY_POLICY_KEYS,
  "duplicateAmountPct",
  "confidenceFloor",
  "fxMaxAgeDays",
  "impliedMatchAuto",
  "impliedMatchEscalate",
  "dateWindowDays",
  "duplicateDateWindowDays",
  "staleInvoiceDays",
]);

export const isKnownPolicyKey = (k: unknown): k is string => typeof k === "string" && NUMERIC_KEYS.has(k);

/** Returns the canonical string value, or an error message. */
export function validatePolicyValue(key: string, raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (!isKnownPolicyKey(key)) return { ok: false, error: `unknown policy key: ${String(key).slice(0, 40)}` };
  if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, error: "value must be a number" };
  const s = String(raw).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: "value must be a finite number >= 0" };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "value must be a finite number >= 0" };
  if (FRACTION_KEYS.has(key) && n > 1) return { ok: false, error: "value must be between 0 and 1" };
  return { ok: true, value: String(n) };
}
