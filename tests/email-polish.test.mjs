import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MAX_EMAIL_ATTACHMENT_BYTES,
  MAX_EMAIL_ATTACHMENTS,
  attachmentMetadata,
  normalizeAttachments,
  normalizeClientRequestId,
} from '../src/lib/email.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const encoded = (bytes) => Buffer.alloc(bytes, 1).toString('base64');

test('validates idempotency keys used to prevent duplicate sends', () => {
  assert.equal(normalizeClientRequestId('request-12345678'), 'request-12345678');
  assert.equal(normalizeClientRequestId(''), null);
  assert.throws(() => normalizeClientRequestId('short'), /request ID is invalid/i);
  assert.throws(() => normalizeClientRequestId('invalid request id'), /request ID is invalid/i);
});

test('normalizes safe attachment payloads and strips content from metadata', () => {
  const attachments = normalizeAttachments([{ filename: 'proposal.pdf', type: 'application/pdf', content: encoded(1024), size_bytes: 1024 }]);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].filename, 'proposal.pdf');
  assert.equal(attachments[0].size_bytes, 1024);
  assert.deepEqual(attachmentMetadata(attachments), [{ filename: 'proposal.pdf', type: 'application/pdf', disposition: 'attachment', size_bytes: 1024 }]);
});

test('enforces conservative attachment count and size limits', () => {
  const tooMany = Array.from({ length: MAX_EMAIL_ATTACHMENTS + 1 }, (_, index) => ({ filename: `${index}.txt`, content: 'YQ==', size_bytes: 1 }));
  assert.throws(() => normalizeAttachments(tooMany), /maximum/i);
  assert.throws(() => normalizeAttachments([{ filename: 'huge.bin', content: 'YQ==', size_bytes: MAX_EMAIL_ATTACHMENT_BYTES + 1 }]), /per-file limit|combined limit/i);
});

test('D1 migration persists idempotency, attachment, and attempt metadata', async () => {
  const migration = await read('migrations/0005_email_reliability.sql');
  assert.match(migration, /client_request_id TEXT/);
  assert.match(migration, /attachments_json TEXT/);
  assert.match(migration, /recipient_count INTEGER/);
  assert.match(migration, /delivery_attempts INTEGER/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_idempotency/);
});

test('CRM delivery path is idempotent and forwards attachments privately', async () => {
  const source = await read('src/email.js');
  assert.match(source, /idempotency-key/);
  assert.match(source, /getMessageByRequestId/);
  assert.match(source, /client_request_id/);
  assert.match(source, /attachments_json/);
  assert.match(source, /normalizeAttachments/);
  assert.match(source, /'x-request-id': clientRequestId/);
  assert.match(source, /idempotent_replay/);
});

test('private Email Worker exposes health and structured attachment delivery', async () => {
  const worker = await read('src/email-worker.js');
  assert.match(worker, /url\.pathname === '\/health'/);
  assert.match(worker, /normalizeAttachments/);
  assert.match(worker, /attachments:/);
  assert.match(worker, /E_CONTENT_TOO_LARGE/);
  assert.match(worker, /X-PMG-Request-ID/);
});

test('composer restores drafts and manages sender identities', async () => {
  const composer = await read('public/email.js');
  assert.match(composer, /pmg-email-draft/);
  assert.match(composer, /data-email-edit-sender/);
  assert.match(composer, /data-email-default-sender/);
  assert.match(composer, /data-email-disable-sender/);
  assert.match(composer, /collectAttachments/);
  assert.match(composer, /idempotency-key/);
  assert.match(composer, /Use again/);
});

test('production deployment is gated by resource and domain readiness', async () => {
  const preflight = await read('scripts/preflight-production.mjs');
  const deployment = await read('.github/workflows/deploy.yml');
  assert.match(preflight, /EMAIL_DOMAINS_ONBOARDED/);
  assert.match(preflight, /REPLACE_WITH_/);
  assert.match(preflight, /goldendragoncapital\.co/);
  assert.match(preflight, /devriessalesconsultancy\.com/);
  assert.match(preflight, /OWNER_EMAIL/);
  assert.match(preflight, /allowed_sender_addresses/);
  assert.match(deployment, /npm ci/);
  assert.match(deployment, /npm run preflight:production/);
  assert.ok(deployment.indexOf('npm run preflight:production') < deployment.indexOf('npm run db:migrate:remote'));
});
