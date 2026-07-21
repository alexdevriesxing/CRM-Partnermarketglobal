PRAGMA foreign_keys = ON;

ALTER TABLE email_messages ADD COLUMN client_request_id TEXT;
ALTER TABLE email_messages ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE email_messages ADD COLUMN recipient_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_messages ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_messages ADD COLUMN last_attempt_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_idempotency
  ON email_messages(workspace_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_messages_provider
  ON email_messages(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_messages_attempts
  ON email_messages(workspace_id, status, last_attempt_at DESC);
