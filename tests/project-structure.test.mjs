import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('multi-workspace migration scopes every primary CRM entity',async()=>{
  const sql=await read('migrations/0003_multi_workspace_daily_work.sql');
  for(const table of ['organizations','contacts','activities','deals','tasks','attachments','imports','audit_log'])assert.match(sql,new RegExp(`ALTER TABLE ${table} ADD COLUMN workspace_id`));
  assert.match(sql,/CREATE TABLE IF NOT EXISTS workspaces/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS workspace_members/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS follow_ups/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS saved_views/);
});

test('frontend exposes daily work, contact log, account and workspace switching',async()=>{
  const html=await read('public/index.html');
  const js=await read('public/app.js');
  assert.match(html,/data-route="agenda"/);
  assert.match(html,/data-route="activity"/);
  assert.match(html,/id="workspaceSwitcher"/);
  assert.match(html,/id="accountSwitcher"/);
  assert.match(js,/Complete and log/);
  assert.match(js,/openFollowUpModal/);
  assert.match(js,/renderTaskRows/);
});

test('worker scopes API queries by selected workspace',async()=>{
  const worker=await read('src/worker.js');
  assert.match(worker,/x-workspace-id/);
  assert.match(worker,/workspaceContext/);
  assert.match(worker,/workspace_id=\?/);
  assert.match(worker,/follow-ups/);
  assert.match(worker,/agenda/);
});

test('Cloudflare configuration uses full worker stack',async()=>{
  const config=await read('wrangler.jsonc');
  for(const token of ['d1_databases','kv_namespaces','r2_buckets','queues','analytics_engine_datasets','triggers','observability'])assert.match(config,new RegExp(token));
});
