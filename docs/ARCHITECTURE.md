# Architecture

## Design goals

The CRM is designed around five priorities:

1. Keep every relationship and interaction queryable in one place.
2. Make follow-up discipline visible rather than relying on memory.
3. Run globally with low operational overhead on Cloudflare's edge platform.
4. Preserve a clear audit history and strong identity boundary.
5. Remain simple to deploy, extend and operate without a traditional server fleet.

## Runtime topology

```text
Browser
  │
  ├── Static HTML/CSS/JS ───────────────┐
  │                                     │
  └── /api/* requests                   │
          │                             │
Cloudflare Access                       │
          │ verified identity JWT       │
          ▼                             │
Cloudflare Worker + Static Assets ◄─────┘
  │       │       │       │       │
  │       │       │       │       └── Analytics Engine usage events
  │       │       │       └────────── Queue activity events
  │       │       └────────────────── KV JWKS/cache/rate state
  │       └────────────────────────── R2 attachments
  └────────────────────────────────── D1 CRM records + audit log

Cron Trigger ──► Worker scheduled handler ──► D1 relationship score refresh
Queue consumer ─► Worker queue handler ─────► D1 relationship score refresh
```

## Application layers

### Presentation layer

The frontend in `public/` is a dependency-free single-page application. This keeps the initial payload and build chain small while retaining modern interaction patterns:

- responsive sidebar and mobile navigation
- route-based pages without full reloads
- KPI cards and accessible SVG/CSS visualizations
- data tables, cards and kanban boards
- reusable modal forms and contact detail drawer
- light/dark theme
- native form controls and keyboard focus behavior

### API layer

`src/worker.js` owns routing, authentication, authorization, persistence and response security. It deliberately avoids a runtime framework so there is no third-party server dependency or framework-specific deployment layer.

Each API request follows this path:

1. Validate the Cloudflare Access JWT in production.
2. Resolve or provision the authenticated CRM user.
3. Check role permissions for the requested mutation.
4. Validate and normalize input.
5. Execute parameterized D1 queries.
6. Write an audit entry for material changes.
7. Emit an asynchronous activity event where relevant.
8. Record a privacy-conscious Analytics Engine datapoint.
9. Return JSON with security headers.

### Domain layer

`src/lib/domain.js` contains pure functions used by both the Worker and the test suite. It covers:

- relationship-health scoring
- weighted pipeline calculations
- stage summaries
- CSV parsing and export
- tags, dates, pagination and sorting

Keeping these rules pure makes them deterministic and inexpensive to test.

## Relational model

### Users

Provisioned from Cloudflare Access identities. The table stores an external subject, email, display name, role and active state.

### Organizations

Represents a company, investor, client, supplier, partner or prospect. It stores sector, size, website, geography, owner, lifecycle, source, tags and free-form commercial context.

### Contacts

Stores the person-level relationship, including identity, title, organization, channels, geography, owner, lifecycle, source, tags, notes, last interaction, next follow-up and a derived relationship score.

### Activities

An append-oriented timeline of calls, emails, meetings, notes, LinkedIn, WhatsApp and other relationship events. Activities can link to a contact, organization or deal.

### Deals

Commercial opportunities with value, currency, stage, probability, expected close date, owner and next step. Weighted value is calculated from value × probability.

### Tasks

Follow-ups and operational commitments linked to contacts, organizations or deals, with owner, due date, priority and completion state.

### Attachments

Metadata is stored in D1 while file bytes are stored in R2. Objects are retrieved through authorized Worker endpoints rather than public bucket access.

### Imports and audit log

Imports record source, counts and errors. The audit log records actor, action, entity and changes for traceability.

## Relationship scoring

The score is a 0–100 relationship-health indicator based on recency, future follow-up coverage and accumulated activity. It is not presented as a prediction; it is an operational prioritization aid.

Scores update in two ways:

- Queue events after relevant contact activity
- A daily Cron Trigger to account for time decay and overdue follow-ups

This design keeps interactive writes fast while ensuring scores do not become stale.

## Security architecture

### Identity

Cloudflare Access sits in front of the app. The Worker independently verifies the JWT signature, issuer and audience rather than trusting an unverified request header.

### Authorization

Roles are enforced server-side. Browser visibility does not grant permission.

### Data protection

- Parameterized D1 statements reduce injection risk.
- R2 objects are private and delivered only after authorization.
- CSP, clickjacking protection, MIME sniffing protection and referrer policy are set on responses.
- Audit entries include a one-way hash of the source IP when available.
- No platform credentials are sent to the frontend.

## Scaling model

- Workers scale request execution horizontally.
- Static assets are delivered from Cloudflare's network.
- D1 handles the relational CRM workload and indexed filters.
- R2 separates large binary objects from relational rows.
- Queues absorb non-interactive processing and retry failures.
- KV reduces repeated external key retrieval.
- Analytics Engine avoids burdening D1 with high-volume usage telemetry.

## Extension points

The current architecture is ready for incremental additions such as:

- Gmail/Outlook synchronization
- calendar meeting capture
- enrichment providers
- AI-generated meeting summaries and next-action suggestions
- configurable custom fields
- web forms and lead routing
- bulk email campaign integration
- customer portals
- multi-workspace tenancy
- webhook/API integrations
- granular permission policies

These should be introduced behind the existing Worker API and audit model rather than as direct browser-to-database integrations.
