# CRM V2 Deployment

## Upgrade an existing deployment

1. Pull the V2 main branch.
2. Back up the D1 database.
3. Apply migrations:

```bash
npm install
npm run db:migrate:remote
```

4. Confirm the default workspace exists and existing records have `workspace_id='workspace-default'`.
5. Run validation:

```bash
npm run validate
```

6. Trigger **Deploy to Cloudflare** manually in GitHub Actions.

## Required Cloudflare resources

- D1 database: `partnermarket-crm-db`
- KV namespace bound as `CACHE`
- R2 bucket: `partnermarket-crm-attachments`
- Queue: `partnermarket-crm-activity`
- Dead-letter queue: `partnermarket-crm-activity-dlq`
- Analytics Engine dataset: `partnermarket_crm_usage`
- Cloudflare Access application and audience

## Required GitHub secrets

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Physical database separation

V2 uses logically isolated workspaces inside one D1 database for instant switching. For regulatory or organizational requirements that demand physical separation, create Wrangler environments with separate D1 bindings and deploy one environment per database. The application and schema remain identical.
