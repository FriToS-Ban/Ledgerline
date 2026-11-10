"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { signOut as authSignOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Preview = { orgName: string; email: string; role: string };
type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "ready"; invite: Preview; me: { email: string } | null };

const linkBtn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      fetch(`/api/invites/preview?token=${encodeURIComponent(token)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([p, m]) => {
        if (!alive) return;
        setState(p ? { kind: "ready", invite: p.invite, me: m.user ?? null } : { kind: "invalid" });
      })
      .catch(() => alive && setState({ kind: "invalid" }));
    return () => {
      alive = false;
    };
  }, [token]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // full reload on purpose: every page loads tenant data on mount
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/queue");
        return;
      }
      if (res.status === 404) setState({ kind: "invalid" });
      else setError(data.error ?? "Could not join the workspace.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function switchAccount() {
    await authSignOut({ redirect: false });
    window.location.reload();
  }

  const here = `/invite/${encodeURIComponent(token)}`;
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-5 py-10">
      <section aria-labelledby="invite-title" className="glass w-full rounded-2xl p-6 shadow-[0_10px_50px_-12px_var(--neon-violet)] sm:p-8">
        <p className="font-display neon-text flex items-center gap-2 text-2xl tracking-wide">
          <ShieldCheck className="size-6" aria-hidden /> Ledgerline
        </p>
        {state.kind === "loading" && (
          <p className="mt-6 flex items-center gap-2 text-text-mute" role="status">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Checking your invite…
          </p>
        )}
        {state.kind === "invalid" && (
          <>
            <h1 id="invite-title" className="font-display mt-6 text-2xl">
              Invite not valid
            </h1>
            <p className="mt-2 text-text-mute">
              This invite link is not valid, has expired, or was already used. Ask a workspace owner or admin to send a new one.
            </p>
            <Link href="/" className={`${linkBtn} mt-6 border-neon-blue/60 bg-glass hover:bg-neon-blue/15`}>
              Go to Ledgerline
            </Link>
          </>
        )}
        {state.kind === "ready" && (
          <>
            <h1 id="invite-title" className="font-display mt-6 text-2xl">
              Join {state.invite.orgName}
            </h1>
            <p className="mt-2 text-text-mute">
              You were invited as <span className="font-mono uppercase text-foreground">{state.invite.role}</span> using{" "}
              <span className="break-all text-foreground">{state.invite.email}</span>.
            </p>
            <div className="mt-6 space-y-3">
              {!state.me && (
                <>
                  <Link
                    href={`/login?mode=register&invite=${encodeURIComponent(token)}&next=/queue`}
                    className={`${linkBtn} w-full border-transparent bg-[image:var(--gradient-neon)] text-primary-foreground shadow-[var(--glow-blue)] hover:brightness-110`}
                  >
                    Create an account
                  </Link>
                  <Link
                    href={`/login?invite=${encodeURIComponent(token)}&next=${encodeURIComponent(here)}`}
                    className={`${linkBtn} w-full border-neon-blue/60 bg-glass hover:bg-neon-blue/15`}
                  >
                    I already have an account
                  </Link>
                </>
              )}
              {state.me && state.me.email.toLowerCase() === state.invite.email && (
                <Button className="w-full" onClick={() => void join()} disabled={busy}>
                  {busy && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
                  {busy ? "Joining…" : `Join ${state.invite.orgName}`}
                </Button>
              )}
              {state.me && state.me.email.toLowerCase() !== state.invite.email && (
                <>
                  <Alert variant="destructive">
                    <AlertDescription>
                      <p>
                        This invite was sent to a different email address. You are signed in as{" "}
                        <span className="break-all font-medium">{state.me.email}</span>. Sign in with the invited address to join.
                      </p>
                    </AlertDescription>
                  </Alert>
                  <Button variant="outline" className="w-full" onClick={() => void switchAccount()}>
                    Sign out and use another account
                  </Button>
                </>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <p role="alert">{error}</p>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
