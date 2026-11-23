"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Key = { id: string; name: string; prefix: string; createdBy: string | null; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
type Hook = { id: string; url: string; events: string[]; active: boolean; createdAt: string; lastStatus: number | null; lastDeliveryAt: string | null };
type Delivery = { id: string; webhookId: string; event: string; statusCode: number | null; error: string | null; attempts: number; createdAt: string; deliveredAt: string | null };

const EVENTS = ["invoice.decided", "invoice.resolved", "payment_batch.created", "payment_batch.paid", "payment_batch.cancelled"];
const field =
  "w-full rounded-md border border-input bg-void px-2 py-1.5 text-foreground focus-visible:outline-2 focus-visible:outline-neon-cyan";

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto border border-glass-border bg-void p-3 text-xs leading-relaxed">
        <code>{children}</code>
      </pre>
      <button
        className="absolute right-2 top-2 border border-glass-border bg-glass px-2 py-0.5 text-xs"
        onClick={() => void navigator.clipboard.writeText(children).then(() => toast.success("Copied"))}
      >
        Copy
      </button>
    </div>
  );
}

function Secret({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  return (
    <div className="space-y-2 border border-neon-cyan/60 bg-glass p-4" role="status">
      <p className="text-sm font-medium">{label} Copy it now; it will not be shown again.</p>
      <Code>{value}</Code>
      <Button variant="ghost" onClick={onClose}>
        I&apos;ve stored it
      </Button>
    </div>
  );
}

export default function DevelopersPage() {
  const [origin, setOrigin] = useState("https://your-ledgerline.example");
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [hooks, setHooks] = useState<{ webhooks: Hook[]; deliveries: Delivery[] } | null>(null);
  const [denied, setDenied] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [k, h] = await Promise.all([fetch("/api/integrations/keys", { cache: "no-store" }), fetch("/api/integrations/webhooks", { cache: "no-store" })]);
    if (k.status === 403 || h.status === 403) {
      setDenied(true);
      return;
    }
    setKeys(k.ok ? await k.json() : []);
    setHooks(h.ok ? await h.json() : { webhooks: [], deliveries: [] });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the browser origin once on mount
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  async function createKey() {
    const res = await fetch("/api/integrations/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: keyName }) });
    const body = await res.json().catch(() => null);
    if (!res.ok) return void toast.error(body?.error ?? "Could not create the key.");
    setNewKey(body.key);
    setKeyName("");
    void load();
  }

  async function revokeKey(k: Key) {
    if (!confirm(`Revoke "${k.name}" (${k.prefix}…)? Anything using it stops working immediately.`)) return;
    const res = await fetch(`/api/integrations/keys/${k.id}`, { method: "DELETE" });
    if (res.ok) toast.success("Key revoked.");
    else toast.error("Could not revoke the key.");
    void load();
  }

  async function addHook() {
    const res = await fetch("/api/integrations/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: hookUrl, events: hookEvents }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return void toast.error(body?.error ?? "Could not add the webhook.");
    setNewSecret(body.secret);
    setHookUrl("");
    setHookEvents([]);
    void load();
  }

  async function removeHook(h: Hook) {
    if (!confirm(`Stop sending events to ${h.url}?`)) return;
    const res = await fetch(`/api/integrations/webhooks/${h.id}`, { method: "DELETE" });
    if (res.ok) toast.success("Webhook removed.");
    void load();
  }

  const submitJson = `curl -X POST ${origin}/api/v1/invoices \\
  -H "Authorization: Bearer $LEDGERLINE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "externalId": "agent-run-8812",
    "vendorName": "Meridian Facilities",
    "invoiceNumber": "MF-3342",
    "invoiceDate": "2026-11-05",
    "currency": "USD",
    "total": 2450,
    "poNumbers": ["PO-7740"],
    "bankDetails": { "accountNumber": "7712004431", "routingNumber": "026009593" }
  }'`;
  const submitFile = `curl -X POST ${origin}/api/v1/invoices \\
  -H "Authorization: Bearer $LEDGERLINE_KEY" \\
  -F "file=@invoice.pdf" -F "externalId=inbox-4471"`;
  const response = `{
  "id": "8d1c…",
  "status": "needs_review",
  "invoiceNumber": "MF-3342",
  "vendor": "Meridian Facilities",
  "total": 2450,
  "currency": "USD",
  "decision": {
    "recommendation": "escalate",
    "action": "hold",
    "needsHuman": true,
    "reasons": ["Bank details changed: this invoice asks for payment to account …4431, but the verified account on file for Meridian Facilities is …1928 …"],
    "checklist": ["Do not pay the new account. Call the vendor on a phone number from your own records …"]
  },
  "payment": { "dueDate": "2026-12-05", "discount": { "pct": 0.02, "byDate": "2026-11-15" }, "payTo": "…4431" },
  "caseUrl": "${origin}/cases/8d1c…"
}`;
  const verify = `import crypto from "node:crypto";

// Express / Next route: verify before trusting the event.
export function verifyLedgerline(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (ageSeconds > 300) return false; // replay protection
  const expected = crypto.createHmac("sha256", secret).update(\`\${parts.t}.\${rawBody}\`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 ?? ""));
}
// header = req.headers["ledgerline-signature"], secret = the whsec_… shown when you added the webhook`;

  return (
    <div className="max-w-4xl space-y-12">
      <section>
        <h1 className="font-display max-w-[20ch] text-[2.6rem] leading-[1.1] sm:text-[3.2rem]">Guard API.</h1>
        <p className="mt-4 max-w-[62ch] text-text-mute">
          Let your AI agents ask the guard before money moves. Send an invoice (a file, or the fields your agent already extracted)
          and get release, hold or block with the reasons. API keys can submit and read; they can never release a payment, change
          a rule or edit a vendor. Machine-readable spec:{" "}
          <a className="underline underline-offset-4" href="/api/v1/openapi.json">
            /api/v1/openapi.json
          </a>
          .
        </p>
      </section>

      {denied ? (
        <p className="border border-glass-border bg-glass p-4 text-sm">Only workspace owners and admins can manage API keys and webhooks.</p>
      ) : (
        <>
          <section className="space-y-4" aria-label="API keys">
            <h2 className="font-display text-2xl">API keys</h2>
            {newKey && <Secret label="Your new API key." value={newKey} onClose={() => setNewKey(null)} />}
            <div className="flex max-w-xl gap-2">
              <input className={field} value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Name, e.g. Zamp AP agent (prod)" />
              <Button onClick={() => void createKey()} disabled={!keyName.trim()}>
                Create key
              </Button>
            </div>
            <div className="ledger overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Last used</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(keys ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-text-mute">
                        {keys ? "No keys yet." : "Loading…"}
                      </td>
                    </tr>
                  ) : (
                    keys!.map((k) => (
                      <tr key={k.id} className={k.revokedAt ? "opacity-50" : ""}>
                        <td>{k.name}</td>
                        <td className="font-mono text-sm">{k.prefix}…</td>
                        <td className="text-text-mute">{k.lastUsedAt ? k.lastUsedAt.slice(0, 16).replace("T", " ") : "never"}</td>
                        <td className="text-text-mute">
                          {k.createdAt.slice(0, 10)} <span className="block text-xs">{k.createdBy}</span>
                        </td>
                        <td>
                          {k.revokedAt ? (
                            <span className="text-xs text-text-mute">revoked</span>
                          ) : (
                            <Button variant="ghost" onClick={() => void revokeKey(k)}>
                              Revoke
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4" aria-label="Webhooks">
            <h2 className="font-display text-2xl">Webhooks</h2>
            <p className="text-sm text-text-mute">
              We POST signed JSON to your https endpoint when the guard decides, a person resolves a hold, or a payment batch moves.
              Failed deliveries are retried with backoff for about an hour.
            </p>
            {newSecret && <Secret label="Signing secret for this webhook." value={newSecret} onClose={() => setNewSecret(null)} />}
            <div className="space-y-2">
              <div className="flex max-w-xl gap-2">
                <input className={field} value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://agent.example.com/hooks/ledgerline" />
                <Button onClick={() => void addHook()} disabled={!hookUrl.trim()}>
                  Add webhook
                </Button>
              </div>
              <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <legend className="mb-1 text-xs text-text-mute">Events (none ticked = all)</legend>
                {EVENTS.map((e) => (
                  <label key={e} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={hookEvents.includes(e)}
                      onChange={(ev) => setHookEvents(ev.target.checked ? [...hookEvents, e] : hookEvents.filter((x) => x !== e))}
                    />
                    <span className="font-mono text-xs">{e}</span>
                  </label>
                ))}
              </fieldset>
            </div>
            <div className="ledger overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th>Events</th>
                    <th>Last delivery</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(hooks?.webhooks ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-text-mute">
                        {hooks ? "No webhooks yet." : "Loading…"}
                      </td>
                    </tr>
                  ) : (
                    hooks!.webhooks.map((h) => (
                      <tr key={h.id}>
                        <td className="max-w-[24ch] truncate font-mono text-xs" title={h.url}>
                          {h.url}
                        </td>
                        <td className="font-mono text-xs">{h.events.join(", ")}</td>
                        <td className="text-text-mute">
                          {h.lastDeliveryAt ? `${h.lastStatus || "error"} · ${h.lastDeliveryAt.slice(0, 16).replace("T", " ")}` : "none yet"}
                        </td>
                        <td>
                          <Button variant="ghost" onClick={() => void removeHook(h)}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {!!hooks?.deliveries.length && (
              <details className="text-sm">
                <summary className="cursor-pointer text-text-mute">Recent deliveries</summary>
                <ul className="mt-2 space-y-1 font-mono text-xs">
                  {hooks.deliveries.map((d) => (
                    <li key={d.id}>
                      {d.createdAt.slice(0, 19).replace("T", " ")} {d.event} → {d.deliveredAt ? `delivered (${d.statusCode})` : `pending/failed after ${d.attempts} tries${d.error ? `: ${d.error}` : ""}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </>
      )}

      <section className="space-y-4" aria-label="Reference">
        <h2 className="font-display text-2xl">Quick start</h2>
        <h3 className="font-medium">1. Ask before paying (fields your agent extracted)</h3>
        <Code>{submitJson}</Code>
        <h3 className="font-medium">2. Or send the file and let the guard read it</h3>
        <Code>{submitFile}</Code>
        <h3 className="font-medium">3. Act on the answer</h3>
        <p className="text-sm text-text-mute">
          Pay only when <code>decision.action</code> is <code>release</code> (or <code>release_partial</code> for the matched amount).
          On <code>hold</code>, a person reviews it at <code>caseUrl</code>; you get an <code>invoice.resolved</code> webhook when they
          decide. <code>GET /api/v1/invoices/{"{id}"}</code> returns the same object at any time.
        </p>
        <Code>{response}</Code>
        <h3 className="font-medium">4. Verify webhook signatures</h3>
        <Code>{verify}</Code>
        <p className="text-sm text-text-mute">Limits: 120 requests per minute per key (HTTP 429 with Retry-After), files up to 15 MB.</p>
      </section>
    </div>
  );
}
