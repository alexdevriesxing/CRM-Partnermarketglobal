# CRM Email Operations

This document is the production runbook for outbound CRM email from:

- `@goldendragoncapital.co`
- `@devriessalesconsultancy.com`

## Architecture

The authenticated CRM Worker validates the user, workspace, account association, contact permissions, sender identity, recipients, content, attachments, and idempotency key. It writes the queued email and CRM activity to D1 before calling the private Email Worker through the `EMAIL_SERVICE` service binding.

The private `partnermarket-global-email-worker` owns the Cloudflare `send_email` binding. It has no public `workers.dev` route and only accepts structured requests from the CRM service binding.

## Cloudflare onboarding

For every sending domain:

1. Move or confirm authoritative DNS on Cloudflare.
2. Open **Compute → Email Service → Email Sending**.
3. Add the apex sending domain.
4. Confirm the Cloudflare-created bounce MX, SPF, DKIM, and DMARC records.
5. Wait until the dashboard reports the domain as ready.
6. Send a controlled deliverability test to Gmail, Outlook, and a business mailbox.
7. Confirm SPF, DKIM, and DMARC pass in the received message headers.

Cloudflare documentation:

- https://developers.cloudflare.com/email-service/configuration/domains/
- https://developers.cloudflare.com/email-service/concepts/email-authentication/
- https://developers.cloudflare.com/email-service/api/send-emails/workers-api/

## Production deployment gate

The deployment workflow runs `npm run preflight:production`. It refuses to continue when:

- `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` is missing.
- Wrangler still contains placeholder resource IDs.
- The CRM service binding does not target the private Email Worker.
- The Email Worker lacks the `EMAIL` binding or exposes a public `workers.dev` route.
- One of the two approved domains or exact sender addresses is missing.
- GitHub environment variable `EMAIL_DOMAINS_ONBOARDED` is not exactly `true`.

Only set `EMAIL_DOMAINS_ONBOARDED=true` after both domains show Ready in Cloudflare and their authentication records resolve publicly.

## Send guarantees

- Every send has one CRM account.
- Known CRM recipients must belong to that account.
- Opted-out, do-not-contact, and withdrawn-consent contacts are blocked.
- A queued activity is written before provider delivery.
- The browser sends an idempotency key so a network retry cannot create a duplicate send.
- Cloudflare provider IDs, attempts, recipient counts, attachments, and failures are retained in D1.
- Attachments are limited to 10 files and 4 MiB decoded content in the CRM, leaving headroom under Cloudflare's 5 MiB total message limit.
- The combined To, CC, and BCC count is limited to 50.

## Failure handling

- `queued`: D1 and the CRM activity were created; delivery has not completed.
- `sent`: Cloudflare accepted the email and returned a provider message ID.
- `failed`: the provider rejected the request or the Email Worker could not deliver it.
- A repeated request with the same idempotency key returns the existing record and does not send again.
- A failed message must be duplicated into a new draft before retrying, creating a new idempotency key.

Important Cloudflare errors include sender-domain unavailable, sender not verified, suppressed recipient, content too large, rate limit, daily limit, and delivery failure. The CRM stores the provider error code and reason.

## Operational review

Weekly:

- Review failed and queued messages.
- Check Cloudflare Email Service logs and suppression lists.
- Confirm sender identities still match active staff and brands.
- Review opt-outs and consent changes.

Monthly:

- Test each sender domain.
- Review DMARC reports and authentication alignment.
- Export or archive old email activity according to the business retention policy.
- Confirm D1, KV, R2, Access, and service-binding configuration has no placeholders or stale resources.

## Email Center

The CRM navigation now includes a first-class Email Center. It provides:

- private Email Worker and provider-binding health status;
- sent, failed, queued, recipient, delivery-rate and attachment metrics;
- 14, 30 and 90-day delivery volume views;
- sender-identity performance by approved business domain;
- searchable history filtered by CRM account, status and sender;
- recent failure diagnostics;
- CSV export and message reuse;
- recoverable browser-draft visibility and direct compose actions.

The Email Center uses the same workspace and account context as the rest of the CRM. Its health endpoint exposes configuration state only and does not disclose Cloudflare credentials or message content.
