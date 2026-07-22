# Security best-practices audit

## Executive summary

The CRM is suitable for a single-owner Cloudflare deployment after the documented Access and DNS steps are completed. No unresolved critical, high or medium code findings remain. The review fixed production authentication bypass risk, over-broad email sender configuration, unbounded JSON bodies, cross-site browser writes, unsafe download filename handling, demo-data contamination and vulnerable development dependencies. `npm audit` reports zero known dependency vulnerabilities.

The most important operational control is Cloudflare Access: the application also checks `OWNER_EMAIL`, but Access must still be configured for the deployed hostname before the CRM is considered ready.

## Remediated findings

### [High] Production could auto-provision additional authenticated users

The original code trusted any valid Access identity and automatically created a user. Production now rejects non-Access auth modes, requires an expiring RS256 token with the configured audience, and permits only the configured owner email (`src/worker.js:67-126`). The database bootstrap contains only the owner (`migrations/0002_seed_demo.sql:1-4`).

### [High] Public migration contained demo CRM records

The original migration would have inserted fictitious organizations, contacts, deals, activities and tasks into a new production database. `migrations/0002_seed_demo.sql:1-4` now contains only the owner bootstrap. Commercial spreadsheet data is generated and imported from a private path that is excluded by `.gitignore`.

### [Medium] Outbound sender scope was broader than requested

The configuration allowed a third domain and an unrestricted Email Sending binding. `wrangler.email.jsonc:8-18` now restricts the provider binding to the two exact approved `info@` identities. The private Worker validates its allowlist (`src/email-worker.js:52-67`), while the CRM Worker enforces the same sender scope plus consent/opt-out rules (`src/email.js:35-62`, `src/email.js:362-367`).

### [Medium] JSON request bodies were unbounded

Authenticated routes now cap ordinary JSON at 2 MiB (`src/worker.js:32-40`). Email requests and the private Email Worker cap encoded message requests at 6 MiB while attachment normalization retains the stricter 4 MiB decoded limit (`src/email.js:18-28`, `src/email-worker.js:26-35`, `src/lib/email.js:63-86`).

### [Medium] Browser write endpoints lacked an explicit origin check

Mutating API requests now reject cross-site Fetch Metadata and mismatched Origin headers before authentication (`src/worker.js:46-54`, `src/worker.js:489`). Cloudflare Access remains the primary authentication boundary.

### [Low] Attachment filenames could reach Content-Disposition with insufficient normalization

Downloaded filenames now strip CR, LF, quotes and backslashes, and attachment responses use private no-store caching (`src/worker.js:479`).

### [Low] Dependency audit reported vulnerable transitive image tooling

Wrangler was updated and Sharp is overridden to a patched release. The lockfile audit currently reports zero vulnerabilities.

## Residual low-risk observations

- The Content Security Policy allows inline styles because the current UI uses inline layout and progress values. Scripts remain restricted to same-origin sources and dynamic CRM content is HTML-escaped. Removing `style-src 'unsafe-inline'` would require a broader styling refactor.
- The application retains multi-workspace and role-capable schema from the original CRM, although production access is owner-only. This is inactive complexity rather than an exposed authorization path.
- Email addresses in the supplied workbook are public/general business inboxes. Consent is initialized as unknown, opt-outs are enforced, and the CRM does not perform automatic bulk sends; legal and deliverability review remains an operator responsibility.

## Verification checklist

- Automated syntax and unit/integration suite passes.
- Clean-room D1 migrations and the private workbook import pass with expected row counts.
- Dependency audit reports zero vulnerabilities.
- Confirm Access policy allows only the owner and anonymous `/api/me` is rejected.
- Confirm both email domains publish return-path MX, SPF, DKIM and DMARC before live send tests.
- Confirm controlled messages from both senders record provider IDs and pass SPF/DKIM/DMARC in the owner mailbox.
