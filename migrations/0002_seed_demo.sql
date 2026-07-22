-- Production bootstrap only. Prospect data is imported privately after migrations.
-- Keep personal or commercially sensitive CRM rows out of this public repository.
INSERT OR IGNORE INTO users (id, email, name, role)
VALUES ('usr_alex', 'alexdevriesxing@gmail.com', 'Alex de Vries', 'admin');
