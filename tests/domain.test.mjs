import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  normalizeTags,
  parseCsv,
  relationshipHealth,
  summarizePipeline,
  contactsToCsv,
  slugify,
} from '../src/lib/domain.js';

test('clamp constrains numeric values and handles invalid input', () => {
  assert.equal(clamp(110, 0, 100), 100);
  assert.equal(clamp(-5, 0, 100), 0);
  assert.equal(clamp('42', 0, 100), 42);
  assert.equal(clamp('nope', 0, 100), 0);
});

test('normalizeTags deduplicates and normalizes tags', () => {
  assert.deepEqual(normalizeTags([' Priority ', 'priority', 'Indonesia']), ['priority', 'indonesia']);
  assert.deepEqual(normalizeTags('Investor, Europe, investor'), ['investor', 'europe']);
});

test('parseCsv supports quoted commas and escaped quotes', () => {
  const rows = parseCsv('first_name,last_name,notes\nJane,Doe,"Met in Paris, France"\nJohn,Smith,"Said ""hello"""');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].notes, 'Met in Paris, France');
  assert.equal(rows[1].notes, 'Said "hello"');
});

test('relationshipHealth rewards recent contact and penalizes overdue tasks', () => {
  const now = new Date('2026-07-17T12:00:00Z');
  const healthy = relationshipHealth({ lastContactAt: '2026-07-15T12:00:00Z', activityCount: 8, openDealValue: 50000, completedTasks: 2, overdueTasks: 0 }, now);
  const risky = relationshipHealth({ lastContactAt: '2026-02-01T12:00:00Z', activityCount: 1, openDealValue: 0, completedTasks: 0, overdueTasks: 3, nextFollowUpAt: '2026-07-10T12:00:00Z' }, now);
  assert.ok(healthy >= 80);
  assert.ok(risky < 35);
});

test('summarizePipeline calculates stage values and weighted forecast', () => {
  const summary = summarizePipeline([
    { stage: 'lead', value: 10000, probability: 10 },
    { stage: 'proposal', value: 20000, probability: 50 },
    { stage: 'won', value: 30000, probability: 100 },
    { stage: 'lost', value: 5000, probability: 0 },
  ]);
  assert.equal(summary.weightedValue, 11000);
  assert.equal(summary.wonValue, 30000);
  assert.equal(summary.winRate, 50);
  assert.equal(summary.byStage.proposal.count, 1);
});

test('contactsToCsv and slugify produce portable output', () => {
  const csv = contactsToCsv([{ first_name: 'Jane', last_name: 'Doe', organization: 'Acme, Inc.', tags: ['warm', 'priority'] }]);
  assert.match(csv, /"Acme, Inc\."/);
  assert.match(csv, /warm; priority/);
  assert.equal(slugify('Café & Growth Partners'), 'cafe-growth-partners');
});
