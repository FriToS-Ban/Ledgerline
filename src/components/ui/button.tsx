import * as React from "react";
import { cn } from "@/lib/utils";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "outline";
};

export function Button({ className, variant = "primary", ...props }: Props) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-45",
        variant === "primary" && "border-transparent bg-[image:var(--gradient-neon)] text-primary-foreground shadow-[var(--glow-blue)] hover:brightness-110 hover:shadow-[var(--glow-violet)]",
        variant === "outline" && "border-neon-blue/60 bg-glass text-foreground hover:bg-neon-blue/15 hover:shadow-[var(--glow-blue)]",
        variant === "ghost" && "border-transparent bg-transparent text-foreground underline-offset-4 hover:bg-accent hover:underline",
        variant === "danger" && "border-danger-text/50 bg-danger text-white hover:brightness-110",
        className,
      )}
      {...props}
    />
  );
}
