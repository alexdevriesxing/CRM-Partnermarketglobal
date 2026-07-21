# PartnerMarket Global CRM V2

A comprehensive, Cloudflare-native, multi-workspace CRM for managing commercial relationships, accounts, contacts, follow-ups, contact history, tasks, opportunities and analytics.

## What V2 adds

- **My Day**: one prioritized workspace for overdue, due-today and upcoming follow-ups and tasks
- **Follow-ups as first-class records** with channel, owner, priority, cadence, snoozing and one-click completion
- **Contact Log**: searchable chronological history for calls, emails, meetings, WhatsApp, LinkedIn, notes, files, outcomes, sentiment and next steps
- **Robust tasks** with type, assignee, priority, status, start/due/reminder dates, recurrence, estimates and CRM links
- **Multi-workspace databases**: logically isolated workspaces with their own contacts, accounts, activities, deals, tasks, files and analytics
- **Account focus switcher**: instantly scope contact, log, pipeline and work screens to one organization
- **Account intelligence** with tiers, territories, buying committees, pipeline, open work and relationship health
- **Contact intelligence** with consent status, communication preferences, source, health, work queues and full timeline
- **Unified completion workflow**: complete a follow-up and write the contact log in one action
- **Saved-view data model**, workspace goals and improved auditability
- **Polished responsive UI** with light/dark modes, command search and desktop/mobile layouts

## Cloudflare stack

| Layer | Service |
|---|---|
| Application and REST API | Workers |
| Frontend | Workers Static Assets |
| CRM relational data | D1 |
| Private attachments | R2 |
| Access JWKS and fast state | KV |
| Relationship score processing | Queues |
| Product telemetry | Analytics Engine |
| Daily maintenance | Cron Triggers |
| Authentication | Cloudflare Access |
| Runtime inspection | Workers Observability |

## Multi-workspace model

A workspace is a logically separate CRM database. Every primary record carries a `workspace_id`, and every API query is scoped server-side to the selected workspace. Users switch databases from the sidebar through the `x-workspace-id` request context.

This design provides fast switching and strict logical separation inside one D1 database. Teams needing physically separate D1 databases can deploy one Worker environment per database using the same codebase and separate Wrangler environments.

## Core workflows

### Follow-up workflow

1. Schedule a follow-up against a contact, account or deal.
2. It appears in **My Day** as overdue, today or upcoming.
3. Complete it with an interaction type, outcome and notes.
4. The CRM marks the follow-up complete and writes the contact log simultaneously.
5. Recurring follow-ups automatically create the next occurrence.

### Contact log

Every call, email, meeting, message or note records:

- date and time
- direction
- contact, account and deal links
- subject and notes
- outcome and sentiment
- next step
- optional follow-up date

### Tasks

Tasks include ownership, type, priority, status, start date, due date, reminder, recurrence, estimates and links to contacts, accounts and deals.

## Local preview

```bash
npm install
npm run dev:mock
```

Open `http://localhost:8787`.

The mock server includes two workspaces so database switching, account focus, follow-up completion and task workflows can be tested without Cloudflare credentials.

## Validation

```bash
npm run validate
```

The test suite covers:

- relationship scoring
- follow-up due buckets and agenda grouping
- recurring tasks and follow-ups
- pipeline forecasting
- CSV import/export
- multi-workspace schema isolation
- frontend workflow structure
- mock API database switching
- contact-log creation from follow-up completion
- task creation and completion

## Production upgrade

Existing installations apply `migrations/0003_multi_workspace_daily_work.sql`. The migration creates a default PartnerMarket Global workspace and assigns all existing records and users to it, preserving the current CRM data.

Before deployment, replace placeholder binding IDs and Access settings in `wrangler.jsonc`, apply D1 migrations and trigger the manual Cloudflare deployment workflow.

See [docs/V2-ARCHITECTURE.md](docs/V2-ARCHITECTURE.md) and [docs/V2-DEPLOYMENT.md](docs/V2-DEPLOYMENT.md).

## Integrated business email

CRM users can compose email from approved identities on **goldendragoncapital.co**, **devriessalesconsultancy.com**, and **partnermarketglobal.com**. A private Cloudflare Email Worker performs delivery while the CRM Worker resolves the account/contact, applies consent rules, records provider status, and writes successful sends into the chronological contact log.

Deploy the private worker before the CRM worker:

```bash
npm run db:migrate:remote
npm run deploy:email
npm run deploy
```

See [docs/EMAIL-SERVICE.md](docs/EMAIL-SERVICE.md) for domain onboarding, DNS authentication, deployment, and logging details.
