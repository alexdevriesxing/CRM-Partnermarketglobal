import { readFile, writeFile } from 'node:fs/promises';

const backendPath = 'src/email.js';
let backend = await readFile(backendPath, 'utf8');
const overviewStart = backend.indexOf('export async function getEmailOverview(env, ctx, request) {');
const healthStart = backend.indexOf('export async function getEmailHealth(env, ctx, request) {');
if (overviewStart < 0 || healthStart < 0 || healthStart <= overviewStart) throw new Error('Unable to locate Email Center overview function');
const overview = `export async function getEmailOverview(env, ctx, request) {
  const url = new URL(request.url);
  const days = emailOverviewDays(request);
  const modifier = \`-\${days} days\`;
  const accountId = text(url.searchParams.get('account'));
  const accountFilter = accountId ? ' AND organization_id=?' : '';
  const aliasedAccountFilter = accountId ? ' AND m.organization_id=?' : '';
  const accountBindings = accountId ? [accountId] : [];
  const [totals, senders, daily, failures] = await Promise.all([
    env.DB.prepare(\`SELECT COUNT(*) total,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
      SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) queued,
      COALESCE(SUM(recipient_count),0) recipients,
      SUM(CASE WHEN attachments_json IS NOT NULL AND attachments_json!='[]' THEN 1 ELSE 0 END) with_attachments
      FROM email_messages WHERE workspace_id=?\${accountFilter} AND created_at>=datetime('now',?)\`).bind(ctx.workspace.id, ...accountBindings, modifier).first(),
    env.DB.prepare(\`SELECT s.id,s.display_name,s.email_address,s.domain,s.is_default,
      COUNT(m.id) total,
      SUM(CASE WHEN m.status='sent' THEN 1 ELSE 0 END) sent,
      SUM(CASE WHEN m.status='failed' THEN 1 ELSE 0 END) failed
      FROM email_sender_identities s
      LEFT JOIN email_messages m ON m.sender_identity_id=s.id AND m.workspace_id=s.workspace_id AND m.created_at>=datetime('now',?)\${aliasedAccountFilter}
      WHERE s.workspace_id=? AND s.is_active=1
      GROUP BY s.id,s.display_name,s.email_address,s.domain,s.is_default
      ORDER BY s.is_default DESC,total DESC,s.display_name\`).bind(modifier, ...accountBindings, ctx.workspace.id).all(),
    env.DB.prepare(\`SELECT date(created_at) day,COUNT(*) total,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed
      FROM email_messages WHERE workspace_id=?\${accountFilter} AND created_at>=date('now',?)
      GROUP BY date(created_at) ORDER BY day\`).bind(ctx.workspace.id, ...accountBindings, modifier).all(),
    env.DB.prepare(\`SELECT m.*,s.display_name sender_display_name,c.first_name||' '||c.last_name contact_name,o.name organization_name
      FROM email_messages m
      LEFT JOIN email_sender_identities s ON s.id=m.sender_identity_id
      LEFT JOIN contacts c ON c.id=m.contact_id
      LEFT JOIN organizations o ON o.id=m.organization_id
      WHERE m.workspace_id=?\${aliasedAccountFilter} AND m.status='failed'
      ORDER BY m.created_at DESC LIMIT 8\`).bind(ctx.workspace.id, ...accountBindings).all(),
  ]);
  const total = Number(totals?.total || 0);
  const sent = Number(totals?.sent || 0);
  const failed = Number(totals?.failed || 0);
  return {
    window_days: days,
    account_id: accountId,
    totals: {
      total,
      sent,
      failed,
      queued: Number(totals?.queued || 0),
      recipients: Number(totals?.recipients || 0),
      with_attachments: Number(totals?.with_attachments || 0),
      delivery_rate: total ? Math.round((sent / total) * 1000) / 10 : 0,
      failure_rate: total ? Math.round((failed / total) * 1000) / 10 : 0,
    },
    senders: (senders.results || []).map(senderRecord),
    daily: daily.results || [],
    failures: (failures.results || []).map(messageRecord),
  };
}

`;
backend = backend.slice(0, overviewStart) + overview + backend.slice(healthStart);
await writeFile(backendPath, backend);

const publicPath = 'public/email.js';
let frontend = await readFile(publicPath, 'utf8');
frontend = frontend.replace(
  "emailApi(`/api/email/overview?days=${encodeURIComponent(filters.days || '30')}`)",
  "emailApi(`/api/email/overview?days=${encodeURIComponent(filters.days || '30')}${account ? `&account=${encodeURIComponent(account)}` : ''}`)",
);
frontend = frontend.replace(
  '.email-center-chart{height:180px;display:grid;grid-template-columns:repeat(14,minmax(12px,1fr));align-items:end;gap:7px;padding-top:16px}',
  '.email-center-chart{height:190px;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(22px,1fr);align-items:end;gap:7px;padding:16px 2px 4px;overflow-x:auto;overscroll-behavior-inline:contain}',
);
await writeFile(publicPath, frontend);

const mockPath = 'scripts/dev-server.mjs';
let mock = await readFile(mockPath, 'utf8');
mock = mock.replace(
  "if(p[1]==='email'&&p[2]==='overview'&&method==='GET'){const list=visible(emailMessages,ws);",
  "if(p[1]==='email'&&p[2]==='overview'&&method==='GET'){const account=url.searchParams.get('account');const list=visible(emailMessages,ws).filter(m=>!account||m.organization_id===account);",
);
await writeFile(mockPath, mock);

const testPath = 'tests/email-center.test.mjs';
let tests = await readFile(testPath, 'utf8');
if (!tests.includes("overview metrics respect the selected CRM account")) {
  tests += `\n\ntest('overview metrics respect the selected CRM account', async () => {\n  const [backend, email] = await Promise.all([read('src/email.js'), read('public/email.js')]);\n  assert.match(backend, /accountId = text\\(url\\.searchParams\\.get\\('account'\\)\\)/);\n  assert.match(backend, /account_id: accountId/);\n  assert.match(email, /&account=\\$\\{encodeURIComponent\\(account\\)\\}/);\n});\n`;
}
await writeFile(testPath, tests);
console.log('Applied account-scoped metrics and scrollable Email Center charts.');
