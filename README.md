# Ledgerline — invoice decision workbench

Takes a vendor PDF and produces a defendable AP decision: extract → normalize (tax, shipping, FX) → match remaining PO balance (including multi-PO) → policy rules → recommendation with a full audit trail.

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

Open http://localhost:3000 and click a demo case.

## Demo cases

1. Split / partial billing against PO-31000
2. Implied PO (no number on the invoice)
3. Tax / shipping structure mismatch
4. Near-duplicate of INV-8842
5. EUR invoice vs USD PO (FX)
6. Multi-PO bundling with mixed outcomes
7. Low-confidence scan → human review

## Operations: email intake, vendor/PO book, durable queue

- **Email intake** — `POST /api/intake/email` (raw `message/rfc822`, or multipart field `email`; guard with `INTAKE_SECRET`) or set `IMAP_HOST/IMAP_USER/IMAP_PASSWORD` and the worker polls the mailbox. Every PDF/image attachment becomes a case. Deduped on Message-ID.
- **Vendor/PO book** — upload `vendors.csv`, `pos.csv`, `po_lines.csv` on the Operations page, or drop them in `data/master/` (the worker re-imports when they change). Bad rows are skipped and reported, never half-applied.
- **Durable queue** — jobs live in SQLite with leases, exponential backoff retries (5s → 20s → 80s…), dead-letter after 4 attempts, and stale-lease recovery after a crash. The worker starts via `src/instrumentation.ts` and drains on startup. Inspect/retry at `/operations` or `GET/POST /api/queue`.
