# Ledgerline: Loom recording script (4 minutes, with speech)

Word-for-word narration with screen actions. About 480 words spoken, which fills 4:00 once you add the pauses for clicks and loading. Read it naturally, do not recite. Say "[your name]" as your own name.

## Before you hit record (5 minutes)

1. `docker compose --profile dev up -d`, `npm run db:migrate`, `DEMO_USERS=1 npm run db:seed`, `npm run dev`.
2. Chrome: full screen, zoom 100%, bookmarks bar hidden, no extensions (use a fresh profile or guest window), notifications off.
3. Window 1: signed in as `admin@ledgerline.demo` / `ledgerline`, on `/`.
4. Window 2: private window, signed in as `acme-owner@ledgerline.demo` / `ledgerline`.
5. Do one full dry run without recording. Loom lets you re-record, so a stumble is fine. Aim for calm, not perfect.
6. Loom: choose "Screen + camera bubble" (face in the corner helps a founder remember you), 1080p, mic check.

## Script

### 0:00 to 0:25. Landing page (`/`)

**Screen:** Landing page, headline visible. Do not scroll.

> "Hi, I'm [your name]. I built Ledgerline for Zamp. Finance teams are starting to let AI agents handle invoices, and the question every finance leader asks is the same: what stops the agent from paying the wrong thing? Ledgerline is my answer. It's a payment guard that sits between the agent and the money."

### 0:25 to 1:10. Load the week

**Screen:** Scroll to "Run the Friday demo", click load, let the numbers move.

> "Here's a normal Friday inbox. I'll load a week of invoices. The agent reads each PDF, pulls out the vendor, the amount and the purchase order, and checks it against what was actually ordered. Watch these numbers: how many it cleared by itself, how many it held for a person, and how much money it kept from going out the door."

*(Pause and let the numbers settle for two seconds.)*

### 1:10 to 2:10. A bad payment, stopped

**Screen:** Top bar, click **Invoices**, open the near-duplicate invoice. Point with the cursor at the PDF, then the decision, then the audit trail.

> "Let me open one it stopped. This invoice has a brand new invoice number, so a simple duplicate check would wave it through. But it's from the same vendor, and the amount is within one percent of one we already paid. The guard held it.
> On the left is the original PDF. On the right is the decision, and the reason, in plain English. Down here is the audit trail: every step, what did it, and when. That is what makes an AI decision something a controller or an auditor can actually accept."

### 2:10 to 2:55. A person decides

**Screen:** Show the three buttons. Click **Block payment**. Then click **Guard rules** in the top bar.

> "The agent doesn't get the last word on risky money. A person chooses: release as proposed, override and release in full, or block the payment. I'll block this one, and it's recorded under my name.
> The limits behind these decisions live in Guard rules: how much an admin can release, how confident the agent has to be, how much price difference to tolerate. Only owners can change them, and every change is logged."

### 2:55 to 3:35. Many companies, one product

**Screen:** Click the workspace name in the header, show the switcher. Then switch to Window 2 (Acme) and show the empty queue.

> "Ledgerline is multi-tenant. Every customer gets their own workspace, and I can switch between them here. In this second window I'm signed in as a different company. Their queue is empty. They can't see the other company's invoices, files or rules. That isolation is checked on every query and covered by automated tests."

### 3:35 to 4:00. Close

**Screen:** Back to Window 1, landing page or Invoices list.

> "Under the hood it's Postgres, Auth.js for sign-in, private file storage, and it ships as a Docker image, with a hundred and forty-two tests passing. What's not finished: I haven't checked the phone layout on a real device, and real ERP connectors per customer are the next step. If I joined, my first week would be connecting one real customer's purchase-order data. Thanks for watching."

## Recording tips

- **Talk slower than feels natural.** Pause one beat after each click so the viewer can see the result.
- **Do not narrate loading.** If something takes more than 3 seconds, stay quiet or say "give it a moment" and carry on.
- **If it breaks, stop and re-record.** Do not debug on camera. Use Loom's trim to cut a dead start.
- **Do not read the screen.** Say what it means ("held for a person"), not what it says.
- **Title and description:** Title it "Ledgerline: a payment guard for AI invoice agents (4 min)". In the description add one line on what it is and the repo link.
- **Set the Loom link to "Anyone with the link"** before you send it, and open it once in a private window to check.

## If you want it shorter or longer

- **3 minutes:** drop the multi-tenancy section and read the close faster.
- **5 minutes:** add the Guard rules audit log and the invite link in Workspace settings (see `DEMO.md`).
