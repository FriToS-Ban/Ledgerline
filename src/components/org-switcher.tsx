"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Building2, Check, ChevronDown, Loader2, Plus, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

type Org = { orgId: string; name: string; slug: string; role: string };

/** Active-workspace button in the header: lists the caller's workspaces, switches (server verifies membership), creates new ones. */
export function OrgSwitcher() {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const panelId = useId();

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/orgs", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d) {
            setOrgs(d.memberships);
            setActiveId(d.activeOrgId);
          }
        })
        .catch(() => {
          /* header stays without a switcher */
        });
    void load();
    // the settings page announces renames so the header label stays current
    window.addEventListener("workspace-changed", load);
    return () => {
      alive = false;
      window.removeEventListener("workspace-changed", load);
    };
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setCreating(false);
    setError(null);
    if (refocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (creating) nameInput.current?.focus();
  }, [creating]);

  if (!orgs || !activeId) return null;
  const active = orgs.find((o) => o.orgId === activeId);

  async function post(url: string, body: unknown, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return false;
      }
      // every page reads tenant data on load, so a full navigation is the simplest correct refresh
      // full reload on purpose: every page loads tenant data on mount
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  function create(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) void post("/api/orgs", { name }, "create");
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Workspace: ${active?.name ?? "unknown"}. Switch workspace`}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="flex min-h-11 max-w-[11rem] items-center gap-1.5 rounded-full border border-glass-border bg-glass px-3 text-sm transition-colors hover:bg-muted sm:max-w-[15rem]"
      >
        <Building2 className="size-4 shrink-0 text-blue-text" aria-hidden />
        <span className="truncate">{active?.name}</span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Workspaces"
          className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-glass-border bg-popover p-2 text-popover-foreground shadow-[var(--shadow-panel)]"
        >
          <ul className="max-h-64 overflow-y-auto">
            {orgs.map((o) => {
              const current = o.orgId === activeId;
              return (
                <li key={o.orgId}>
                  <button
                    type="button"
                    aria-current={current ? "true" : undefined}
                    disabled={busy !== null}
                    onClick={() => (current ? close() : void post("/api/orgs/switch", { orgId: o.orgId }, o.orgId))}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60",
                      current && "bg-neon-blue/10",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{o.name}</span>
                      <span className="block font-mono text-xs uppercase tracking-wider text-text-mute">{o.role}</span>
                    </span>
                    {busy === o.orgId ? (
                      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-label="Switching" />
                    ) : current ? (
                      <Check className="size-4 text-success-text" aria-label="Current workspace" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 border-t border-glass-border pt-1">
            <Link
              href="/settings/workspace"
              onClick={() => close(false)}
              className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Settings className="size-4" aria-hidden /> Workspace settings
            </Link>
            {!creating ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Plus className="size-4" aria-hidden /> Create workspace
              </button>
            ) : (
              <form onSubmit={create} className="space-y-2 px-1 pb-1 pt-2">
                <label htmlFor={`${panelId}-name`} className="text-sm text-text-mute">
                  Workspace name
                </label>
                <input
                  id={`${panelId}-name`}
                  ref={nameInput}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  required
                  autoComplete="off"
                  className="h-11 w-full rounded-md border border-input bg-void/60 px-3 text-base text-foreground focus-visible:border-ring focus-visible:shadow-[var(--glow-cyan)] focus-visible:outline-none md:text-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy !== null || !name.trim()}
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[image:var(--gradient-neon)] px-3 text-sm font-semibold text-primary-foreground disabled:opacity-45"
                  >
                    {busy === "create" && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setError(null);
                    }}
                    className="min-h-11 rounded-lg px-3 text-sm text-text-mute hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {error && (
              <p role="alert" className="px-3 pb-2 pt-1 text-sm text-danger-text">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
