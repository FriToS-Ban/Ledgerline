import * as React from "react";
import { cn } from "@/lib/utils";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "outline";
};

export function Button({ className, variant = "primary", ...props }: Props) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 border px-4 text-sm font-medium transition-colors disabled:opacity-45",
        variant === "primary" && "border-[#1F2A44] bg-[#1F2A44] text-[#FBFCFA] hover:bg-[#141C30]",
        variant === "outline" && "border-[#1F2A44] bg-transparent text-[#1F2A44] hover:bg-[#E6ECE3]",
        variant === "ghost" && "border-transparent bg-transparent text-[#1F2A44] underline-offset-4 hover:underline",
        variant === "danger" && "border-[#B3261E] bg-[#B3261E] text-[#FBFCFA] hover:bg-[#8F1D17]",
        className,
      )}
      {...props}
    />
  );
}
