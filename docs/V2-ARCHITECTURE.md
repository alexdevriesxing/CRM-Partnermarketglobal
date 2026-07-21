# CRM V2 Architecture

## Product model

The CRM separates three concepts clearly:

1. **Workspace / database** — the isolated CRM dataset.
2. **Account** — a company, investor, partner, client, supplier or prospect.
3. **Contact** — a person connected to an account.

The selected workspace scopes every server query. The selected account acts as a user-controlled focus filter across contacts, pipeline, tasks and contact history.

## Daily work model

### Follow-ups

Follow-ups represent the next required relationship action. They are separate from generic tasks because they carry a communication channel and relationship context. They support:

- open, snoozed, completed and cancelled states
- email, call, meeting, WhatsApp, LinkedIn and other channels
- priority and owner
- due date and snooze date
- daily, weekly, monthly and quarterly cadence
- contact, account and deal links

### Tasks

Tasks represent execution work. They support:

- open, in-progress, completed and cancelled states
- task, call, email, meeting, administration, research and other types
- start, due and reminder timestamps
- recurrence and parent-task linkage
- effort estimates and ordering
- contact, account and deal context

### Contact log

Activities are append-oriented relationship records. Completing a follow-up can atomically trigger an activity write at the API workflow level, keeping work completion and relationship history synchronized.

## Workspace isolation

`workspace_members` controls access. The Worker resolves the selected workspace from `x-workspace-id`, verifies membership and injects the resolved workspace into every operation.

All primary records include a `workspace_id`:

- organizations
- contacts
- activities
- deals
- tasks
- follow-ups
- attachments
- imports
- saved views
- goals
- audit entries

The browser cannot bypass workspace isolation because D1 queries are scoped in the Worker.

## Security

- Cloudflare Access JWT signatures, issuer and audience are verified.
- Workspace membership and role checks are enforced server-side.
- D1 statements are parameterized.
- R2 objects remain private and are served through authenticated Worker routes.
- Audit logs include user, workspace, action, entity, before/after state and a hashed source IP.
- CSP, anti-clickjacking, MIME-sniffing and permissions headers are set centrally.

## Extensibility

The data model already includes saved views and workspace goals. Natural next modules include email/calendar sync, campaign lists, configurable custom fields, webhook ingestion and product catalog support.
