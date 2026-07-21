import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('email schema links every message to a CRM account', async () => {
  const migration = await read('migrations/0004_email_composer.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS email_sender_identities/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS email_messages/);
  assert.match(migration, /organization_id TEXT NOT NULL REFERENCES organizations\(id\)/);
  assert.match(migration, /activity_id TEXT REFERENCES activities\(id\)/);
  for (const domain of ['goldendragoncapital.co', 'devriessalesconsultancy.com', 'partnermarketglobal.com']) {
    assert.match(migration, new RegExp(domain.replaceAll('.', '\\.')));
  }
});

test('CRM Worker calls the private Email Worker through a service binding', async () => {
  const mainConfig = JSON.parse(await read('wrangler.jsonc'));
  const emailConfig = JSON.parse(await read('wrangler.email.jsonc'));
  assert.deepEqual(mainConfig.services, [{ binding: 'EMAIL_SERVICE', service: 'partnermarket-global-email-worker' }]);
  assert.deepEqual(emailConfig.send_email, [{ name: 'EMAIL' }]);
  assert.equal(emailConfig.workers_dev, false);
  assert.equal(emailConfig.main, 'src/email-worker.js');
});

test('email API enforces consent and logs successful delivery', async () => {
  const source = await read('src/email.js');
  assert.match(source, /email_opt_out/);
  assert.match(source, /status === 'do_not_contact'/);
  assert.match(source, /consent_status === 'withdrawn'/);
  assert.match(source, /INSERT INTO activities/);
  assert.match(source, /organization_id/);
  assert.match(source, /UPDATE organizations SET last_contact_at/);
  assert.match(source, /UPDATE contacts SET last_contact_at/);
  assert.match(source, /status='failed'/);
  assert.match(source, /provider_message_id/);
});

test('main API exposes sender, message and send endpoints', async () => {
  const worker = await read('src/worker.js');
  for (const handler of ['listEmailSenders', 'createEmailSender', 'updateEmailSender', 'listEmailMessages', 'sendCrmEmail']) {
    assert.match(worker, new RegExp(handler));
  }
  assert.match(worker, /p\[1\]==='email'.*p\[2\]==='send'/s);
});

test('composer is included in the application and deployment publishes email first', async () => {
  const index = await read('public/index.html');
  const composer = await read('public/email.js');
  const deployment = await read('.github/workflows/deploy.yml');
  assert.match(index, /<script src="\/email\.js" type="module"><\/script>/);
  assert.match(composer, /Send and log email/);
  assert.match(composer, /data-compose-email/);
  const emailDeploy = deployment.indexOf('npm run deploy:email');
  const crmDeploy = deployment.indexOf('npm run deploy\n');
  assert.ok(emailDeploy >= 0, 'Email Worker deployment step is missing');
  assert.ok(crmDeploy > emailDeploy, 'CRM Worker must deploy after the Email Worker');
});
