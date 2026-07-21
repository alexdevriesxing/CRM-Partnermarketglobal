import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/0005_commercial_intelligence_indexes.sql', import.meta.url), 'utf8');

test('commercial intelligence indexes cover forecast and account risk queries', () => {
  assert.match(migration, /idx_deals_workspace_stage_close/);
  assert.match(migration, /deals\(workspace_id, stage, expected_close_date\)/);
  assert.match(migration, /idx_deals_workspace_account_stage_updated/);
  assert.match(migration, /organizations\(workspace_id, status, relationship_score, last_contact_at\)/);
});

test('commercial intelligence indexes cover overdue work and duplicate lookups', () => {
  assert.match(migration, /tasks\(workspace_id, organization_id, status, due_at\)/);
  assert.match(migration, /follow_ups\(workspace_id, organization_id, status, due_at, snoozed_until\)/);
  assert.match(migration, /contacts\(workspace_id, organization_id, status, email\)/);
  assert.match(migration, /organizations\(workspace_id, name, domain\)/);
});
