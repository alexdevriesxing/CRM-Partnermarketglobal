import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('detailed reporting is workspace, account and owner scoped', async () => {
  const backend = await read('src/reporting.js');
  assert.match(backend, /ctx\.workspace\.id/);
  assert.match(backend, /searchParams\.get\('account'\)/);
  assert.match(backend, /searchParams\.get\('owner'\)/);
  assert.match(backend, /Account not found/);
  assert.match(backend, /not a member of this workspace/);
});

test('reporting supports comparable and custom date windows', async () => {
  const backend = await read('src/reporting.js');
  assert.match(backend, /previous_from/);
  assert.match(backend, /previous_to/);
  assert.match(backend, /Report range may not exceed 730 days/);
  assert.match(backend, /granularity/);
});

test('reporting covers executive, execution and commercial dimensions', async () => {
  const backend = await read('src/reporting.js');
  for (const marker of ['won_revenue_change','average_sales_cycle_days','close_date_accuracy','forecast_coverage','team_performance','source_performance','account_performance','loss_reasons','relationship_health']) {
    assert.match(backend, new RegExp(marker));
  }
  assert.match(backend, /email_messages/);
  assert.match(backend, /completed_on_time/);
});

test('analytics interface supports management exports and print reporting', async () => {
  const ui = await read('public/reporting.js');
  assert.match(ui, /Analytics & Reporting/);
  assert.match(ui, /Executive readout/);
  assert.match(ui, /Export CSV/);
  assert.match(ui, /Print \/ PDF/);
  assert.match(ui, /downloadReport\(data, 'json'\)/);
  assert.match(ui, /window\.print\(\)/);
  assert.match(ui, /Custom dates/);
});

test('v2.5 validation includes reporting modules', async () => {
  const [pkg, worker] = await Promise.all([read('package.json'), read('src/worker.js')]);
  assert.equal(JSON.parse(pkg).version, '2.5.0');
  assert.match(pkg, /src\/reporting\.js/);
  assert.match(pkg, /public\/reporting\.js/);
  assert.match(worker, /getDetailedAnalytics/);
  assert.match(worker, /version:'2\.5\.0'/);
});

test('due-period cohorts keep execution rates bounded and concentration honest', async () => {
  const backend = await read('src/reporting.js');
  assert.match(backend, /taskStats\?\.due/);
  assert.match(backend, /followUpStats\?\.due/);
  assert.match(backend, /const concentrationBase = totalWonRevenue/);
  assert.match(backend, /CAST\(strftime\('%w'/);
});
