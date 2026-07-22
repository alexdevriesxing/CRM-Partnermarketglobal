# CRM Email Service

PartnerMarket Global CRM uses two Cloudflare Workers:

1. `partnermarket-global-crm` owns authentication, contact/account resolution, consent checks, D1 records and CRM activity logging.
2. `partnermarket-global-email-worker` is private and receives requests through a Cloudflare service binding. It sends mail through the Cloudflare Email Service `send_email` binding.

## Supported sender domains

- `goldendragoncapital.co`
- `devriessalesconsultancy.com`

The application enforces this domain list in both Workers. The Cloudflare send binding is further restricted to `info@goldendragoncapital.co` and `info@devriessalesconsultancy.com`.

## Cloudflare onboarding

For every domain:

1. Open **Cloudflare Dashboard → Compute → Email Service → Email Sending**.
2. Select **Onboard Domain**.
3. Add or approve the Cloudflare-provided SPF, DKIM, bounce-domain and DMARC records.
4. Confirm the domain is ready for sending.

Cloudflare Email Sending to arbitrary recipients requires Workers Paid. The Email Worker is intentionally configured with `workers_dev: false`, so it cannot be called as a public workers.dev endpoint.

## Deploy order

```bash
npm install
npm run validate
npm run db:migrate:remote
npm run deploy:email
npm run deploy
```

The email Worker must be deployed first because the CRM Worker has a service binding named `EMAIL_SERVICE` pointing to it.

## How CRM logging works

`POST /api/email/send` requires an account. A contact may be supplied directly or inferred from the primary recipient address. The API:

1. validates the sender identity and all recipients;
2. blocks contacts marked `do_not_contact`, `email_opt_out`, or consent `withdrawn`;
3. creates an `email_messages` record with status `queued`;
4. calls the private Email Worker;
5. updates the message with the Cloudflare `messageId` and `sent` status;
6. creates an outbound `email` record in `activities` linked to the account/contact/deal;
7. updates the account and contact `last_contact_at` values;
8. optionally creates a follow-up in **My Day**.

Failed sends remain in `email_messages` with their provider error code and reason, but are not recorded as a successful relationship touch.

## API routes

- `GET /api/email/senders`
- `POST /api/email/senders`
- `PATCH /api/email/senders/:id`
- `GET /api/email/messages`
- `POST /api/email/send`

## Default identities

Migration `0004_email_composer.sql` adds these default identities to each workspace:

- `info@goldendragoncapital.co`
- `info@devriessalesconsultancy.com`

Workspace administrators and managers can add additional identities from the composer. Cloudflare only accepts them after the underlying domain has been onboarded for Email Sending.
