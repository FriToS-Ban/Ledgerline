# Ledgerline: Loom recording script (4 minutes, with speech)

Word-for-word narration with screen actions, checked against the running app. About 470 words spoken, which fills 4:00 once you add pauses for clicks. Read it naturally, do not recite. Say "[your name]" as your own name.

## Before you hit record (10 minutes)

The Friday inbox takes about 2 minutes to process, and a case you run while the queue is busy shows a blank page until the agent reaches it. So prepare the data first, then record on a finished screen.

1. `docker compose --profile dev up -d`, `npm run db:migrate`, `DEMO_USERS=1 npm run db:seed`, `npm run dev`.
2. Chrome: full screen, zoom 100%, bookmarks bar hidden, no extensions (fresh profile or guest window), notifications off.
3. Sign in as `admin@ledgerline.demo` / `ledgerline`. On the landing page scroll to the bottom, click **Load the inbox**, and wait until "Guard queue" says **34 of 34 done** (about 2 minutes).
4. Then go to **Invoices**, scroll to "Try a known threat", click **Run this case** under **Near-duplicate**. It opens a case page. Wait for the decision to appear ("Hold payment", INV-8843, Apex Industrial Supply). If it is blank, wait 10 seconds and refresh.
5. Do not click Block on it yet. That is the on-camera moment.
6. Second Chrome profile or private window: sign in as `acme-owner@ledgerline.demo` / `ledgerline`, open **Invoices**. The table is empty. Leave it ready.
7. Loom: "Screen + camera bubble", 1080p, mic check. Do one dry run first. A stumble is fine, you can trim.

**To re-record a take:** the Block click changes the case. Run the Near-duplicate case again from "Try a known threat" for a fresh held invoice, or reload with a fresh seed.

## Script

### 0:00 to 0:25. Landing page (`/`)

**Screen:** Landing page, "Stop paying invoices you shouldn't." Do not scroll yet.

> "Hi, I'm [your name]. I built Ledgerline for Zamp. Finance teams are starting to let AI agents handle invoices, and the question every finance leader asks is the same: what stops the agent from paying the wrong thing? Ledgerline is my answer. It's a payment guard that sits between the agent and the money."

### 0:25 to 1:10. A week of invoices, already checked

**Screen:** Slowly point at the three big numbers: **Stopped before payment**, **Duplicates caught**, **Held for review**. Then scroll down to "Latest guard decisions" and the "Checked for you" box. Pause on the bottom: "Run the Friday demo".

> "This is a normal Friday: thirty-four invoices came in by email. The agent read every one, pulled out the vendor, the amount and the purchase order, and checked each against what was actually ordered. Up here is the result. Money it stopped before payment, duplicates it caught, and how many it held for a person. Most of them it cleared on its own. The ones that look wrong, it holds, and it tells you why in the last column."

*(If you want the live moment instead: click **Load the inbox** here, say "I'll load a fresh batch", then press Loom's pause button for two minutes and resume when it says 34 of 34 done.)*

### 1:10 to 2:10. A bad payment, stopped

**Screen:** Click **Invoices** in the top bar. Open **INV-8843** (Apex Industrial Supply, $4,273) from the list. Point at: the PDF on the left, the decision and reasons on the right, then the "Guard checks run" list lower down. Click **Audit trail** at the top of the PDF panel for a second.

> "Let me open one it stopped. This invoice has a new invoice number, so a simple duplicate check would let it through. But the amount is within one and a half percent of one we already paid, with similar line items, and it's billed against an order that has nothing left on it. The guard held it.
> On the left is the original PDF. On the right is the decision and the reasons, in plain English, and below is every check it ran, with the ones that failed marked. The audit trail keeps every step, so a controller or an auditor can see what happened and why."

### 2:10 to 2:55. A person decides

**Screen:** Scroll to the three buttons: **Release as proposed**, **Override and release in full**, **Block payment**. Click **Block payment**. A "Decision recorded" message appears at the bottom right. Do not read the big headline after clicking, it still says "Hold payment"; point at the BLOCK badge instead. Then click **Guard rules** in the top bar.

> "The agent doesn't get the last word on risky money. A person chooses: release as proposed, override and release in full, or block the payment. I'll block this one, and it's recorded.
> The limits behind these decisions live in Guard rules: how far off an amount can be, how confident the agent has to be, and the approval threshold. Only owners can change them, and every change is logged."

### 2:55 to 3:35. Many companies, one product

**Screen:** Click the workspace name at the top right ("Zamp Demo") to open the menu, show **Workspace settings** and **Create workspace**. Then switch to the second window (Acme) and show the empty Invoices table.

> "Ledgerline is multi-tenant. Every customer gets their own workspace, with their own members and roles. In this second window I'm signed in as a different company. Their invoice list is empty. They can't see the other company's invoices, files or rules. That isolation is checked on every query and covered by automated tests."

### 3:35 to 4:00. Close

**Screen:** Back to window 1, landing page.

> "Under the hood it's Postgres, Auth.js for sign-in, private file storage, and it ships as a Docker image, with a hundred and forty-two tests passing. What's not finished: I haven't checked the phone layout on a real device, and real ERP connectors per customer are the next step. If I joined, my first week would be connecting one real customer's purchase-order data. Thanks for watching."

## Recording tips

- **Talk slower than feels natural.** Pause one beat after each click so the viewer can see the result.
- **Do not narrate waiting.** If something takes more than 3 seconds, stay quiet or press Loom's pause.
- **If it breaks, stop and re-record.** Do not debug on camera.
- **Say what it means, not what it says:** "held for a person", not "escalate".
- **Numbers on screen will differ from run to run.** Read what is actually on the screen; do not memorise totals.
- **Title:** "Ledgerline: a payment guard for AI invoice agents (4 min)". Add one line and the repo link in the description.
- **Set the Loom link to "Anyone with the link"** and open it once in a private window before sending.

## If you want it shorter or longer

- **3 minutes:** drop the multi-tenancy section and read the close faster.
- **5 minutes:** add the live inbox load with Loom pause, and the **Stop the worker** / **Start the worker** buttons at the bottom of the landing page. They show the job being picked up again after a simulated crash, which is a strong reliability story for a finance audience.
