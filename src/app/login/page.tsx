"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FieldError, PasswordField } from "@/components/auth/password-field";
import { safeNext } from "@/lib/auth/safe-next";

const DEMO = [
  { email: "clerk@ledgerline.demo", role: "Clerk", blurb: "approves up to $5,000" },
  { email: "approver@ledgerline.demo", role: "Approver", blurb: "approves up to $100,000" },
  { email: "admin@ledgerline.demo", role: "Admin", blurb: "no limit, and manages the data" },
];

type Mode = "login" | "register";
type Fields = Partial<Record<"email" | "name" | "password" | "bootstrapToken", string>>;

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function AuthCard() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<Mode>(params.get("mode") === "register" ? "register" : "login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields>({});
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [lockMinutes, setLockMinutes] = useState(0);
  const [now, setNow] = useState(0);
  const errRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        setDemo(!!d.demoAccounts);
        if (d.user) router.replace(next);
      })
      .catch(() => {});
  }, [router, next]);

  useEffect(() => {
    if (!lockUntil) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= lockUntil) setLockUntil(null);
    }, 1000);
    return () => clearInterval(t);
  }, [lockUntil]);

  const remaining = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
  const locked = remaining > 0;

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setFields({});
    setPassword("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || locked) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      let data: { error?: string; fields?: Fields; retryAfterSeconds?: number } = {};
      let ok = false;
      if (mode === "login") {
        // Auth.js credentials sign-in. A lockout comes back as code "locked:<seconds>".
        const r = await signIn("credentials", { email, password, redirect: false });
        ok = !!r && !r.error;
        const m = /^locked:(\d+)$/.exec(r?.code ?? "");
        if (m) data = { retryAfterSeconds: Number(m[1]) };
        else if (!ok) data = { error: "Email or password is incorrect" };
      } else {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, name, password, ...(showToken && token ? { bootstrapToken: token } : {}) }),
        });
        ok = res.ok;
        data = await res.json().catch(() => ({}));
      }
      if (ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      if (typeof data.retryAfterSeconds === "number") {
        const n = Date.now();
        setNow(n);
        setLockUntil(n + data.retryAfterSeconds * 1000);
        setLockMinutes(Math.max(1, Math.ceil(data.retryAfterSeconds / 60)));
        setPassword("");
        requestAnimationFrame(() => errRef.current?.focus());
        return;
      }
      setFields(data.fields ?? {});
      setError(data.error ?? "Something went wrong. Please try again.");
      requestAnimationFrame(() => errRef.current?.focus());
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const register = mode === "register";

  return (
    <div className="mx-auto grid min-h-screen w-full max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-[1fr_28rem] lg:gap-16 lg:px-8">
      <div className="max-w-xl">
        <p className="font-display neon-text text-3xl tracking-wide">Ledgerline</p>
        <h1 className="font-display mt-8 text-4xl leading-[1.1] sm:text-5xl">Release, hold or block every payment.</h1>
        <p className="mt-5 max-w-[46ch] text-lg text-text-mute">
          Every invoice is read, matched to its purchase order and checked against your rules. You see the answer and the
          reasons, and a person signs off on anything unsure.
        </p>
      </div>

      <section aria-labelledby="auth-title" className="glass rounded-2xl p-6 shadow-[0_10px_50px_-12px_var(--neon-violet)] sm:p-8">
        <Tabs value={mode} onValueChange={(v) => switchMode(v as Mode)}>
          <TabsList className="grid h-11 w-full grid-cols-2" aria-label="Sign in or create an account">
            <TabsTrigger value="login">Sign in</TabsTrigger>
            <TabsTrigger value="register">Create account</TabsTrigger>
          </TabsList>
        </Tabs>
        <h2 id="auth-title" className="font-display mt-6 text-2xl">
          {register ? "Create your account" : "Welcome back"}
        </h2>
        <p className="mt-1 text-sm text-text-mute">
          {register ? "New accounts start as a clerk. An admin can change your role." : "Your role sets how much you can approve."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-5" aria-busy={busy}>
          {register && (
            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                autoComplete="name"
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={fields.name ? true : undefined}
                aria-describedby={fields.name ? "name-err" : undefined}
              />
              {fields.name && <FieldError id="name-err">{fields.name}</FieldError>}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              autoComplete={register ? "email" : "username"}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={fields.email ? true : undefined}
              aria-describedby={fields.email ? "email-err" : undefined}
            />
            {fields.email && <FieldError id="email-err">{fields.email}</FieldError>}
          </div>
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete={register ? "new-password" : "current-password"}
            error={fields.password}
            hint={register ? "At least 10 characters. Avoid common words and keyboard runs." : undefined}
            meter={register ? { email, name } : undefined}
          />
          {register && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowToken((s) => !s)}
                aria-expanded={showToken}
                className="min-h-11 rounded-md text-sm text-blue-text underline underline-offset-4 hover:text-foreground"
              >
                {showToken ? "Hide admin setup code" : "I have an admin setup code"}
              </button>
              {showToken && (
                <div className="space-y-2">
                  <Label htmlFor="token">Admin setup code</Label>
                  <Input
                    id="token"
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    aria-invalid={fields.bootstrapToken ? true : undefined}
                    aria-describedby={fields.bootstrapToken ? "token-err" : undefined}
                  />
                  {fields.bootstrapToken && <FieldError id="token-err">{fields.bootstrapToken}</FieldError>}
                </div>
              )}
            </div>
          )}

          <div ref={errRef} tabIndex={-1} className="outline-none">
            {locked ? (
              <Alert variant="destructive">
                <AlertDescription>
                  <p>
                    <span className="sr-only">Too many attempts. Try again in about {lockMinutes} minutes.</span>
                    <span aria-hidden>
                      Too many attempts. Try again in{" "}
                      <span className="font-mono font-semibold tabular-nums">{fmt(remaining)}</span>.
                    </span>
                  </p>
                </AlertDescription>
              </Alert>
            ) : error ? (
              <Alert variant="destructive">
                <AlertDescription>
                  <p>{error}</p>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <Button type="submit" className="w-full" disabled={busy || locked}>
            {busy && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
            {busy
              ? register
                ? "Creating account…"
                : "Signing in…"
              : locked
                ? `Try again in ${fmt(remaining)}`
                : register
                  ? "Create account"
                  : "Sign in"}
          </Button>
        </form>

        {demo && !register && (
          <div className="mt-8 border-t border-glass-border pt-5">
            <p className="text-sm font-medium">Demo accounts</p>
            <p className="text-sm text-text-mute">Password for all three: ledgerline</p>
            <ul className="mt-3 divide-y divide-glass-border border-y border-glass-border">
              {DEMO.map((d) => (
                <li key={d.email}>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(d.email);
                      setPassword("ledgerline");
                    }}
                    className="flex min-h-11 w-full items-baseline justify-between gap-4 px-1 py-2 text-left text-sm hover:bg-neon-blue/10"
                  >
                    <span className="font-medium">{d.role}</span>
                    <span className="text-text-mute">{d.blurb}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <AuthCard />
    </Suspense>
  );
}
