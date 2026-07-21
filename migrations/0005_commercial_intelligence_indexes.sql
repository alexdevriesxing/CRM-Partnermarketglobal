PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_deals_workspace_stage_close
  ON deals(workspace_id, stage, expected_close_date);

CREATE INDEX IF NOT EXISTS idx_deals_workspace_account_stage_updated
  ON deals(workspace_id, organization_id, stage, updated_at);

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_account_status_email
  ON contacts(workspace_id, organization_id, status, email);

CREATE INDEX IF NOT EXISTS idx_organizations_workspace_status_health_contact
  ON organizations(workspace_id, status, relationship_score, last_contact_at);

CREATE INDEX IF NOT EXISTS idx_organizations_workspace_name_domain
  ON organizations(workspace_id, name, domain);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_account_status_due
  ON tasks(workspace_id, organization_id, status, due_at);

CREATE INDEX IF NOT EXISTS idx_followups_workspace_account_status_due
  ON follow_ups(workspace_id, organization_id, status, due_at, snoozed_until);
