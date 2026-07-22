# Cloudflare deployment

## Production architecture

The CRM deploys as a Worker with Static Assets, D1, KV, R2, Queues, Analytics Engine, a Cron Trigger and Observability. A second private Worker owns the Cloudflare Email Sending binding. Cloudflare Access protects the public CRM hostname, and the application independently restricts production access to `OWNER_EMAIL`.

## Provisioning

Authenticate and create the named resources once:

```bash
npm install
npx wrangler login
npx wrangler d1 create partnermarket-crm-db
npx wrangler kv namespace create partnermarket-crm-cache
npx wrangler r2 bucket create partnermarket-crm-attachments
npx wrangler queues create partnermarket-crm-activity-dlq
npx wrangler queues create partnermarket-crm-activity
```

Put the returned D1 and KV identifiers in `wrangler.jsonc`. R2 and Queue bindings use their resource names.

## Owner-only Cloudflare Access

In Zero Trust:

1. Create a Self-hosted Access application for the final Worker hostname.
2. Create an Allow policy containing only `alexdevriesxing@gmail.com`.
3. Copy the application AUD tag into `ACCESS_AUD`.
4. Copy the team domain, such as `your-team.cloudflareaccess.com`, into `ACCESS_TEAM_DOMAIN`.
5. Keep `AUTH_MODE=access`, `ENVIRONMENT=production`, and `OWNER_EMAIL=alexdevriesxing@gmail.com`.

The Worker refuses a production bypass mode and rejects a valid Access identity that is not the configured owner.

## Database and private spreadsheet seed

Apply migrations first:

```bash
npm run db:migrate:remote
```

The repository bootstrap contains only the owner and workspace. The commercial workbook is intentionally excluded from this public repository. Generate and execute its idempotent SQL chunks from a private location; never add those files to Git.

Expected initial production counts are 14 campaigns, 700 campaign memberships, 553 deduplicated accounts, 560 contacts, one user and two sender identities.

## Email deployment order

Enable and authenticate both domains, then deploy the private Email Worker before the CRM Worker:

```bash
npx wrangler email sending enable goldendragoncapital.co
npx wrangler email sending enable devriessalesconsultancy.com
npm run validate
npm run preflight:production
npm run deploy:email
npm run deploy
```

Only set `EMAIL_DOMAINS_ONBOARDED=true` after the return-path MX, SPF, DKIM and DMARC records resolve publicly for both domains.

## GitHub Actions

The manual production workflow requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub environment secrets and `EMAIL_DOMAINS_ONBOARDED=true` as a production environment variable. Use a narrowly scoped token that can deploy Workers and apply D1 migrations. Private prospect SQL is not run in CI.

## Post-deployment verification

1. Confirm an anonymous API request is rejected and the owner can complete Access login.
2. Verify the dashboard, Prospecting, Accounts, Email Center and Analytics routes.
3. Confirm D1 row counts and that no demo records exist.
4. Change one prospect outreach state and edit an account.
5. Send one controlled message from each approved identity to the owner mailbox.
6. Confirm provider message IDs, CRM activities, SPF, DKIM and DMARC results.
7. Upload and download a small attachment and inspect Worker/Queue logs.

## Operations

- Export D1 on a regular schedule and test restore procedures.
- Review failed email, Queue dead letters, opt-outs and consent changes.
- Rotate Cloudflare and GitHub credentials, keep dependencies current, and review Observability errors.
- Keep the private workbook and generated SQL outside the public repository.
