import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SENDER_DOMAINS,
  emailDomain,
  isAllowedSender,
  normalizeEmailList,
  parseAllowedDomains,
  plainTextFromHtml,
  recipientCount,
  validateEmailAddress,
} from '../src/lib/email.js';

test('normalizes recipient lists and removes duplicates', () => {
  assert.deepEqual(normalizeEmailList('Alice@Example.com; bob@example.com,alice@example.com'), ['alice@example.com', 'bob@example.com']);
  assert.deepEqual(normalizeEmailList([{ email: 'one@example.com' }, 'two@example.com']), ['one@example.com', 'two@example.com']);
});

test('accepts only approved sender domains', () => {
  for (const domain of DEFAULT_SENDER_DOMAINS) assert.equal(isAllowedSender(`info@${domain}`), true);
  assert.equal(isAllowedSender('info@example.com'), false);
  assert.equal(isAllowedSender('not-an-email'), false);
});

test('parses configured domain allowlists', () => {
  assert.deepEqual(parseAllowedDomains('A.com, b.com a.com'), ['a.com', 'b.com']);
  assert.deepEqual(parseAllowedDomains(''), [...DEFAULT_SENDER_DOMAINS]);
});

test('validates email addresses and counts all recipients', () => {
  assert.equal(validateEmailAddress('alex@partnermarketglobal.com'), true);
  assert.equal(validateEmailAddress('alex@'), false);
  assert.equal(emailDomain('ALEX@GoldenDragonCapital.co'), 'goldendragoncapital.co');
  assert.equal(recipientCount({ to: ['a@example.com'], cc: 'b@example.com;c@example.com', bcc: 'd@example.com' }), 4);
});

test('creates readable plain text from HTML', () => {
  assert.equal(plainTextFromHtml('<h1>Hello</h1><p>Thanks &amp; regards<br>Alex</p>'), 'Hello\nThanks & regards\nAlex');
});
