PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS email_sender_identities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  display_name TEXT NOT NULL,
  reply_to TEXT,
  domain TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, email_address)
);

CREATE TABLE IF NOT EXISTS email_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sender_identity_id TEXT REFERENCES email_sender_identities(id) ON DELETE SET NULL,
  activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  from_email TEXT NOT NULL,
  from_name TEXT,
  reply_to TEXT,
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL,
  text_body TEXT,
  html_body TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('draft','queued','sent','failed','delivered','bounced','suppressed')),
  provider_message_id TEXT,
  failure_code TEXT,
  failure_reason TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_senders_workspace ON email_sender_identities(workspace_id, is_active, is_default DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_workspace_time ON email_messages(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_account_time ON email_messages(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_contact_time ON email_messages(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(workspace_id, status, created_at DESC);

INSERT OR IGNORE INTO email_sender_identities (id, workspace_id, email_address, display_name, reply_to, domain, is_default)
SELECT lower(hex(randomblob(16))), id, 'info@partnermarketglobal.com', 'PartnerMarket Global', 'info@partnermarketglobal.com', 'partnermarketglobal.com',
  CASE WHEN slug NOT LIKE '%golden%' AND slug NOT LIKE '%sales%' THEN 1 ELSE 0 END
FROM workspaces;

INSERT OR IGNORE INTO email_sender_identities (id, workspace_id, email_address, display_name, reply_to, domain, is_default)
SELECT lower(hex(randomblob(16))), id, 'info@goldendragoncapital.co', 'Golden Dragon Capital', 'info@goldendragoncapital.co', 'goldendragoncapital.co',
  CASE WHEN slug LIKE '%golden%' THEN 1 ELSE 0 END
FROM workspaces;

INSERT OR IGNORE INTO email_sender_identities (id, workspace_id, email_address, display_name, reply_to, domain, is_default)
SELECT lower(hex(randomblob(16))), id, 'info@devriessalesconsultancy.com', 'De Vries Sales Consultancy', 'info@devriessalesconsultancy.com', 'devriessalesconsultancy.com',
  CASE WHEN slug LIKE '%sales%' OR slug LIKE '%consult%' THEN 1 ELSE 0 END
FROM workspaces;
