"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FieldError, PasswordField } from "@/components/auth/password-field";

type Role = "owner" | "admin" | "member";
type Me = { email: string; name: string; role: Role };
type UserRow = { email: string; name: string; role: Role; createdAt: string | null };
const ROLES: Role[] = ["owner", "admin", "member"];

function fmtDate(iso: string | null) {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Unknown" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ChangePassword({ me }: { me: Me }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [fields, setFields] = useState<{ currentPassword?: string; newPassword?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lock, setLock] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFields({});
    setError(null);
    setLock(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCurrent("");
        setNext("");
        toast.success(
          "Password changed. Your other sessions were signed out.",
        );
      } else if (res.status === 401) {
        router.replace("/login?next=/account");
      } else if (res.status === 429) {
        setLock(data.error ?? "Too many attempts. Try again later.");
      } else {
        setFields(data.fields ?? {});
        if (!data.fields) setError(data.error ?? "Could not change the password.");
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-xl">Change password</CardTitle>
        <CardDescription>Other devices are signed out when you change it.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="max-w-md space-y-5" aria-busy={busy}>
          <PasswordField label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" error={fields.currentPassword} />
          <PasswordField
            label="New password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            error={fields.newPassword}
            hint="At least 10 characters. Avoid common words and keyboard runs."
            meter={{ email: me.email, name: me.name }}
          />
          {(error || lock) && (
            <Alert variant="destructive">
              <AlertDescription>
                <p>{lock ?? error}</p>
              </AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
            {busy ? "Saving…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SignOutEverywhere({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await fetch("/api/auth/signout-everywhere", { method: "POST" });
    } finally {
      setBusy(false);
      onDone();
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-xl">Sign out everywhere</CardTitle>
        <CardDescription>Ends every session for your account, including this one. Use it if you lost a device.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {!confirm ? (
          <Button variant="outline" onClick={() => setConfirm(true)}>
            Sign out of all devices
          </Button>
        ) : (
          <>
            <Button variant="danger" onClick={() => void go()} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
              Yes, sign out everywhere
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function UsersAdmin({ me }: { me: Me }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ email: string; message: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/users", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not load users.");
        return;
      }
      setUsers(data.users);
      setError(null);
    } catch {
      setError("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void fetch("/api/auth/users", { cache: "no-store" })
      .then(async (res) => ({ res, data: await res.json().catch(() => ({})) }))
      .then(({ res, data }) => {
        if (!alive) return;
        if (res.ok) setUsers(data.users);
        else setError(data.error ?? "Could not load users.");
      })
      .catch(() => alive && setError("Could not reach the server."));
    return () => {
      alive = false;
    };
  }, []);

  async function setRole(u: UserRow, role: Role) {
    setSaving(u.email);
    setRowError(null);
    try {
      const res = await fetch("/api/auth/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: u.email, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUsers((list) => list?.map((x) => (x.email === u.email ? { ...x, role } : x)) ?? list);
        toast.success(`${u.name} is now ${role}.`);
      } else {
        setRowError({ email: u.email, message: data.fields?.role ?? data.error ?? "Could not change the role." });
        void load(); // snap the select back to the real value
      }
    } catch {
      setRowError({ email: u.email, message: "Could not reach the server." });
      void load();
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-xl">Members and roles</CardTitle>
        <CardDescription>Role changes apply on the person&apos;s next request. Owners and admins can approve payments. At least one owner must remain.</CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              <p>{error}</p>
            </AlertDescription>
          </Alert>
        )}
        {!users && !error && <Skeleton className="h-32 w-full" />}
        {users && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Name</TableHead>
                <TableHead scope="col">Email</TableHead>
                <TableHead scope="col">Joined</TableHead>
                <TableHead scope="col">Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.email}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-text-mute">{u.email}</TableCell>
                  <TableCell className="text-text-mute">{fmtDate(u.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`Role for ${u.name}`}
                        value={u.role}
                        disabled={saving === u.email}
                        onChange={(e) => void setRole(u, e.target.value as Role)}
                        aria-invalid={rowError?.email === u.email ? true : undefined}
                        aria-describedby={rowError?.email === u.email ? "role-err" : undefined}
                        className="h-11 rounded-md border border-input bg-void/60 px-2 text-sm text-foreground focus-visible:border-ring focus-visible:shadow-[var(--glow-cyan)] disabled:opacity-50"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      {saving === u.email && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-label="Saving" />}
                      {u.email === me.email && <span className="text-xs text-text-mute">(you)</span>}
                    </div>
                    {rowError?.email === u.email && <FieldError id="role-err">{rowError.message}</FieldError>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (!d.user) router.replace("/login?next=/account");
        else setMe(d.user);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [router]);

  function leave() {
    router.replace("/login");
    router.refresh();
  }

  if (failed) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <p>Could not load your account. Reload the page to try again.</p>
        </AlertDescription>
      </Alert>
    );
  }
  if (!me) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading account">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Account</h1>
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">Profile</CardTitle>
          <CardDescription>Your name and your role in this organization. An owner or admin can change it.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[auto_1fr]">
            <dt className="text-text-mute">Name</dt>
            <dd className="font-medium">{me.name}</dd>
            <dt className="text-text-mute">Email</dt>
            <dd className="font-medium break-all">{me.email}</dd>
            <dt className="text-text-mute">Role</dt>
            <dd>
              <span className="rounded-full border border-neon-violet/50 bg-neon-violet/15 px-2.5 py-0.5 font-mono text-xs uppercase tracking-wider text-violet-text">
                {me.role}
              </span>
            </dd>
          </dl>
        </CardContent>
      </Card>
      {me.email.startsWith("auth-disabled") ? (
        <Alert>
          <AlertDescription>
            <p>Sign-in is turned off for this deployment, so password and session settings are unavailable.</p>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <ChangePassword me={me} />
          <SignOutEverywhere onDone={leave} />
        </>
      )}
      {(me.role === "owner" || me.role === "admin") && <UsersAdmin me={me} />}
    </div>
  );
}
