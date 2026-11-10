"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordProblem } from "@/lib/auth/passwords";
import { cn } from "@/lib/utils";

/** 0 = empty, 1 = rejected by the rules, 2 = fair, 3 = good, 4 = strong. */
export function passwordScore(pw: string, ctx: { email?: string; name?: string } = {}) {
  if (!pw) return { score: 0, label: "", problem: null as string | null };
  const problem = passwordProblem(pw, ctx);
  if (problem) return { score: 1, label: pw.length < 10 ? "Too short" : "Not allowed", problem };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const bonus = (pw.length >= 14 ? 1 : 0) + (pw.length >= 20 ? 1 : 0) + (classes >= 3 ? 1 : 0);
  const score = Math.min(4, 2 + (bonus >= 2 ? 2 : bonus >= 1 ? 1 : 0));
  return { score, label: ["", "", "Fair", "Good", "Strong"][score], problem: null };
}

const BAR = ["", "bg-danger-text", "bg-warning-text", "bg-neon-cyan", "bg-success-text"];
const TEXT = ["", "text-danger-text", "text-warning-text", "text-blue-text", "text-success-text"];

export function StrengthMeter({ password, email, name }: { password: string; email?: string; name?: string }) {
  const { score, label, problem } = passwordScore(password, { email, name });
  return (
    <div aria-live="polite" className={cn("space-y-1.5", !password && "hidden")}>
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-full bg-neon-blue/15", i <= score && BAR[score])} />
        ))}
      </div>
      <p className={cn("text-sm", TEXT[score])}>
        <span className="font-medium">Password strength: {label}.</span>
        {problem && <span className="text-text-mute"> {problem}</span>}
      </p>
    </div>
  );
}

type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  error?: string | null;
  hint?: string;
  meter?: { email?: string; name?: string };
  name?: string;
};

/** Labelled password input with a show/hide toggle, inline error and optional strength meter. */
export function PasswordField({ label, value, onChange, autoComplete, error, hint, meter, name }: Props) {
  const id = useId();
  const [show, setShow] = useState(false);
  const describedBy = [error ? `${id}-err` : null, hint && !error ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="pr-12"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={show}
          className="absolute right-0 top-0 grid size-11 place-items-center rounded-md text-text-mute transition-colors hover:text-foreground"
        >
          {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-text-mute">
          {hint}
        </p>
      )}
      {error && <FieldError id={`${id}-err`}>{error}</FieldError>}
      {meter && <StrengthMeter password={value} {...meter} />}
    </div>
  );
}

export function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-sm text-danger-text">
      {children}
    </p>
  );
}
