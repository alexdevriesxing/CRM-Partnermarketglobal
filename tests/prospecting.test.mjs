import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('prospecting schema preserves spreadsheet campaign context', async () => {
  const migration = await read('migrations/0007_prospecting_campaigns.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS prospect_campaigns/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS prospect_campaign_members/);
  assert.match(migration, /UNIQUE\(campaign_id, organization_id, contact_id, prospect_type\)/);
  assert.match(migration, /outreach_status IN \('not_contacted'.*'do_not_contact'\)/s);
});

test('prospecting API and navigation are first-class CRM features', async () => {
  const [worker, module, app, index] = await Promise.all([
    read('src/worker.js'), read('src/prospecting.js'), read('public/app.js'), read('public/index.html'),
  ]);
  assert.match(worker, /p\[1\]==='prospecting'/);
  assert.match(module, /pm\.workspace_id=\?/);
  assert.match(module, /Invalid outreach status/);
  assert.match(app, /renderProspecting/);
  assert.match(index, /data-route="prospecting"/);
  assert.doesNotMatch(await read('public/prospecting.js'), /window\.alert/);
});

test('route navigation updates every sidebar item without a selector type error', async () => {
  const app = await read('public/app.js');
  assert.match(app, /\$\$\('\.nav-item\[data-route\]'\)\.forEach/);
  assert.doesNotMatch(app, /(?<!\$)\$\('\.nav-item\[data-route\]'\)\.forEach/);
});

test('route changes dismiss a stale record drawer', async () => {
  const app = await read('public/app.js');
  assert.match(app, /if\(nextRoute!==state\.route\)closeDrawer\(\)/);
});

test('production authentication is owner-only and cannot use a bypass mode', async () => {
  const worker = await read('src/worker.js');
  const config = JSON.parse(await read('wrangler.jsonc'));
  assert.equal(config.vars.AUTH_MODE, 'access');
  assert.equal(config.vars.OWNER_EMAIL, 'alexdevriesxing@gmail.com');
  assert.match(worker, /production && mode !== 'access'/);
  assert.match(worker, /restricted to its owner/);
  assert.match(worker, /Access token has no expiry/);
});

test('production bootstrap contains no demo CRM records', async () => {
  const seed = await read('migrations/0002_seed_demo.sql');
  assert.match(seed, /alexdevriesxing@gmail\.com/);
  assert.doesNotMatch(seed, /INSERT OR IGNORE INTO (organizations|contacts|deals|activities|tasks)/);
});
