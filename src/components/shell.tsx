"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import { signOut as authSignOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { Flyers } from "@/components/scene";
import { safeNext } from "@/lib/auth/safe-next";
import { OrgSwitcher } from "@/components/org-switcher";

const NAV = [
  { href: "/", label: "Command" },
  { href: "/queue", label: "Invoices" },
  { href: "/review", label: "Needs a person" },
  { href: "/payments", label: "Payments" },
  { href: "/vendors", label: "Vendors" },
  { href: "/accuracy", label: "Accuracy" },
  { href: "/operations", label: "Sources" },
  { href: "/policy", label: "Guard rules" },
  { href: "/developers", label: "API" },
  { href: "/account", label: "Account" },
];

type Me = { name: string; email: string; role: string } | null;

function isActive(href: string, path: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

/** Pill nav with a neon indicator that slides to the active route. */
function PrimaryNav({ path }: { path: string }) {
  const list = useRef<HTMLUListElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const ul = list.current;
    const ind = indicator.current;
    if (!ul || !ind) return;
    const place = () => {
      const active = ul.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
      if (!active) {
        ind.style.opacity = "0";
        return;
      }
      // measure against the list itself (each <li> is its own offsetParent)
      const left = active.getBoundingClientRect().left - ul.getBoundingClientRect().left;
      ind.style.opacity = "1";
      ind.style.width = `${active.offsetWidth}px`;
      ind.style.transform = `translateX(${left}px)`;
      // keep the active pill visible in the horizontal scroller without scrolling the page
      const scroller = ul.parentElement;
      if (scroller && scroller.scrollWidth > scroller.clientWidth) {
        const target = left - (scroller.clientWidth - active.offsetWidth) / 2;
        scroller.scrollTo({ left: Math.max(0, target) });
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(ul);
    return () => ro.disconnect();
  }, [path]);

  return (
    <nav aria-label="Primary" className="nav-scroll order-3 -mx-1 w-full overflow-x-auto xl:order-2 xl:mx-0 xl:w-auto xl:min-w-0 xl:flex-1">
      <ul ref={list} className="relative flex w-max items-center gap-1 px-1 py-1 xl:mx-auto">
        <span
          ref={indicator}
          aria-hidden
          className="pointer-events-none absolute left-0 top-1 bottom-1 rounded-full border border-neon-blue/50 bg-neon-blue/15 opacity-0 shadow-[var(--glow-blue)] transition-[transform,width,opacity] duration-300 ease-out"
        >
          <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[image:var(--gradient-neon)]" />
        </span>
        {NAV.map((n) => {
          const active = isActive(n.href, path);
          return (
            <li key={n.href} className="relative">
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-[0.9375rem] xl:px-3 transition-colors",
                  active ? "font-medium text-foreground" : "text-text-mute hover:bg-muted hover:text-foreground",
                )}
              >
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  // pages that render their own chrome and must work signed out
  const isLogin = path === "/login" || path.startsWith("/invite/");

  useEffect(() => {
    if (isLogin) return;
    void fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        setMe(d.user ?? null);
        if (!d.user) {
          const here = window.location.pathname + window.location.search;
          router.replace(`/login?next=${encodeURIComponent(safeNext(here))}`);
        }
      })
      .catch(() => setMe(null));
  }, [path, isLogin, router]);

  async function signOut() {
    await authSignOut({ redirect: false });
    setMe(null);
    router.replace("/login");
    router.refresh();
  }

  const skip = (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
    >
      Skip to content
    </a>
  );

  if (isLogin) {
    return (
      <div className="relative min-h-screen">
        <Flyers variant="login" />
        {skip}
        <main id="main" className="relative z-10">
          {children}
        </main>
        <Toaster />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <Flyers variant="app" />
      {skip}
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
        <div className="glass mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl px-3 py-2 shadow-[0_10px_40px_-12px_var(--neon-violet)] xl:flex-nowrap xl:gap-x-3 xl:rounded-full xl:px-4">
          <Link href="/" aria-label="Ledgerline, home" className="order-1 flex min-h-11 items-center gap-2 rounded-full pr-2">
            <span className="grid size-8 place-items-center rounded-full bg-[image:var(--gradient-neon)] text-primary-foreground shadow-[var(--glow-violet)]">
              <ShieldCheck className="size-4.5" aria-hidden />
            </span>
            <span className="font-display neon-text text-xl leading-none tracking-wide">Ledgerline</span>
          </Link>
          <PrimaryNav path={path} />
          <div className="order-2 ml-auto flex items-center gap-2 text-sm xl:order-3 xl:ml-0">
            {me && (
              <>
                {!me.email.startsWith("auth-disabled") && <OrgSwitcher key={me.email} />}
                <span className="hidden max-w-[14rem] truncate text-text-mute sm:inline xl:sr-only" title={me.email}>
                  {me.name}
                </span>
                <span title={`${me.name} (${me.email})`} className="rounded-full border border-neon-violet/50 bg-neon-violet/15 px-2.5 py-0.5 font-mono text-xs uppercase tracking-wider text-violet-text">
                  {me.role}
                </span>
                {!me.email.startsWith("auth-disabled") && (
                  <button
                    onClick={() => void signOut()}
                    aria-label="Sign out"
                    className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2 text-text-mute sm:px-3 transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <LogOut className="size-4" aria-hidden />
                    <span className="hidden sm:inline xl:hidden">Sign out</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="relative z-10 mx-auto max-w-[1180px] px-5 py-8 sm:px-8">
        {children}
      </main>
      <Toaster />
    </div>
  );
}
