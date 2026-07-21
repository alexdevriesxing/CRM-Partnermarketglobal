import { readFile } from 'node:fs/promises';

const requiredDomains = [
  'goldendragoncapital.co',
  'devriessalesconsultancy.com',
  'partnermarketglobal.com',
];

const errors = [];
const mainConfig = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const emailConfig = JSON.parse(await readFile(new URL('../wrangler.email.jsonc', import.meta.url), 'utf8'));
const serialized = JSON.stringify({ mainConfig, emailConfig });

if (!process.env.CLOUDFLARE_API_TOKEN) errors.push('CLOUDFLARE_API_TOKEN is missing.');
if (!process.env.CLOUDFLARE_ACCOUNT_ID) errors.push('CLOUDFLARE_ACCOUNT_ID is missing.');
if (String(process.env.EMAIL_DOMAINS_ONBOARDED || '').toLowerCase() !== 'true') {
  errors.push('EMAIL_DOMAINS_ONBOARDED must be set to true after all three domains show Ready in Cloudflare Email Sending.');
}
if (/REPLACE_WITH_/i.test(serialized)) errors.push('Wrangler configuration still contains REPLACE_WITH_* placeholders.');

const configuredDomains = String(mainConfig.vars?.EMAIL_ALLOWED_DOMAINS || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
for (const domain of requiredDomains) {
  if (!configuredDomains.includes(domain)) errors.push(`EMAIL_ALLOWED_DOMAINS is missing ${domain}.`);
}

const emailBinding = emailConfig.send_email?.find((binding) => binding.name === 'EMAIL');
if (!emailBinding) errors.push('The private Email Worker is missing its EMAIL send_email binding.');
const serviceBinding = mainConfig.services?.find((binding) => binding.binding === 'EMAIL_SERVICE');
if (serviceBinding?.service !== emailConfig.name) errors.push('The CRM EMAIL_SERVICE binding does not target the configured Email Worker.');
if (emailConfig.workers_dev !== false) errors.push('The private Email Worker must keep workers_dev=false.');

if (errors.length) {
  console.error('\nProduction preflight failed:\n');
  for (const issue of errors) console.error(`- ${issue}`);
  console.error('\nSee docs/EMAIL-OPERATIONS.md before deploying.\n');
  process.exit(1);
}

console.log('Production preflight passed. Cloudflare resources, service bindings, and domain readiness are confirmed.');
