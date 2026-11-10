# Ledgerline demo: 4-minute walkthrough

Ledgerline is a payment guard for accounts payable. Invoices arrive, an AI agent reads and checks them, and anything risky is held for a person before money leaves. It is built with finance-operations teams in mind, the kind of work AI agents like Zamp's are taking on.

**The one-line pitch to say first:**
> "AI agents can read invoices fast. The hard part is trusting them with money. Ledgerline is the control layer: it lets the agent clear the safe ones, stops the risky ones, and writes down why."

---

## 0. Before you start (5 minutes, do this the day before and again 10 minutes before)

1. Start Docker Desktop. Run `docker compose --profile dev up -d` from the project folder.
2. Run `npm run db:migrate`, then `DEMO_USERS=1 npm run db:seed`, then `npm run dev`.
3. Open http://localhost:3000 in a clean browser window (no extensions, zoom 100%, full screen).
4. Sign in once as `admin@ledgerline.demo` / `ledgerline` and check the landing page loads.
5. Open a second private window, signed in as `acme-owner@ledgerline.demo` / `ledgerline`. Keep it ready for the isolation moment.
6. Keep these files in a folder on the desktop for dragging: `public/demos/near-dup.pdf`, `partial.pdf`, `low-confidence.pdf`.
7. If the demo data looks stale, run `DEMO_USERS=1 npm run db:seed` again. It is safe to repeat.

**Backup plan:** if the internet or Docker fails, say so calmly, show the code and tests (`npx vitest run`), and walk through the script verbally. Do not debug live.

---

## 1. The script (about 4:00)

Speak slowly. Say the bold lines out loud. The "Do" lines are what you click.

### 0:00 to 0:30. The problem (landing page)

**Say:** "Every company pays invoices. Mistakes are expensive: duplicate payments, overpaying a purchase order, a fake or unreadable invoice slipping through. AI can read invoices now, but a finance leader will not hand it the payment button without controls. That is the gap I built this for."

**Do:** Stay on the landing page (`/`). Point at the headline, "Stop paying invoices you shouldn't." Do not scroll yet.

### 0:30 to 1:15. Load a realistic week (Friday demo)

**Say:** "Here is a normal Friday inbox. Invoices come in by email. I will load a week's worth."

**Do:** Scroll to "Run the Friday demo". Click the load button. Watch the numbers on the page change as invoices are read.

**Say:** "Behind the scenes the agent reads each PDF, finds the vendor, amount and purchase order, and checks it against what we actually ordered."

### 1:15 to 2:15. The agent stops a bad payment

**Do:** Open **Invoices** in the top bar. Click the **near-duplicate** invoice.

**Say:** "This one has a different invoice number, but the amount is within about one percent of an invoice we already paid. A person skimming would miss that. The guard held it."

**Do:** Point at the three things on the case page, in this order:
1. The PDF on the left.
2. The decision and the plain-language reason.
3. The audit trail.

**Say:** "Every decision comes with a reason and a trail. That is what makes an AI decision acceptable to a controller or an auditor."

### 2:15 to 3:00. The human stays in control

**Do:** On the held invoice, show the three buttons: **Release as proposed**, **Override and release in full**, **Block payment**. Click **Block payment** (or release, your choice).

**Say:** "The agent does not get the last word on risky money. A person decides, and the decision is recorded."

**Do:** Switch to **Guard rules** in the top bar.

**Say:** "These are the company's own rules: how much an admin can release, how confident the agent must be, how much price difference to tolerate. Only owners can change them, and every change is logged."

### 3:00 to 3:40. Many companies, one product (multi-tenancy)

**Do:** Click the workspace name in the header to open the switcher. Show Zamp Demo.

**Say:** "This is multi-tenant. Each customer is a separate workspace."

**Do:** Switch to the second window, signed in as the Acme owner. Show the empty queue.

**Say:** "Acme sees none of the other company's invoices, files or rules. Isolation is enforced on every query and covered by automated tests."

**Do (optional, if time):** In Zamp Demo, open **Workspace settings**, create an invite, show the one-time link.

### 3:40 to 4:00. Close

**Say:** "To summarize: the agent works fast, the guard makes it safe, a person decides the risky cases, and every step is recorded. It runs on Postgres, signs in with Auth.js, stores files privately, and ships as a Docker image. I would love to help take this kind of control layer to real customers."

---

## 2. If something goes wrong

| Problem | What to do |
|---|---|
| Page will not load | Check Docker is running, then `docker compose --profile dev up -d`, then restart `npm run dev`. |
| Upload fails | The dev S3 container is not running. Start it with the compose command above. |
| Friday demo says "already loaded" | That is fine. Open **Invoices** and continue. |
| You get signed out | Sign in again. Sessions last 8 hours. |
| A button does nothing | Refresh once. If still broken, move on and use the screenshots or the code. |

---

## 3. Likely questions from a founder (short honest answers)

**"Why not just let the agent pay everything?"**
Because one wrong payment costs more than a thousand correct ones save. The guard lets the agent auto-clear the clean invoices and escalates only the risky ones, so people review exceptions, not everything.

**"How do you keep one customer's data away from another?"**
Every record carries a workspace id, every query filters on it, and automated tests prove one workspace cannot read, change, or approve another's records. Files are stored under per-workspace keys and are only served after a login and workspace check.

**"How would this plug into a real ERP?"**
There is an ERP sync hook and a purchase-order import already. Production connectors per customer are the next step.

**"What did you test?"**
142 automated tests run against a real Postgres database, including cross-workspace isolation and role rules. I also ran an independent security review of the whole project and fixed what it found, for example an admin being able to raise their own payment limit.

**"What is not finished?"** (Say this before they ask. It builds trust.)
- The mobile layout has not been checked on a real phone yet.
- Real S3 or MinIO storage is used in production. The demo uses a local stand-in.
- The Content Security Policy still allows inline scripts, and a nonce-based policy is the next hardening step.
- Per-customer email intake tokens exist as an API but have no settings screen yet.

---

## 4. What to emphasise so you are remembered

1. **Trust, not speed.** Anyone can show an AI reading a PDF. You are showing the part companies are actually afraid of.
2. **Explain in plain words.** Say "held for a person", not "escalated to HITL".
3. **Own the gaps.** Naming what is unfinished makes everything else more believable.
4. **Have one story ready:** the admin-raises-own-limit bug the review found and you fixed. It shows you think like an attacker and finish the job.
5. **End with what you would do in week one** at the company, for example connecting one real customer's purchase-order data, rather than a thank-you.

---

## 5. Quick map of the app

| Top bar item | What it is |
|---|---|
| Command | Landing page: totals, latest decisions, Friday demo loader. |
| Invoices | Every invoice and its status. Upload one here. Click to open the case. |
| Needs a person | The held items waiting for a decision. |
| Accuracy | How often the agent's reading and decisions were right. |
| Sources | Where invoices come from: email, folder, ERP. |
| Guard rules | The company's payment limits and thresholds. |
| Account | Your sign-in, password, sign out everywhere. |
| Workspace switcher | Header control: switch company, create one, open workspace settings and invites. |

**Logins (password `ledgerline`):**
`admin@ledgerline.demo` owner, `approver@ledgerline.demo` admin, `clerk@ledgerline.demo` member (cannot release payments), `acme-owner@ledgerline.demo` second company.

**Demo invoices in `public/demos/`:** `near-dup.pdf` (looks like a duplicate), `partial.pdf` (second bill on the same order), `implied.pdf` (no order number given), `tax-shipping.pdf` (tax and freight differ), `fx-eur.pdf` (euro invoice, dollar order), `multi-po.pdf` (one invoice, two orders), `low-confidence.pdf` (blurry scan, forces a human).
