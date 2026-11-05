"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEMO = [
  { email: "clerk@ledgerline.demo", role: "Clerk", blurb: "approves up to $5,000" },
  { email: "approver@ledgerline.demo", role: "Approver", blurb: "approves up to $100,000" },
  { email: "admin@ledgerline.demo", role: "Admin", blurb: "no limit, and manages the data" },
];

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setDemo(!!d.demoAccounts))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Could not sign in. Check your email and password.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_28rem]">
      <div className="flex flex-col justify-end border-b-2 border-[#1F2A44] bg-[#FBFCFA] px-8 pb-12 pt-16 lg:border-b-0 lg:border-r-2">
        <p className="font-display text-[2.2rem] italic leading-none">Ledgerline</p>
        <h1 className="font-display mt-10 max-w-[16ch] text-[2.4rem] leading-[1.1] sm:text-[3.2rem]">
          Should we pay this invoice?
        </h1>
        <p className="mt-5 max-w-[44ch] text-[#4B5963]">
          Every invoice is read, matched to its purchase order and checked against your rules. You see the answer and the
          reasons, and a person signs off on anything unsure.
        </p>
      </div>

      <div className="flex flex-col justify-center px-8 py-12">
        <h2 className="font-display text-2xl">Sign in</h2>
        <p className="mt-1 text-sm text-[#4B5963]">Your role sets how much you can approve.</p>
        <form onSubmit={submit} className="mt-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="border-l-4 border-[#B3261E] bg-[#FBFCFA] py-2 pl-3 text-sm text-[#B3261E]">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        {demo && (
          <div className="mt-10 border-t border-[#C5D0D8] pt-5">
            <p className="text-sm font-medium">Demo accounts</p>
            <p className="text-sm text-[#4B5963]">Password for all three: ledgerline</p>
            <ul className="mt-3 divide-y divide-[#C5D0D8] border-y border-[#C5D0D8]">
              {DEMO.map((d) => (
                <li key={d.email}>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(d.email);
                      setPassword("ledgerline");
                    }}
                    className="flex min-h-11 w-full items-baseline justify-between gap-4 px-1 py-2 text-left text-sm hover:bg-[#E6ECE3]"
                  >
                    <span className="font-medium">{d.role}</span>
                    <span className="text-[#4B5963]">{d.blurb}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
