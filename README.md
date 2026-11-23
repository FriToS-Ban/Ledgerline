# Ledgerline — the payment guard

Catch duplicate, overpaid and suspicious invoices before money leaves. Every invoice (vendor PDF, photo, email attachment, or fields sent by another AI agent over the API) is read, normalized (tax, shipping, FX), matched against the remaining PO balance (including multi-PO), checked against your guard rules, and given a release / hold / block call with a full audit trail. Cleared invoices go into payment batches that pay only verified vendor accounts.

**What the guard checks**

| Check | Catches |
| --- | --- |
| Bank-detail change (`bank.changed`) | An invoice asking to pay an account other than the vendor's verified one: the most common invoice fraud (business email compromise). Account numbers are only ever shown masked. |
| 3-way match (`receipt.missing`) | Billing for goods or services that are not marked received on the PO. |
| Exact / near duplicates | Same number, or same vendor + amount within 1.5% + similar lines within 14 days. |
| PO balance and tolerance | Overbilling against the remaining PO balance, partial/progressive billing, multi-PO splits, implied POs. |
| GSTIN (`tax.gstin_invalid`, `tax.id_mismatch`, `tax.gst_type`) | Invalid GSTIN checksum, a GSTIN that differs from the vendor master, IGST charged on an intra-state supply (or the reverse). |
| Dates (`date.future`, `date.stale`) | Future-dated invoices; invoices older than the policy limit resurfacing. |
| FX, arithmetic, thresholds, vendor approval, confidence | Missing/stale FX rates, lines that do not add up, amounts over the approval threshold, unapproved vendors, unreadable critical fields. |

**After the decision:** due dates come from vendor payment terms (`Net 30`, `2/10 Net 30`, `EOM`, …). The Payments page batches approved invoices per currency, takes open early-payment discounts, and exports a bank upload CSV that pays the **vendor-master account, never the one printed on an invoice**. Batches are claimed atomically (no double payment) and the exported file is stored, so a re-download is byte-identical. Changing a vendor's bank details is owner-only, requires a note on how it was verified, and is audited.

**Agent API** (`/api/v1`, spec at `/api/v1/openapi.json`, docs and key management on the **API** page): another AI agent (for example an AP agent at Zamp) submits an invoice as a file or as already-extracted JSON fields and gets release / hold / block with reasons, checklist, due date and a link for the human reviewer. Keys are per workspace, hashed at rest, rate limited (120/min), and can never release a payment. Signed webhooks (`Ledgerline-Signature: t=…,v1=HMAC-SHA256`) report `invoice.decided`, `invoice.resolved` and `payment_batch.*`, retried with backoff; webhook targets must be public https hosts (SSRF guard), secrets are encrypted at rest.

## Run

```bash
npm install
npx tsx src/lib/db/seed.ts
npm test
npm run dev
```

Optional durable runner (set `INNGEST_DEV=1` in `.env.local`; without it the dev `/api/inngest` endpoint refuses unsigned POST/PUT calls, so nobody can approve invoices through it):

```bash
npm run dev:inngest
```

Optional live vision: set `GOOGLE_GENERATIVE_AI_API_KEY` (free tier works), `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. Each AI call uses a fallback chain: the configured `GOOGLE_MODEL` first, then current Gemini models, then any other provider with a key, so a retired model id (Google retired `gemini-2.5-flash` for new users in Nov 2026) degrades to the next model instead of failing. Without a key, seeded fixtures and digital PDF parse still run; scanned pages are rendered and OCR'd with Tesseract (the English model is downloaded once from the jsDelivr CDN and cached in the OS temp dir, so the server needs outbound internet the first time).

PDF reading runs pdf.js on the server. Its worker, resource folders, the `@napi-rs/canvas` renderer and Tesseract's WASM core are loaded by computed paths that Next's file tracer cannot see, so `next.config.ts` lists them in `outputFileTracingIncludes`; without that, standalone/Docker builds read every PDF as empty. If you add another runtime-loaded package, add it there too and check `.next/standalone/node_modules` after `npm run build`.

Open http://localhost:3000 (the Command page) and run the Friday demo from the Command page.

### Sign-in

- Demo accounts (`clerk@`, `approver@`, `admin@ledgerline.demo`, password `DEMO_PASSWORD`, default `ledgerline`) exist **only when `DEMO_USERS=1`**, in every environment. For local dev add `DEMO_USERS=1` to `.env.local`.
- Sign-in is Auth.js (next-auth v5 beta, `src/auth.ts`) with a Credentials provider (email + password, scrypt) and the Drizzle adapter. Credentials sign-in forces JWT sessions, so revocation is a `token_version` on the user: password change and "sign out everywhere" bump it, and every request rejects JWTs carrying an older version. Sessions end 8 hours after sign-in. The JWT carries `userId`, `activeOrgId` and `orgRole`; the active org is re-verified against `memberships` on every request.
- Anyone can sign up at `/register`; new accounts get a personal organization (owner membership), or join an organization when registering with a valid `inviteToken`. An owner or admin changes member roles on `/account`. The first person to register a workspace is its owner and invites everyone else from the workspace settings page.
- `AUTH_SECRET` (>= 32 chars) is required in production. In development a random secret is created in `data/auth.secret`. Behind a reverse proxy or in production set `AUTH_URL` (or `AUTH_TRUST_HOST=1`) so Auth.js trusts the host. Cookies use the `__Host-` prefix in production.
- Five failed sign-ins in 15 minutes lock that email (and, with `TRUST_PROXY=1` behind a reverse proxy, that client IP) for 15 minutes; the login screen shows the countdown. Sign-up counts every attempt against the same budget (per email, and per client IP with `TRUST_PROXY=1`), which bounds email-existence probing via the `409 account exists` response; the response itself stays explicit for UX (a generic reply would need email verification). Known trade-off: lockout is per email, so someone who knows an address can lock that user out for 15 minutes.

### Multi-tenancy

Every tenant table carries `org_id`, and every query, update, delete and insert is scoped to the signed-in caller's active organization (`getActor().orgId`), threaded explicitly through the data-access functions; background jobs and Inngest events carry `orgId` in their payload. Authorization uses the caller's membership role: `owner` / `admin` may release payments (owners without limit, admins up to the `approverLimit` policy), change policy, import master data and manage members; `member` can create cases and reject. The folder, ERP and mailbox connectors are deployment-wide and feed only the org named by `SERVICE_ORG_SLUG` (default `zamp-demo` outside production). `defaultOrgId()` is for seed/scripts and the `AUTH_DISABLED` dev actor only.

### File storage

Uploaded invoices (web upload, email attachments) live in S3-compatible object storage, never under `public/`. For local dev run `docker compose --profile dev up -d s3` (a dev-only S3-compatible store, `adobe/s3mock:5.2.3`, bound to 127.0.0.1, with the bucket pre-created; it does no credential checking) and set the `S3_*` variables from `.env.example`; production uses any S3 endpoint (AWS S3, Cloudflare R2, MinIO). Objects are keyed `org/<orgId>/<uuid>-<filename>`; `invoices.pdf_path` stores the key. Files are served only by `GET /api/files/<invoiceId>`, which checks the caller's organization, streams the object and sets `nosniff` and `private, no-store`; there are no public or presigned URLs. Uploads are limited to PDF and common images, 15 MB. Tests use an in-memory driver (`STORAGE_DRIVER=memory`).

## Production

```bash
cp .env.example .env     # then fill in the required variables below
docker compose up -d --build
curl http://localhost:3000/api/health   # {"status":"ok"}
```

The image (`Dockerfile`, Next.js `output: "standalone"`, non-root) runs `migrate.cjs` (drizzle migrations, serialised by a Postgres advisory lock, exits non-zero on failure) and then `node server.js`. The app validates its environment at boot (`src/lib/env.ts`) and refuses to start with a clear message if a required variable is missing. `docker compose` ships `db` (Postgres, published on 127.0.0.1 only; `POSTGRES_PASSWORD` is required) and, under the `dev` profile, `s3` (local S3-compatible mock). `POSTGRES_PASSWORD=postgres` is fine for `npm run dev` against `docker compose up -d db`, but the containerized app refuses `postgres:postgres` credentials in production, so pick another password for the full stack. To try the full stack on one machine over plain http set `AUTH_ALLOW_HTTP=1`, `APP_ORIGINS=http://localhost:3000`, and, with the mock store, `S3_ALLOW_INSECURE=1` and `docker compose --profile dev up -d --build`. In real production point `DATABASE_URL` / `S3_*` at managed services and drop those two.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/db` (compose wires it to the `db` service) |
| `AUTH_SECRET` | yes | >= 32 chars (`openssl rand -hex 32`) |
| `AUTH_URL` | yes (or `AUTH_TRUST_HOST=1`) | public origin, must be `https://` (`AUTH_ALLOW_HTTP=1` overrides on a trusted http-only network), e.g. `https://ap.example.com` |
| `APP_ORIGINS` or `TRUST_PROXY=1` | yes | `APP_ORIGINS` = comma-separated public origins for CSRF checks; `TRUST_PROXY=1` when a proxy sets forwarded headers |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | yes | `S3_ENDPOINT` / `S3_REGION` / `S3_FORCE_PATH_STYLE` per provider; a plain `http://` `S3_ENDPOINT` is refused unless `S3_ALLOW_INSECURE=1` |
| `INNGEST_SIGNING_KEY` | yes | `/api/inngest` verifies request signatures; never expose it unsigned |
| `TRUST_PROXY` | behind a proxy | `1` only if a proxy sets `X-Forwarded-For` |
| `INTAKE_SECRET` | optional | >= 24 chars; enables the email webhook |
| `DEMO_USERS=1` | discouraged | in production needs `DEMO_PASSWORD` (>= 12 chars, not `ledgerline`) |
| `AUTH_DISABLED`, `STORAGE_DRIVER=memory` | forbidden | rejected at boot in production |

Backups: all state lives in Postgres (`pg_dump` the volume or use your provider's snapshots) and the S3 bucket (enable bucket versioning/replication). The compose volumes `pgdata` and `s3data` are not backed up by default. Run `npm run db:migrate` manually only outside Docker; the container migrates on every start.

## Demo cases

1. Split / partial billing against PO-31000
2. Implied PO (no number on the invoice)
3. Tax / shipping structure mismatch
4. Near-duplicate of INV-8842
5. EUR invoice vs USD PO (FX)
6. Multi-PO bundling with mixed outcomes
7. Low-confidence scan → human review
8. Changed bank account (Meridian asks to be paid into a new account) → held, call-back checklist
9. Billed before delivery (PO-6120 not received) → held by the 3-way match

Running a demo case seeds the demo vendor/PO book into an empty workspace, or tops up an older demo workspace with vendors and POs added since (never touching a workspace with its own vendors).

## Deploying for free

- **Vercel** builds with `npm run vercel-build`, which applies pending migrations (`scripts/migrate-build.ts`) before `next build`, so new tables reach the database on every deploy. Migrations are additive so the previous deployment keeps working until the new one is live. Note: Vercel's free Hobby plan is for non-commercial use; for paying customers use Vercel Pro, or self-host the Docker image (`docker compose up -d`) on any always-free VM (e.g. Oracle Cloud Always Free) with Neon or Supabase free Postgres and Cloudflare R2 (10 GB free) for files.
- **Scheduled worker:** `.github/workflows/cron.yml` calls `/api/cron/tick` every 10 minutes for free (webhook retries, mailbox polling, ERP sync). It needs no secret: the job sends a GitHub Actions OIDC token and the app verifies GitHub's signature, the repository (`CRON_GITHUB_REPOSITORY`, default `FriToS-Ban/Ledgerline`), the `main` branch and the workflow file (`src/lib/cron-auth.ts`). Other schedulers can send `Authorization: Bearer $CRON_SECRET` instead.
- **CI:** `.github/workflows/ci.yml` runs lint, typecheck, the full test suite against Postgres and a production build on every push and pull request.

## Operations: email intake, vendor/PO book, durable queue

- **Email intake** — `POST /api/intake/email` (raw `message/rfc822`, or multipart field `email`; send the credential as header `x-intake-secret`: either the workspace's own intake token (an owner creates/rotates it with `POST /api/orgs/current/intake-token`, shown once, `DELETE` revokes) together with the workspace slug in `x-intake-org`, or the deployment-wide `INTAKE_SECRET` (>= 24 chars), which only reaches the service organization (`SERVICE_ORG_SLUG`; only non-production/demo deployments fall back to `zamp-demo`). Disabled (503) when neither exists; bodies over 15 MB get 413) or set `IMAP_HOST/IMAP_USER/IMAP_PASSWORD` and the worker polls the mailbox. Every PDF/image attachment becomes a case. Deduped on Message-ID.
- **Vendor/PO book** — upload `vendors.csv` (optional verified columns: `tax_id`/`gstin`, `bank_account`/`iban`, `bank_code`/`ifsc`/`swift`/`routing_number`; empty cells never erase what is on file), `pos.csv`, `po_lines.csv` on the Operations page, or drop them in `data/master/` (the worker re-imports when they change). Bad rows are skipped and reported, never half-applied.
- **Durable queue** — jobs live in PostgreSQL with leases, exponential backoff retries (5s → 20s → 80s…), dead-letter after 4 attempts, and stale-lease recovery after a crash. The worker starts via `src/instrumentation.ts` and drains on startup. Inspect/retry at `/operations` or `GET/POST /api/queue`.
