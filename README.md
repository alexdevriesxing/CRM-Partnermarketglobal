# PartnerMarket Global CRM

A comprehensive, Cloudflare-native relationship CRM for PartnerMarketGlobal. It combines contact and organization management, a chronological interaction log, pipeline tracking, follow-up tasks, imports/exports, relationship scoring, analytics, file attachments, role-based access and a complete audit trail in one responsive web application.

## What is included

- **Executive dashboard** with relationship, activity, task and pipeline KPIs
- **Contact management** with ownership, tags, lifecycle, source, geography and relationship health
- **Contact history** for calls, emails, meetings, notes, WhatsApp, LinkedIn and status changes
- **Organization intelligence** for clients, investors, partners, suppliers and prospects
- **Deal pipeline** with stages, probability, weighted value, expected close date and kanban workflow
- **Tasks and follow-ups** with owner, due date, priority and completion tracking
- **Analytics** for engagement, activity mix, pipeline performance, sources and team output
- **Global search** across contacts, companies and deals
- **CSV import/export** with an included contact template
- **R2 attachments** linked to contacts and activities
- **Cloudflare Access authentication** with viewer, member, manager and admin roles
- **Audit history** for material changes
- **Automated relationship scoring** through Queue events and a daily Cron Trigger
- **Responsive, accessible UI** with light/dark theme and keyboard-friendly controls

## Cloudflare architecture

| Layer | Cloudflare service | Purpose |
|---|---|---|
| Application and API | Workers | Serves the SPA, REST API, authentication and business logic |
| Static frontend | Workers Static Assets | Ships the HTML, CSS and JavaScript alongside the Worker |
| Relational storage | D1 | Contacts, organizations, activities, deals, tasks, imports and audit logs |
| File storage | R2 | Contact and activity attachments |
| Fast state | Workers KV | Access JWKS cache, lightweight caching and rate-limit state |
| Async processing | Queues | Activity events and relationship-score recalculation |
| Product telemetry | Analytics Engine | Privacy-conscious request and product usage events |
| Scheduled processing | Cron Triggers | Daily relationship health refresh and overdue-state maintenance |
| Identity perimeter | Cloudflare Access | SSO, identity assertions and application protection |
| Operations | Workers Observability | Logs, traces and runtime inspection |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production setup.

## Local development

### Prerequisites

- Node.js 20 or newer
- A Cloudflare account with Workers enabled
- Wrangler authentication for Cloudflare-backed local development

### Fast UI/API preview without Cloudflare credentials

```bash
npm run dev:mock
```

Open `http://localhost:8787`. This starts an in-memory development server with demo contacts, organizations, deals, activities and tasks.

### Full Wrangler development

```bash
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

The `dev` script runs with local development authentication. Wrangler persists local D1/KV/R2 data under `.wrangler/`.

## Validate the project

```bash
npm install
npm run validate
```

The validation suite checks JavaScript syntax, domain rules, CSV behavior, API CRUD flows, activity history, deal and task updates, imports, SPA routes, schema integrity and Cloudflare bindings.

## Production deployment

1. Provision the required Cloudflare resources.
2. Replace the placeholder IDs and Access settings in `wrangler.jsonc`.
3. Configure Cloudflare Access for the production Worker hostname or custom domain.
4. Apply D1 migrations.
5. Deploy the Worker.

```bash
npm install
npm run db:migrate:remote
npm run deploy
```

For exact commands and GitHub Actions secrets, follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Authentication and roles

Production defaults to `AUTH_MODE=access`. The Worker validates Cloudflare Access JWTs against your team JWKS and application audience before API access is allowed.

The first authenticated account is provisioned as `admin`; subsequent accounts default to `member`. Roles can be changed directly in D1 or through a future admin user-management workflow.

| Role | Capabilities |
|---|---|
| Viewer | Read CRM information and analytics |
| Member | Create and update contacts, activities, tasks and deals |
| Manager | Member capabilities plus broader commercial management actions |
| Admin | Full workspace and user administration |

## Data model

The core relational model is deliberately normalized:

- `organizations` have many `contacts`
- contacts and organizations can have many `activities`, `deals`, `tasks` and `attachments`
- every material mutation can create an `audit_log` entry
- imports are tracked in `imports`
- `users` are provisioned from verified Cloudflare Access identities

Database definitions live in `migrations/0001_initial.sql`; realistic demo data lives in `migrations/0002_seed_demo.sql`.

## API surface

The Worker exposes REST endpoints under `/api` for dashboard data, analytics, search, contacts, organizations, activities, deals, tasks, imports, attachments and users. All production API routes require a valid Cloudflare Access identity.

## CSV import

Download `public/contact-import-template.csv`, populate the rows and upload it from **Import & export**. Supported contact fields include first name, last name, email, phone, title, organization, country, city, lifecycle, source, owner, tags and notes.

## Security notes

- Access JWTs are verified cryptographically and audience-checked.
- Security headers and a restrictive Content Security Policy are applied centrally.
- Audit entries record actor, entity, action and a hashed request IP where available.
- Attachments use R2 object keys rather than public bucket URLs.
- Secrets belong in Wrangler secrets or GitHub Actions secrets, never in the repository.
- The application does not expose direct D1, KV or R2 credentials to the browser.

## Repository structure

```text
.github/workflows/   CI and Cloudflare deployment workflows
docs/                Architecture and deployment documentation
migrations/          D1 schema and demo seed
public/              Responsive single-page CRM frontend
scripts/             Mock server and Cloudflare configuration helpers
src/                 Worker API and reusable domain logic
tests/               Node test suite
wrangler.jsonc       Cloudflare Worker and resource bindings
```

## License

Proprietary software for PartnerMarketGlobal. See [LICENSE](LICENSE).
