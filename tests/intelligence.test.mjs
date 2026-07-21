import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('commercial intelligence is a first-class CRM route', async () => {
  const [html, app, ui] = await Promise.all([read('public/index.html'), read('public/app.js'), read('public/intelligence.js')]);
  assert.match(html, /data-route="intelligence"/);
  assert.match(app, /renderCommercialIntelligence/);
  assert.match(ui, /export \{ renderCommercialIntelligence \}/);
});

test('intelligence endpoint is workspace and account scoped', async () => {
  const [worker, backend] = await Promise.all([read('src/worker.js'), read('src/intelligence.js')]);
  assert.match(worker, /p\[1\]==='intelligence'/);
  assert.match(backend, /ctx\.workspace\.id/);
  assert.match(backend, /url\.searchParams\.get\('account'\)/);
  assert.match(backend, /Account not found/);
});

test('commercial intelligence covers forecast and pipeline hygiene', async () => {
  const [backend, ui] = await Promise.all([read('src/intelligence.js'), read('public/intelligence.js')]);
  assert.match(backend, /weighted_pipeline/);
  assert.match(backend, /overdue_value/);
  assert.match(backend, /missing_next_step_count/);
  assert.match(backend, /risk_reasons/);
  assert.match(ui, /Six-month forecast/);
  assert.match(ui, /Pipeline hygiene/);
  assert.match(ui, /Opportunities requiring action/);
});

test('data quality and duplicate diagnostics are read only', async () => {
  const [backend, ui] = await Promise.all([read('src/intelligence.js'), read('public/intelligence.js')]);
  assert.match(backend, /duplicateContacts/);
  assert.match(backend, /duplicateOrganizations/);
  assert.match(backend, /qualitySummary/);
  assert.match(ui, /Data quality scorecard/);
  assert.match(ui, /Possible duplicates/);
  assert.match(ui, /No records are merged or deleted automatically/);
  assert.doesNotMatch(backend, /DELETE FROM contacts|DELETE FROM organizations|UPDATE contacts SET organization_id/i);
});

test('account risk combines relationship and overdue work signals', async () => {
  const [backend, ui] = await Promise.all([read('src/intelligence.js'), read('public/intelligence.js')]);
  assert.match(backend, /overdue_tasks/);
  assert.match(backend, /overdue_follow_ups/);
  assert.match(backend, /relationship_score<55/);
  assert.match(ui, /Accounts needing attention/);
});

test('commercial intelligence release reports v2.4.0', async () => {
  const [pkg, worker, mock] = await Promise.all([read('package.json'), read('src/worker.js'), read('scripts/dev-server.mjs')]);
  assert.equal(JSON.parse(pkg).version, '2.4.0');
  assert.match(worker, /version:'2\.4\.0'/);
  assert.match(mock, /version:'2\.4\.0'/);
});

test('risk window drives stale thresholds and sidebar attention', async () => {
  const [backend, ui] = await Promise.all([read('src/intelligence.js'), read('public/intelligence.js')]);
  assert.match(backend, /stale_after_days: days/);
  assert.match(backend, /account_inactive_after_days: accountInactivityDays/);
  assert.match(backend, /datetime\('now','\$\{modifier\}'\)/);
  assert.match(ui, /60-day risk window/);
  assert.match(ui, /intelligenceRiskCount/);
});
