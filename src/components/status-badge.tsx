import { cn } from "@/lib/utils";

type Kind = "paid" | "part" | "hold" | "void" | "wait";

const KIND: Record<string, Kind> = {
  auto_approve: "paid",
  approved: "paid",
  Pay: "paid",
  "Release payment": "paid",
  "Release the matched amount": "part",
  pass: "paid",
  success: "paid",
  partial_approve: "part",
  running: "wait",
  queued: "wait",
  escalate: "hold",
  Hold: "hold",
  "Hold payment": "hold",
  "Block payment": "void",
  suspended: "hold",
  warn: "hold",
  reject: "void",
  rejected: "void",
  fail: "void",
};

const LABEL: Record<string, string> = {
  auto_approve: "Release",
  approved: "Paid",
  partial_approve: "Release part",
  escalate: "Hold",
  suspended: "Needs a person",
  reject: "Block",
  rejected: "Block",
  running: "Reading",
  queued: "Waiting",
  pass: "Clear",
  warn: "Watch",
  fail: "Issue",
  success: "Done",
};

// A small fixed tilt per value so a column of stamps looks hand-pressed, not machine-aligned.
const TILT = [-2, 1.5, -1, 2, -1.5, 1];
const tiltFor = (v: string) => TILT[[...v].reduce((a, c) => a + c.charCodeAt(0), 0) % TILT.length];

/** A rubber-stamp mark for a decision or status. `big` is the large stamp used on a case. */
export function StatusBadge({ value, big }: { value: string | null | undefined; big?: boolean }) {
  if (!value) return null;
  return (
    <span
      className={cn("stamp", KIND[value] ?? "wait", big && "big")}
      style={big ? undefined : ({ "--tilt": `${tiltFor(value)}deg` } as React.CSSProperties)}
    >
      {LABEL[value] ?? value.replaceAll("_", " ")}
    </span>
  );
}
