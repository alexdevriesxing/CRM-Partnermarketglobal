# Cloudflare deployment

## 1. Install and authenticate

```bash
npm install
npx wrangler login
```

For CI, use a scoped Cloudflare API token rather than interactive login.

## 2. Provision resources

Create the required resources once:

```bash
npx wrangler d1 create partnermarket-crm-db
npx wrangler kv namespace create CACHE
npx wrangler r2 bucket create partnermarket-crm-attachments
npx wrangler queues create partnermarket-crm-activity
npx wrangler queues create partnermarket-crm-activity-dlq
```

Copy the returned D1 database ID and KV namespace ID into `wrangler.jsonc`.

R2 and Queues are bound by resource name in the supplied configuration. Analytics Engine, Cron Triggers, Static Assets and Observability are configured in the same file.

## 3. Configure Cloudflare Access

In Zero Trust:

1. Add a **Self-hosted** Access application for the Worker hostname or production custom domain.
2. Add an allow policy for the identities that should use the CRM.
3. Copy the application **AUD** tag.
4. Note your Access team domain, for example `your-team.cloudflareaccess.com`.
5. Replace these values in `wrangler.jsonc`:
   - `ACCESS_TEAM_DOMAIN`
   - `ACCESS_AUD`

Production uses `AUTH_MODE=access`. Do not deploy production with `AUTH_MODE=dev`.

## 4. Apply the database schema

```bash
npm run db:migrate:remote
```

The demo seed is optional and should normally be used only for a non-production environment:

```bash
npm run db:seed:remote
```

## 5. Validate and deploy

```bash
npm run validate
npm run deploy
```

Wrangler deploys the Worker code and static assets together.

## 6. Custom domain

After the first deployment, add a Workers custom domain in Cloudflare and ensure the same hostname is protected by the Access application.

## 7. GitHub Actions

The repository includes:

- `.github/workflows/ci.yml` for syntax and automated tests
- `.github/workflows/deploy.yml` for deployment from `main`

Configure these repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The API token needs only the permissions required for the bound resources and Worker deployment. Use the narrowest practical scope.

Before enabling the deploy workflow, commit real D1/KV IDs and Access settings to `wrangler.jsonc`. IDs are resource identifiers, not API secrets; API tokens remain in GitHub Secrets.

## 8. First-user bootstrap

The first identity that successfully enters the application is automatically created as an admin. Later users default to member.

To inspect users:

```bash
npx wrangler d1 execute partnermarket-crm-db --remote \
  --command="SELECT id,email,name,role,is_active FROM users ORDER BY created_at"
```

To change a role:

```bash
npx wrangler d1 execute partnermarket-crm-db --remote \
  --command="UPDATE users SET role='manager' WHERE email='person@example.com'"
```

Allowed roles are `viewer`, `member`, `manager` and `admin`.

## 9. Post-deployment verification

Check these flows after deployment:

1. Access policy blocks unauthorized identities.
2. Authorized identity reaches the dashboard.
3. Create a contact and organization.
4. Add a call or meeting to the contact timeline.
5. Add a deal and move its stage.
6. Add and complete a follow-up task.
7. Upload and download an attachment.
8. Import a small CSV file.
9. Confirm audit rows are being written.
10. Check Worker logs, Queue delivery and the daily Cron Trigger.

## 10. Backup and operational hygiene

- Export D1 data on a regular schedule appropriate to the business.
- Configure R2 lifecycle and retention policies where required.
- Review failed Queue messages and the dead-letter queue.
- Rotate Cloudflare API tokens and remove inactive CRM users.
- Monitor Worker errors and latency in Observability.
- Keep dependencies and the Wrangler version current through reviewed pull requests.
