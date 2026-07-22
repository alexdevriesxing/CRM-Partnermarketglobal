PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS prospect_campaigns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  full_title TEXT,
  target_markets TEXT,
  suggested_angle TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','paused','completed','archived')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS prospect_campaign_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES prospect_campaigns(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  prospect_type TEXT,
  fit_angle TEXT,
  source_url TEXT,
  email_status TEXT,
  outreach_status TEXT NOT NULL DEFAULT 'not_contacted' CHECK (outreach_status IN ('not_contacted','researching','ready','contacted','replied','qualified','disqualified','do_not_contact')),
  notes TEXT,
  last_contact_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(campaign_id, organization_id, contact_id, prospect_type)
);

CREATE INDEX IF NOT EXISTS idx_prospect_campaigns_workspace ON prospect_campaigns(workspace_id, status, name);
CREATE INDEX IF NOT EXISTS idx_prospect_members_campaign ON prospect_campaign_members(campaign_id, outreach_status, organization_id);
CREATE INDEX IF NOT EXISTS idx_prospect_members_workspace ON prospect_campaign_members(workspace_id, outreach_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospect_members_contact ON prospect_campaign_members(contact_id, campaign_id);
