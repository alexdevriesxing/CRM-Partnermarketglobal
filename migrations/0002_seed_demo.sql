INSERT OR IGNORE INTO users (id, email, name, role) VALUES
('usr_alex', 'alex@example.com', 'Alex de Vries', 'admin'),
('usr_demo', 'team@example.com', 'Partnership Team', 'manager');

INSERT OR IGNORE INTO organizations (id, name, domain, industry, type, country, city, owner_id, annual_value, relationship_score, last_contact_at, next_follow_up_at, tags_json) VALUES
('org_northstar', 'Northstar Consumer Partners', 'northstar.example', 'FMCG Investment', 'investor', 'Netherlands', 'Amsterdam', 'usr_alex', 180000, 86, datetime('now','-2 days'), datetime('now','+2 days'), '["priority","consumer","europe"]'),
('org_javafoods', 'Java Foods Distribution', 'javafoods.example', 'Food Distribution', 'partner', 'Indonesia', 'Jakarta', 'usr_alex', 95000, 73, datetime('now','-8 days'), datetime('now','+1 day'), '["indonesia","distribution"]'),
('org_sakura', 'Sakura Retail Systems', 'sakura.example', 'Retail Technology', 'prospect', 'Singapore', 'Singapore', 'usr_demo', 60000, 62, datetime('now','-14 days'), datetime('now','-1 day'), '["saas","retail-tech"]'),
('org_alpine', 'Alpine Private Brands', 'alpine.example', 'Private Label', 'client', 'Germany', 'Hamburg', 'usr_alex', 125000, 91, datetime('now','-1 day'), datetime('now','+7 days'), '["client","private-label"]');

INSERT OR IGNORE INTO contacts (id, organization_id, first_name, last_name, job_title, email, phone, preferred_channel, lifecycle_stage, owner_id, relationship_score, source, timezone, last_contact_at, next_follow_up_at, notes, tags_json) VALUES
('ct_maya', 'org_northstar', 'Maya', 'Van den Berg', 'Investment Director', 'maya@northstar.example', '+31 20 555 0142', 'email', 'opportunity', 'usr_alex', 88, 'Referral', 'Europe/Amsterdam', datetime('now','-2 days'), datetime('now','+2 days'), 'Interested in consumer growth opportunities across Southeast Asia.', '["decision-maker","warm"]'),
('ct_ardi', 'org_javafoods', 'Ardi', 'Pratama', 'Commercial Director', 'ardi@javafoods.example', '+62 21 555 0188', 'whatsapp', 'partner', 'usr_alex', 76, 'Conference', 'Asia/Jakarta', datetime('now','-8 days'), datetime('now','+1 day'), 'Discuss national distribution and channel expansion.', '["distribution","indonesia"]'),
('ct_lina', 'org_sakura', 'Lina', 'Tan', 'Founder', 'lina@sakura.example', '+65 6555 0199', 'linkedin', 'qualified', 'usr_demo', 64, 'LinkedIn', 'Asia/Singapore', datetime('now','-14 days'), datetime('now','-1 day'), 'Requested CRM and automation proposal.', '["founder","saas"]'),
('ct_jonas', 'org_alpine', 'Jonas', 'Weber', 'Managing Partner', 'jonas@alpine.example', '+49 40 555 0111', 'meeting', 'customer', 'usr_alex', 94, 'Existing network', 'Europe/Berlin', datetime('now','-1 day'), datetime('now','+7 days'), 'Active advisory client.', '["client","priority"]');

INSERT OR IGNORE INTO deals (id, name, organization_id, primary_contact_id, owner_id, stage, value, currency, probability, expected_close_date, description) VALUES
('deal_northstar', 'SEA Consumer Growth Mandate', 'org_northstar', 'ct_maya', 'usr_alex', 'negotiation', 85000, 'EUR', 75, date('now','+24 days'), 'Investor sourcing and transaction advisory mandate.'),
('deal_java', 'Indonesia Distribution Partnership', 'org_javafoods', 'ct_ardi', 'usr_alex', 'proposal', 42000, 'EUR', 55, date('now','+40 days'), 'Partner onboarding and commercial rollout.'),
('deal_sakura', 'CRM Transformation Project', 'org_sakura', 'ct_lina', 'usr_demo', 'qualified', 28000, 'EUR', 35, date('now','+52 days'), 'CRM implementation and automation.'),
('deal_alpine', 'Private Label Expansion', 'org_alpine', 'ct_jonas', 'usr_alex', 'won', 65000, 'EUR', 100, date('now','-10 days'), 'Market entry and retailer introductions.');

INSERT OR IGNORE INTO activities (id, contact_id, organization_id, user_id, type, direction, subject, body, outcome, occurred_at, duration_minutes) VALUES
('act_1', 'ct_maya', 'org_northstar', 'usr_alex', 'meeting', 'outbound', 'Investment thesis workshop', 'Reviewed target categories, ticket size and regional priorities.', 'Positive; requested shortlist', datetime('now','-2 days'), 55),
('act_2', 'ct_ardi', 'org_javafoods', 'usr_alex', 'whatsapp', 'outbound', 'Distribution follow-up', 'Shared draft rollout assumptions and requested volume forecast.', 'Awaiting data', datetime('now','-8 days'), NULL),
('act_3', 'ct_lina', 'org_sakura', 'usr_demo', 'call', 'outbound', 'CRM discovery call', 'Mapped current lead management and reporting gaps.', 'Proposal requested', datetime('now','-14 days'), 40),
('act_4', 'ct_jonas', 'org_alpine', 'usr_alex', 'email', 'inbound', 'Expansion approval', 'Client approved phase two market introductions.', 'Won', datetime('now','-1 day'), NULL),
('act_5', 'ct_maya', 'org_northstar', 'usr_alex', 'email', 'outbound', 'Shortlist preview', 'Sent preview of three relevant consumer platforms.', 'Opened', datetime('now','-4 days'), NULL),
('act_6', 'ct_jonas', 'org_alpine', 'usr_alex', 'meeting', 'outbound', 'Quarterly review', 'Reviewed pipeline, retailer feedback and next milestones.', 'Renewal likely', datetime('now','-20 days'), 60);

INSERT OR IGNORE INTO tasks (id, title, description, contact_id, organization_id, deal_id, assignee_id, priority, status, due_at) VALUES
('task_1', 'Send investment shortlist', 'Send full vetted shortlist and teaser notes.', 'ct_maya', 'org_northstar', 'deal_northstar', 'usr_alex', 'high', 'open', datetime('now','+2 days')),
('task_2', 'Chase volume forecast', 'Request SKU and monthly volume assumptions.', 'ct_ardi', 'org_javafoods', 'deal_java', 'usr_alex', 'urgent', 'open', datetime('now','+1 day')),
('task_3', 'Send CRM proposal', 'Complete implementation scope and pricing.', 'ct_lina', 'org_sakura', 'deal_sakura', 'usr_demo', 'high', 'in_progress', datetime('now','-1 day')),
('task_4', 'Schedule quarterly review', 'Book next review meeting.', 'ct_jonas', 'org_alpine', 'deal_alpine', 'usr_alex', 'medium', 'open', datetime('now','+7 days'));
