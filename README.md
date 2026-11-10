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

Open http://localhost:3000 (the Command page) and run the Friday demo from the Command page.

### Sign-in

- Demo accounts (`clerk@`, `approver@`, `admin@ledgerline.demo`, password `DEMO_PASSWORD`, default `ledgerline`) exist **only when `DEMO_USERS=1`**, in every environment. For local dev add `DEMO_USERS=1` to `.env.local`.
- Sign-in is Auth.js (next-auth v5 beta, `src/auth.ts`) with a Credentials provider (email + password, scrypt) and the Drizzle adapter. Credentials sign-in forces JWT sessions, so revocation is a `token_version` on the user: password change and "sign out everywhere" bump it, and every request rejects JWTs carrying an older version. Sessions end 8 hours after sign-in. The JWT carries `userId`, `activeOrgId` and `orgRole`; the active org is re-verified against `memberships` on every request.
- Anyone can sign up at `/register`; new accounts get a personal organization (owner membership), or join an organization when registering with a valid `inviteToken`. An owner or admin changes member roles on `/account`. To create the first admin, set `BOOTSTRAP_ADMIN_TOKEN` (>= 24 random chars) and send it as `bootstrapToken` when registering; it works only while no real admin exists, so unset it afterwards.
- `AUTH_SECRET` (>= 32 chars) is required in production. In development a random secret is created in `data/auth.secret`. Behind a reverse proxy or in production set `AUTH_URL` (or `AUTH_TRUST_HOST=1`) so Auth.js trusts the host. Cookies use the `__Host-` prefix in production.
- Five failed sign-ins in 15 minutes lock that email (and, with `TRUST_PROXY=1` behind a reverse proxy, that client IP) for 15 minutes; the login screen shows the countdown.

### Multi-tenancy

Every tenant table carries `org_id`, and every query, update, delete and insert is scoped to the signed-in caller's active organization (`getActor().orgId`), threaded explicitly through the data-access functions; background jobs and Inngest events carry `orgId` in their payload. Authorization uses the caller's membership role: `owner` / `admin` may release payments (owners without limit, admins up to the `approverLimit` policy), change policy, import master data and manage members; `member` can create cases and reject. The folder, ERP and mailbox connectors are deployment-wide and feed only the org named by `SERVICE_ORG_SLUG` (default `zamp-demo` outside production). `defaultOrgId()` is for seed/scripts and the `AUTH_DISABLED` dev actor only.

### File storage

Uploaded invoices (web upload, email attachments) live in S3-compatible object storage, never under `public/`. Start MinIO with `docker compose up -d minio minio-init` and set the `S3_*` variables from `.env.example` (`S3_FORCE_PATH_STYLE=1` for MinIO). Objects are keyed `org/<orgId>/<uuid>-<filename>`; `invoices.pdf_path` stores the key. Files are served only by `GET /api/files/<invoiceId>`, which checks the caller's organization, streams the object and sets `nosniff` and `private, no-store`; there are no public or presigned URLs. Uploads are limited to PDF and common images, 15 MB. Tests use an in-memory driver (`STORAGE_DRIVER=memory`).

## Demo cases

1. Split / partial billing against PO-31000
2. Implied PO (no number on the invoice)
3. Tax / shipping structure mismatch
4. Near-duplicate of INV-8842
5. EUR invoice vs USD PO (FX)
6. Multi-PO bundling with mixed outcomes
7. Low-confidence scan → human review

## Operations: email intake, vendor/PO book, durable queue

- **Email intake** — `POST /api/intake/email` (raw `message/rfc822`, or multipart field `email`; requires `INTAKE_SECRET` sent as header `x-intake-secret` and the target organization slug in `x-intake-org`; disabled while unset. Without the header it uses `SERVICE_ORG_SLUG`, and only non-production/demo deployments fall back to `zamp-demo`) or set `IMAP_HOST/IMAP_USER/IMAP_PASSWORD` and the worker polls the mailbox. Every PDF/image attachment becomes a case. Deduped on Message-ID.
- **Vendor/PO book** — upload `vendors.csv`, `pos.csv`, `po_lines.csv` on the Operations page, or drop them in `data/master/` (the worker re-imports when they change). Bad rows are skipped and reported, never half-applied.
- **Durable queue** — jobs live in PostgreSQL with leases, exponential backoff retries (5s → 20s → 80s…), dead-letter after 4 attempts, and stale-lease recovery after a crash. The worker starts via `src/instrumentation.ts` and drains on startup. Inspect/retry at `/operations` or `GET/POST /api/queue`.
