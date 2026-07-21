PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
  currency TEXT NOT NULL DEFAULT 'EUR',
  color TEXT NOT NULL DEFAULT '#0f766e',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','manager','member','viewer')),
  is_default INTEGER NOT NULL DEFAULT 0,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id)
);

INSERT OR IGNORE INTO workspaces (id, name, slug, description, currency, color)
VALUES ('workspace-default', 'PartnerMarket Global', 'partnermarket-global', 'Primary PartnerMarket Global CRM database', 'EUR', '#0f766e');

INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, is_default)
SELECT 'workspace-default', id, role, 1 FROM users;

ALTER TABLE organizations ADD COLUMN workspace_id TEXT;
ALTER TABLE contacts ADD COLUMN workspace_id TEXT;
ALTER TABLE activities ADD COLUMN workspace_id TEXT;
ALTER TABLE deals ADD COLUMN workspace_id TEXT;
ALTER TABLE tasks ADD COLUMN workspace_id TEXT;
ALTER TABLE attachments ADD COLUMN workspace_id TEXT;
ALTER TABLE imports ADD COLUMN workspace_id TEXT;
ALTER TABLE audit_log ADD COLUMN workspace_id TEXT;

UPDATE organizations SET workspace_id='workspace-default' WHERE workspace_id IS NULL;
UPDATE contacts SET workspace_id='workspace-default' WHERE workspace_id IS NULL;
UPDATE activities SET workspace_id='workspace-default' WHERE workspace_id IS NULL;
UPDATE deals SET workspace_id='workspace-default' WHERE workspace_id IS NULL;
UPDATE tasks SET workspace_id='workspace-default' WHERE workspace_id IS NULL;
UPDATE attachments SET workspace_id='workspace-default' WHERE workspace_id IS NULL;
UPDATE imports SET workspace_id='workspace-default' WHERE workspace_id IS NULL;
UPDATE audit_log SET workspace_id='workspace-default' WHERE workspace_id IS NULL;

ALTER TABLE contacts ADD COLUMN account_role TEXT;
ALTER TABLE contacts ADD COLUMN consent_status TEXT NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('unknown','legitimate_interest','consented','withdrawn'));
ALTER TABLE contacts ADD COLUMN email_opt_out INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN phone_opt_out INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN preferred_language TEXT;

ALTER TABLE organizations ADD COLUMN account_tier TEXT NOT NULL DEFAULT 'standard' CHECK (account_tier IN ('strategic','key','standard','watchlist'));
ALTER TABLE organizations ADD COLUMN territory TEXT;
ALTER TABLE organizations ADD COLUMN employee_count INTEGER;
ALTER TABLE organizations ADD COLUMN revenue_band TEXT;

ALTER TABLE activities ADD COLUMN deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL;
ALTER TABLE activities ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE activities ADD COLUMN sentiment TEXT CHECK (sentiment IN ('positive','neutral','negative'));
ALTER TABLE activities ADD COLUMN next_step TEXT;
ALTER TABLE activities ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;

ALTER TABLE deals ADD COLUMN next_step TEXT;
ALTER TABLE deals ADD COLUMN competitor TEXT;
ALTER TABLE deals ADD COLUMN source TEXT;
ALTER TABLE deals ADD COLUMN close_reason TEXT;

ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'task' CHECK (task_type IN ('task','call','email','meeting','admin','research','other'));
ALTER TABLE tasks ADD COLUMN start_at TEXT;
ALTER TABLE tasks ADD COLUMN reminder_at TEXT;
ALTER TABLE tasks ADD COLUMN recurring_rule TEXT NOT NULL DEFAULT 'none' CHECK (recurring_rule IN ('none','daily','weekly','monthly','quarterly'));
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER;
ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS follow_ups (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id TEXT REFERENCES deals(id) ON DELETE CASCADE,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','call','meeting','whatsapp','linkedin','other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled','snoozed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  due_at TEXT NOT NULL,
  snoozed_until TEXT,
  completed_at TEXT,
  cadence TEXT NOT NULL DEFAULT 'none' CHECK (cadence IN ('none','daily','weekly','monthly','quarterly')),
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE activities ADD COLUMN follow_up_id TEXT REFERENCES follow_ups(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contacts','organizations','tasks','follow_ups','activities','deals')),
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  sort_json TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspace_goals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('revenue','activities','new_contacts','won_deals','follow_up_completion')),
  target_value REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id, is_default DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace ON contacts(workspace_id, status, last_contact_at DESC);
CREATE INDEX IF NOT EXISTS idx_orgs_workspace ON organizations(workspace_id, status, name);
CREATE INDEX IF NOT EXISTS idx_activities_workspace_time ON activities(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_workspace_stage ON deals(workspace_id, stage, expected_close_date);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_due ON tasks(workspace_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_followups_workspace_due ON follow_ups(workspace_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_followups_contact ON follow_ups(contact_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(workspace_id, user_id, entity_type);
