import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import { getDetailedAnalytics } from '../src/reporting.js';

class D1Statement {
  constructor(statement) {
    this.statement = statement;
    this.parameters = [];
  }
  bind(...parameters) {
    this.parameters = parameters;
    return this;
  }
  async first() {
    return this.statement.get(...this.parameters) || null;
  }
  async all() {
    return { results: this.statement.all(...this.parameters) };
  }
}

class D1Database {
  constructor(database) {
    this.database = database;
  }
  prepare(sql) {
    return new D1Statement(this.database.prepare(sql));
  }
}

async function migratedDatabase() {
  const database = new DatabaseSync(':memory:');
  const directory = new URL('../migrations/', import.meta.url);
  const migrations = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const migration of migrations) database.exec(await readFile(new URL(migration, directory), 'utf8'));
  return database;
}

test('detailed reporting executes against the fully migrated CRM schema', async () => {
  const database = await migratedDatabase();
  const now = new Date();
  const iso = (offsetDays = 0) => new Date(now.getTime() + offsetDays * 86400000).toISOString();
  const date = (offsetDays = 0) => iso(offsetDays).slice(0, 10);

  database.prepare(`INSERT INTO users (id,email,name,role) VALUES (?,?,?,?)`).run('u1','owner@example.com','Report Owner','admin');
  database.prepare(`INSERT INTO workspaces (id,name,slug,currency,timezone,color,created_by) VALUES (?,?,?,?,?,?,?)`).run('ws1','Reporting Workspace','reporting','EUR','Europe/Amsterdam','#0f766e','u1');
  database.prepare(`INSERT INTO workspace_members (workspace_id,user_id,role,is_default) VALUES (?,?,?,1)`).run('ws1','u1','admin');
  database.prepare(`INSERT INTO organizations (id,workspace_id,name,status,owner_id,relationship_score,account_tier) VALUES (?,?,?,?,?,?,?)`).run('o1','ws1','Example Account','active','u1',72,'key');
  database.prepare(`INSERT INTO contacts (id,workspace_id,organization_id,first_name,last_name,email,status,owner_id,relationship_score,lifecycle_stage,consent_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('c1','ws1','o1','Taylor','Buyer','buyer@example.com','active','u1',68,'opportunity','legitimate_interest');
  database.prepare(`INSERT INTO deals (id,workspace_id,name,organization_id,primary_contact_id,owner_id,stage,value,currency,probability,expected_close_date,closed_at,next_step,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('d1','ws1','Won Opportunity','o1','c1','u1','won',50000,'EUR',100,date(-3),iso(-2),'Expansion planning','Referral',iso(-45),iso(-2));
  database.prepare(`INSERT INTO deals (id,workspace_id,name,organization_id,primary_contact_id,owner_id,stage,value,currency,probability,expected_close_date,next_step,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('d2','ws1','Open Opportunity','o1','c1','u1','proposal',80000,'EUR',60,date(20),'Send revised offer','Website',iso(-15),iso(-1));
  database.prepare(`INSERT INTO activities (id,workspace_id,contact_id,organization_id,user_id,type,direction,subject,occurred_at,duration_minutes) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('a1','ws1','c1','o1','u1','meeting','outbound','Commercial review',iso(-1),45);
  database.prepare(`INSERT INTO tasks (id,workspace_id,title,organization_id,assignee_id,priority,status,due_at,completed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('t1','ws1','Prepare proposal','o1','u1','high','completed',iso(-4),iso(-5),iso(-10));
  database.prepare(`INSERT INTO follow_ups (id,workspace_id,contact_id,organization_id,owner_id,title,channel,status,priority,due_at,completed_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('f1','ws1','c1','o1','u1','Confirm procurement','email','completed','high',iso(-3),iso(-4),'u1',iso(-8));
  database.prepare(`INSERT INTO email_sender_identities (id,workspace_id,email_address,display_name,domain,is_default,is_active,created_by) VALUES (?,?,?,?,?,?,?,?)`).run('s1','ws1','info@devriessalesconsultancy.com','De Vries Sales Consultancy','devriessalesconsultancy.com',1,1,'u1');
  database.prepare(`INSERT INTO email_messages (id,workspace_id,sender_identity_id,organization_id,contact_id,user_id,from_email,to_json,subject,status,recipient_count,delivery_attempts,sent_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('m1','ws1','s1','o1','c1','u1','info@devriessalesconsultancy.com','["buyer@example.com"]','Commercial follow-up','sent',1,1,iso(-1),iso(-1));

  const env = { DB: new D1Database(database) };
  const ctx = { workspace: { id:'ws1', name:'Reporting Workspace', currency:'EUR' }, user: { id:'u1' } };
  const report = await getDetailedAnalytics(env, ctx, new Request('https://crm.example/api/analytics?days=90&account=o1&owner=u1'));

  assert.equal(report.report.account_id, 'o1');
  assert.equal(report.report.owner_id, 'u1');
  assert.equal(report.executive.won_revenue, 50000);
  assert.equal(report.executive.open_pipeline, 80000);
  assert.equal(report.executive.weighted_pipeline, 48000);
  assert.equal(report.executive.activities, 1);
  assert.equal(report.execution.email.delivery_rate, 100);
  assert.ok(report.execution.tasks.completion_rate <= 100);
  assert.ok(report.execution.follow_ups.completion_rate <= 100);
  assert.equal(report.team_performance[0].won_deals, 1);
  assert.equal(report.account_performance[0].name, 'Example Account');
  assert.ok(report.trends.revenue.length >= 1);
  assert.ok(report.source_performance.some((row) => row.source === 'Referral'));

  database.close();
});
