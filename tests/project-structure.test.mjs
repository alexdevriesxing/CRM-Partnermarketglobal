import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('Worker configuration includes the required Cloudflare bindings', async () => {
  const config = await read('wrangler.jsonc');
  for (const binding of ['d1_databases', 'kv_namespaces', 'r2_buckets', 'queues', 'analytics_engine_datasets', 'triggers', 'assets']) {
    assert.match(config, new RegExp(`"${binding}"`));
  }
});

test('database migration defines the core CRM entities and indexes', async () => {
  const migration = await read('migrations/0001_initial.sql');
  for (const table of ['users', 'organizations', 'contacts', 'activities', 'deals', 'tasks', 'attachments', 'audit_log']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /idx_activities_contact_time/);
});

test('main interface exposes all core CRM workspaces', async () => {
  const html = await read('public/index.html');
  for (const page of ['dashboard', 'contacts', 'organizations', 'pipeline', 'tasks', 'analytics', 'data', 'settings']) {
    assert.match(html, new RegExp(`data-page="${page}"`));
  }
});
