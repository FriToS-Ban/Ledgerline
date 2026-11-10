# Ledgerline — the payment guard

Catch duplicate, overpaid and suspicious invoices before money leaves. Every invoice (vendor PDF, photo or email attachment) is read, normalized (tax, shipping, FX), matched against the remaining PO balance (including multi-PO), checked against your guard rules, and given a release / hold / block call with a full audit trail.

## Run

```bash
npm install
npx tsx src/lib/db/seed.ts
npm test
npm run dev
```

Optional durable runner:

```bash
npm run dev:inngest
```

Optional live vision: set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. Without a key, seeded fixtures and digital PDF parse still run; scanned pages fall back to Tesseract.

Open http://localhost:3000 (the Command page) and run the Friday demo or a known threat.

### Sign-in

- Demo accounts (`clerk@`, `approver@`, `admin@ledgerline.demo`, password `DEMO_PASSWORD`, default `ledgerline`) exist **only when `DEMO_USERS=1`**, in every environment. For local dev add `DEMO_USERS=1` to `.env.local`.
- Anyone can sign up at `/register`; new accounts are clerks. An admin changes roles on `/account`. To create the first admin, set `BOOTSTRAP_ADMIN_TOKEN` (>= 24 random chars) and send it as `bootstrapToken` when registering; it works only while no real admin exists, so unset it afterwards.
- `AUTH_SECRET` (>= 32 chars) is required in production. In development a random secret is created in `data/auth.secret`.
- Sessions live in the database (only a SHA-256 of the session id is stored), expire after 8 hours or 2 idle hours, and are revoked on sign-out. Five failed sign-ins in 15 minutes lock that email (and, with `TRUST_PROXY=1` behind a reverse proxy, that client IP) for 15 minutes.

## Demo cases

1. Split / partial billing against PO-31000
2. Implied PO (no number on the invoice)
3. Tax / shipping structure mismatch
4. Near-duplicate of INV-8842
5. EUR invoice vs USD PO (FX)
6. Multi-PO bundling with mixed outcomes
7. Low-confidence scan → human review

## Operations: email intake, vendor/PO book, durable queue

- **Email intake** — `POST /api/intake/email` (raw `message/rfc822`, or multipart field `email`; requires `INTAKE_SECRET` sent as header `x-intake-secret`; disabled while unset) or set `IMAP_HOST/IMAP_USER/IMAP_PASSWORD` and the worker polls the mailbox. Every PDF/image attachment becomes a case. Deduped on Message-ID.
- **Vendor/PO book** — upload `vendors.csv`, `pos.csv`, `po_lines.csv` on the Operations page, or drop them in `data/master/` (the worker re-imports when they change). Bad rows are skipped and reported, never half-applied.
- **Durable queue** — jobs live in SQLite with leases, exponential backoff retries (5s → 20s → 80s…), dead-letter after 4 attempts, and stale-lease recovery after a crash. The worker starts via `src/instrumentation.ts` and drains on startup. Inspect/retry at `/operations` or `GET/POST /api/queue`.
