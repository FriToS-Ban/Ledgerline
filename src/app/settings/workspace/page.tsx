"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FieldError } from "@/components/auth/password-field";

type Role = "owner" | "admin" | "member";
type Org = { id: string; name: string; slug: string; role: Role };
type Member = { email: string; name: string; role: Role; createdAt: string };
type Invite = { id: string; email: string; role: Role; expiresAt: string; expired: boolean };

const ROLES: Role[] = ["owner", "admin", "member"];
const selectCls =
  "h-11 rounded-md border border-input bg-void/60 px-2 text-sm text-foreground focus-visible:border-ring focus-visible:shadow-[var(--glow-cyan)] disabled:opacity-50";

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Unknown" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function Busy({ on }: { on: boolean }) {
  return on ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null;
}

function General({ org, canEdit, onRenamed }: { org: Org; canEdit: boolean; onRenamed: (n: string) => void }) {
  const [name, setName] = useState(org.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call("/api/orgs/current", "PATCH", { name }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Could not reach the server.");
    if (!r.ok) return setError(r.data.error ?? "Could not rename.");
    onRenamed(r.data.name);
    window.dispatchEvent(new Event("workspace-changed"));
    toast.success("Workspace renamed.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-xl">General</CardTitle>
        <CardDescription>
          Your role here: <span className="font-mono uppercase">{org.role}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="max-w-md space-y-5" aria-busy={busy}>
          <div className="space-y-2">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
              readOnly={!canEdit}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "ws-name-err" : "ws-name-hint"}
            />
            {error ? (
              <FieldError id="ws-name-err">{error}</FieldError>
            ) : (
              <p id="ws-name-hint" className="text-sm text-text-mute">
                {canEdit ? "Shown in the workspace switcher and on invites." : "Only an owner or admin can rename the workspace."}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm text-text-mute">Workspace address</p>
            <p className="font-mono text-sm break-all">{org.slug}</p>
          </div>
          {canEdit && (
            <Button type="submit" disabled={busy || !name.trim() || name.trim() === org.name}>
              <Busy on={busy} />
              {busy ? "Saving…" : "Save name"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function Members({ role, me }: { role: Role; me: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ email: string; message: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await call("/api/auth/users", "GET").catch(() => null);
    if (!r) return setError("Could not reach the server.");
    if (!r.ok) return setError(r.data.error ?? "Could not load members.");
    setMembers(r.data.users);
    setError(null);
  }, []);
  useEffect(() => {
    let alive = true;
    void call("/api/auth/users", "GET")
      .then((r) => {
        if (!alive) return;
        if (r.ok) setMembers(r.data.users);
        else setError(r.data.error ?? "Could not load members.");
      })
      .catch(() => alive && setError("Could not reach the server."));
    return () => {
      alive = false;
    };
  }, []);

  async function setRole(m: Member, next: Role) {
    setSaving(m.email);
    setRowError(null);
    const r = await call("/api/auth/users", "PATCH", { email: m.email, role: next }).catch(() => null);
    setSaving(null);
    if (r?.ok) toast.success(`${m.name || m.email} is now ${next}.`);
    else setRowError({ email: m.email, message: r?.data.error ?? "Could not reach the server." });
    await load();
  }

  async function remove(m: Member) {
    setSaving(m.email);
    setRowError(null);
    setConfirm(null);
    const r = await call("/api/auth/users", "DELETE", { email: m.email }).catch(() => null);
    setSaving(null);
    if (r?.ok) toast.success(`${m.name || m.email} was removed.`);
    else setRowError({ email: m.email, message: r?.data.error ?? "Could not reach the server." });
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-xl">Members</CardTitle>
        <CardDescription>
          Owners and admins can approve payments. Only an owner can grant or remove the owner role, and at least one owner must remain.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              <p>{error}</p>
            </AlertDescription>
          </Alert>
        )}
        {!members && !error && <Skeleton className="h-32 w-full" />}
        {members && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Member</TableHead>
                <TableHead scope="col">Joined</TableHead>
                <TableHead scope="col">Role</TableHead>
                <TableHead scope="col">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const locked = role !== "owner" && m.role === "owner"; // admins never touch owners
                const errId = `member-err-${m.email}`;
                return (
                  <TableRow key={m.email}>
                    <TableCell>
                      <div className="font-medium">
                        {m.name || m.email} {m.email === me && <span className="text-xs text-text-mute">(you)</span>}
                      </div>
                      <div className="text-sm text-text-mute break-all">{m.email}</div>
                    </TableCell>
                    <TableCell className="text-text-mute">{fmt(m.createdAt)}</TableCell>
                    <TableCell>
                      <select
                        aria-label={`Role for ${m.name || m.email}`}
                        value={m.role}
                        disabled={saving === m.email || locked}
                        onChange={(e) => void setRole(m, e.target.value as Role)}
                        aria-describedby={rowError?.email === m.email ? errId : undefined}
                        className={selectCls}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r} disabled={r === "owner" && role !== "owner"}>
                            {r}
                          </option>
                        ))}
                      </select>
                      {rowError?.email === m.email && <FieldError id={errId}>{rowError.message}</FieldError>}
                    </TableCell>
                    <TableCell>
                      {m.email !== me &&
                        !locked &&
                        (confirm === m.email ? (
                          <div className="flex flex-wrap gap-2">
                            <Button variant="danger" onClick={() => void remove(m)} disabled={saving === m.email}>
                              Confirm remove
                            </Button>
                            <Button variant="ghost" onClick={() => setConfirm(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button variant="outline" onClick={() => setConfirm(m.email)} disabled={saving === m.email} aria-label={`Remove ${m.name || m.email}`}>
                            <Busy on={saving === m.email} />
                            Remove
                          </Button>
                        ))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Invites({ role }: { role: Role }) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await call("/api/orgs/current/invites", "GET").catch(() => null);
    if (r?.ok) setInvites(r.data.invites);
  }, []);
  useEffect(() => {
    let alive = true;
    void call("/api/orgs/current/invites", "GET")
      .then((r) => alive && r.ok && setInvites(r.data.invites))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setLink(null);
    setCopied(false);
    const r = await call("/api/orgs/current/invites", "POST", { email, role: inviteRole }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Could not reach the server.");
    if (!r.ok) return setError(r.data.error ?? "Could not create the invite.");
    setLink({ email: r.data.invite.email, url: `${window.location.origin}${r.data.path}` });
    setEmail("");
    await load();
  }

  async function revoke(i: Invite) {
    const r = await call(`/api/orgs/current/invites/${i.id}`, "DELETE").catch(() => null);
    if (r?.ok) toast.success(`Invite for ${i.email} revoked.`);
    else toast.error(r?.data.error ?? "Could not revoke the invite.");
    await load();
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      toast.error("Copy failed. Select the link and copy it by hand.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-xl">Invite people</CardTitle>
        <CardDescription>
          Each invite is for one email address, works once and expires after 7 days. Send the link yourself; it is shown only once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={create} className="grid max-w-xl gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end" aria-busy={busy}>
          <div className="space-y-2">
            <Label htmlFor="inv-email">Email</Label>
            <Input
              id="inv-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "inv-err" : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inv-role">Role</Label>
            <select id="inv-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} className={`${selectCls} w-full`}>
              {ROLES.map((r) => (
                <option key={r} value={r} disabled={r === "owner" && role !== "owner"}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={busy || !email.trim()}>
            <Busy on={busy} />
            Create invite
          </Button>
        </form>
        {error && <FieldError id="inv-err">{error}</FieldError>}

        {link && (
          <Alert>
            <AlertDescription>
              <div className="space-y-3">
                <p>
                  Invite link for <strong className="break-all">{link.email}</strong>. Copy it now; it will not be shown again.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input readOnly aria-label="Invite link" value={link.url} onFocus={(e) => e.currentTarget.select()} className="font-mono" />
                  <Button type="button" variant="outline" onClick={() => void copy()}>
                    {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                </div>
                <p aria-live="polite" className="sr-only">
                  {copied ? "Link copied" : ""}
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div>
          <h3 className="mb-2 text-sm font-medium">Pending invites</h3>
          {!invites && <Skeleton className="h-16 w-full" />}
          {invites && invites.length === 0 && <p className="text-sm text-text-mute">No pending invites.</p>}
          {invites && invites.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Email</TableHead>
                  <TableHead scope="col">Role</TableHead>
                  <TableHead scope="col">Expires</TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="break-all">{i.email}</TableCell>
                    <TableCell className="font-mono text-xs uppercase">{i.role}</TableCell>
                    <TableCell className={i.expired ? "text-danger-text" : "text-text-mute"}>{i.expired ? "Expired" : fmt(i.expiresAt)}</TableCell>
                    <TableCell>
                      <Button variant="outline" onClick={() => void revoke(i)} aria-label={`Revoke invite for ${i.email}`}>
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Danger({ org }: { org: Org }) {
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"leave" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(kind: "leave" | "delete") {
    setBusy(kind);
    setError(null);
    const r =
      kind === "leave"
        ? await call("/api/orgs/current/leave", "POST").catch(() => null)
        : await call("/api/orgs/current", "DELETE", { confirmName: typed }).catch(() => null);
    setBusy(null);
    if (!r) return setError("Could not reach the server.");
    if (!r.ok) return setError(r.data.error ?? "That did not work.");
    // the session falls back to another workspace on the next request
    // full reload on purpose: every page loads tenant data on mount
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }

  return (
    <Card className="border-danger-text/40">
      <CardHeader>
        <CardTitle className="font-display text-xl">Leave or delete</CardTitle>
        <CardDescription>You land in another workspace of yours, or a personal one if this was your only workspace.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Leave this workspace</h3>
          <p className="text-sm text-text-mute">The last owner cannot leave. Make someone else an owner first, or delete the workspace.</p>
          {!confirmLeave ? (
            <Button variant="outline" onClick={() => setConfirmLeave(true)}>
              Leave workspace
            </Button>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button variant="danger" onClick={() => void go("leave")} disabled={busy !== null}>
                <Busy on={busy === "leave"} />
                Yes, leave {org.name}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
        {org.role === "owner" && (
          <form
            className="max-w-md space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim() === org.name) void go("delete");
            }}
          >
            <h3 className="text-sm font-medium">Delete this workspace</h3>
            <p className="text-sm text-text-mute">
              Permanently deletes every invoice, uploaded file, vendor, purchase order, rule and member link. This cannot be undone.
            </p>
            <Label htmlFor="del-confirm">
              Type <span className="font-mono text-foreground">{org.name}</span> to confirm
            </Label>
            <Input id="del-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            <Button variant="danger" type="submit" disabled={busy !== null || typed.trim() !== org.name}>
              <Busy on={busy === "delete"} />
              Delete workspace
            </Button>
          </form>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              <p>{error}</p>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const [org, setOrg] = useState<Org | null>(null);
  const [me, setMe] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/orgs/current", { cache: "no-store" })
      .then(async (r) => ({ r, d: await r.json().catch(() => ({})) }))
      .then(({ r, d }) => {
        if (!alive) return;
        if (r.status === 401) router.replace("/login?next=/settings/workspace");
        else if (!r.ok) setFailed(true);
        else {
          setOrg(d.org);
          setMe(d.you.email);
        }
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [router]);

  if (failed) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <p>Could not load the workspace. Reload the page to try again.</p>
        </AlertDescription>
      </Alert>
    );
  }
  if (!org) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading workspace">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  const admin = org.role === "owner" || org.role === "admin";
  const authOff = me.startsWith("auth-disabled");

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Workspace</h1>
      <General key={org.id} org={org} canEdit={admin} onRenamed={(name) => setOrg({ ...org, name })} />
      {admin && <Members role={org.role} me={me} />}
      {admin && <Invites role={org.role} />}
      {!authOff && <Danger org={org} />}
    </div>
  );
}
