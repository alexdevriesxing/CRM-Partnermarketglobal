import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = () => readFile(new URL('../migrations/0006_detailed_reporting_indexes.sql', import.meta.url), 'utf8');

test('reporting migration is non-destructive and repeat safe', async () => {
  const sql = await migration();
  assert.match(sql, /CREATE INDEX IF NOT EXISTS/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|UPDATE /i);
});

test('reporting migration covers core date and ownership paths', async () => {
  const sql = await migration();
  for (const marker of [
    'idx_activities_workspace_time_user_account',
    'idx_deals_workspace_closed_stage_owner',
    'idx_deals_workspace_created_source_owner',
    'idx_tasks_workspace_created_completed_assignee',
    'idx_followups_workspace_created_completed_owner',
    'idx_email_messages_workspace_created_user_account',
  ]) assert.match(sql, new RegExp(marker));
});
