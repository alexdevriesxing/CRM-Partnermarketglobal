#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const file = path.resolve('wrangler.jsonc');
const required = {
  D1_DATABASE_ID: process.env.D1_DATABASE_ID,
  KV_NAMESPACE_ID: process.env.KV_NAMESPACE_ID,
  ACCESS_TEAM_DOMAIN: process.env.ACCESS_TEAM_DOMAIN,
  ACCESS_AUD: process.env.ACCESS_AUD,
};
const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  console.error('Example: D1_DATABASE_ID=... KV_NAMESPACE_ID=... ACCESS_TEAM_DOMAIN=team.cloudflareaccess.com ACCESS_AUD=... npm run configure');
  process.exit(1);
}

const config = JSON.parse(await fs.readFile(file, 'utf8'));
config.d1_databases[0].database_id = required.D1_DATABASE_ID;
config.kv_namespaces[0].id = required.KV_NAMESPACE_ID;
config.vars.ACCESS_TEAM_DOMAIN = required.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
config.vars.ACCESS_AUD = required.ACCESS_AUD;
await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
console.log('Updated wrangler.jsonc with Cloudflare resource and Access identifiers.');
