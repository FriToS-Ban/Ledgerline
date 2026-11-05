"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";

const NAV = [
  { href: "/", label: "Friday" },
  { href: "/queue", label: "Invoices" },
  { href: "/review", label: "Needs a person" },
  { href: "/accuracy", label: "How often we're right" },
  { href: "/operations", label: "Sources" },
  { href: "/policy", label: "House rules" },
];

type Me = { name: string; email: string; role: string } | null;

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);

  useEffect(() => {
    if (path === "/login") return;
    void fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setMe(d.user ?? null))
      .catch(() => setMe(null));
  }, [path]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
    router.replace("/login");
    router.refresh();
  }

  if (path === "/login") {
    return (
      <>
        <main id="main">{children}</main>
        <Toaster />
      </>
    );
  }

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <header className="border-b-2 border-[#1F2A44] bg-[#FBFCFA]">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-end justify-between gap-x-8 gap-y-2 px-5 pt-4 sm:px-8">
          <Link href="/" className="pb-3" aria-label="Ledgerline, home">
            <span className="font-display block text-[1.7rem] font-semibold italic leading-none tracking-tight">Ledgerline</span>
          </Link>
          <div className="flex items-center gap-4 pb-3 text-sm text-[#4B5963]">
            {me && (
              <>
                <span>
                  {me.name}, <span className="text-[#1F2A44]">{me.role}</span>
                </span>
                {!me.email.startsWith("auth-disabled") && (
                  <button onClick={() => void signOut()} className="min-h-11 underline underline-offset-4 hover:text-[#1F2A44]">
                    Sign out
                  </button>
                )}
              </>
            )}
          </div>
          <nav aria-label="Primary" className="-mb-[2px] flex w-full gap-6 overflow-x-auto text-[0.9375rem]">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center whitespace-nowrap border-b-[3px] pb-1 pt-2",
                    active
                      ? "border-[#B3261E] font-medium text-[#1F2A44]"
                      : "border-transparent text-[#4B5963] hover:border-[#AEBBC6] hover:text-[#1F2A44]",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8">
        {children}
      </main>
      <Toaster />
    </div>
  );
}
