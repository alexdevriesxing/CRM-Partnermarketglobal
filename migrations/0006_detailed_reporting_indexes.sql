PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_activities_workspace_time_user_account
  ON activities(workspace_id, occurred_at, user_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_deals_workspace_closed_stage_owner
  ON deals(workspace_id, closed_at, stage, owner_id);

CREATE INDEX IF NOT EXISTS idx_deals_workspace_created_source_owner
  ON deals(workspace_id, created_at, source, owner_id);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_created_completed_assignee
  ON tasks(workspace_id, created_at, completed_at, assignee_id);

CREATE INDEX IF NOT EXISTS idx_followups_workspace_created_completed_owner
  ON follow_ups(workspace_id, created_at, completed_at, owner_id);

CREATE INDEX IF NOT EXISTS idx_email_messages_workspace_created_user_account
  ON email_messages(workspace_id, created_at, user_id, organization_id);
