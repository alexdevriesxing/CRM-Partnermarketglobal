import { readFile, writeFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');
const write = (path, content) => writeFile(path, content);
function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) throw new Error(`Missing anchor: ${label}`);
  return content.replace(search, replacement);
}
function appendOnce(content, marker, addition) {
  return content.includes(marker) ? content : `${content.trimEnd()}\n\n${addition.trim()}\n`;
}

const existingPackage = JSON.parse(await read('package.json'));
const existingIndex = await read('public/index.html');
if (existingPackage.version === '2.3.0' && existingIndex.includes('data-route="email"')) {
  console.log('Email Center v2.3 is already applied.');
  process.exit(0);
}

{
  const path = 'public/index.html';
  let content = await read(path);
  content = replaceOnce(content, '<body>\n  <div class="app-shell"', '<body>\n  <a class="skip-link" href="#content">Skip to CRM content</a>\n  <div class="app-shell"', 'skip link');
  content = replaceOnce(content,
    '        <button class="nav-item" data-route="activity"><span>↗</span><b>Contact Log</b></button>\n        <button class="nav-item" data-route="pipeline"><span>◫</span><b>Pipeline</b></button>',
    '        <button class="nav-item" data-route="activity"><span>↗</span><b>Contact Log</b></button>\n        <button class="nav-item" data-route="email"><span>✉</span><b>Email Center</b><em id="emailFailureCount"></em></button>\n        <button class="nav-item" data-route="pipeline"><span>◫</span><b>Pipeline</b></button>', 'email navigation');
  content = replaceOnce(content, '<input id="globalSearch" type="search" placeholder="Search contacts, accounts and deals…" autocomplete="off">', '<input id="globalSearch" type="search" placeholder="Search contacts, accounts and deals…" autocomplete="off" aria-label="Search contacts, accounts and deals" aria-controls="searchResults" aria-expanded="false">', 'search accessibility');
  content = replaceOnce(content, '<div class="search-results" id="searchResults" hidden></div>', '<div class="search-results" id="searchResults" role="listbox" hidden></div>', 'search result role');
  await write(path, content);
}

{
  const path = 'public/app.js';
  let content = await read(path);
  content = replaceOnce(content, "const known=['dashboard','agenda','contacts','organizations','activity','pipeline','tasks','analytics','data','settings'];", "const known=['dashboard','agenda','contacts','organizations','activity','email','pipeline','tasks','analytics','data','settings'];", 'email route allowlist');
  content = replaceOnce(content,
    "  $$('.nav-item[data-route]').forEach((item)=>item.classList.toggle('active',item.dataset.route===state.route));\n  $('#sidebar').classList.remove('open');$('#content').focus({preventScroll:true});renderRoute();",
    "  const routeTitles={dashboard:'Dashboard',agenda:'My Day',contacts:'Contacts',organizations:'Accounts',activity:'Contact Log',email:'Email Center',pipeline:'Pipeline',tasks:'Tasks',analytics:'Analytics',data:'Import & export',settings:'Settings'};\n  $$('.nav-item[data-route]').forEach((item)=>{const active=item.dataset.route===state.route;item.classList.toggle('active',active);if(active)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});\n  document.title=`${routeTitles[state.route]||'CRM'} · PartnerMarket Global CRM`;\n  $('#sidebar').classList.remove('open');$('#content').focus({preventScroll:true});renderRoute();", 'route semantics');
  content = replaceOnce(content, "    else if(state.route==='pipeline')await renderPipeline();\n    else if(state.route==='tasks')await renderTasks();", "    else if(state.route==='pipeline')await renderPipeline();\n    else if(state.route==='email'){const {renderEmailCenter}=await import('/email.js');await renderEmailCenter($('#content'));}\n    else if(state.route==='tasks')await renderTasks();", 'email route renderer');
  content = content.replace('Every contacts, pipeline, task and contact-log screen is now filtered to', 'Contacts, pipeline, tasks and contact-log screens are now filtered to');
  content = replaceOnce(content,
    "  $('#globalSearch').addEventListener('input',debounce(runGlobalSearch,220));$('#globalSearch').addEventListener('keydown',(e)=>{if(e.key==='Escape')$('#searchResults').hidden=true;});",
    "  $('#globalSearch').addEventListener('input',debounce(runGlobalSearch,220));$('#globalSearch').addEventListener('keydown',(e)=>{if(e.key==='Escape'){const root=$('#searchResults');root.hidden=true;e.currentTarget.setAttribute('aria-expanded','false');}});", 'search escape aria');
  content = replaceOnce(content, "async function runGlobalSearch(event){const q=event.target.value.trim();const root=$('#searchResults');if(q.length<2){root.hidden=true;return;}", "async function runGlobalSearch(event){const q=event.target.value.trim();const root=$('#searchResults');if(q.length<2){root.hidden=true;event.target.setAttribute('aria-expanded','false');return;}", 'search short query aria');
  content = replaceOnce(content, ";root.hidden=false;}catch{root.hidden=true;}}", ";root.hidden=false;event.target.setAttribute('aria-expanded','true');}catch{root.hidden=true;event.target.setAttribute('aria-expanded','false');}}", 'search expanded aria');
  await write(path, content);
}

{
  const path = 'src/email.js';
  let content = await read(path);
  content = replaceOnce(content, "  const limit = Math.max(1, Math.min(250, Number(url.searchParams.get('limit') || 100)));", "  const q = text(url.searchParams.get('q'));\n  if (q) {\n    const match = `%${q.toLowerCase()}%`;\n    conditions.push(`(lower(m.subject) LIKE ? OR lower(m.from_email) LIKE ? OR lower(COALESCE(o.name,'')) LIKE ? OR lower(COALESCE(c.first_name,'')||' '||COALESCE(c.last_name,'')) LIKE ?)`);\n    bindings.push(match, match, match, match);\n  }\n  const limit = Math.max(1, Math.min(250, Number(url.searchParams.get('limit') || 100)));", 'message search');
  const backendFragment = await read('scripts/fragments/email-center-backend.txt');
  content = replaceOnce(content, 'export async function sendCrmEmail(env, ctx, request) {', `${backendFragment.trim()}\n\nexport async function sendCrmEmail(env, ctx, request) {`, 'email overview functions');
  await write(path, content);
}

{
  const path = 'src/worker.js';
  let content = await read(path);
  content = replaceOnce(content, "import { createEmailSender, listEmailMessages, listEmailSenders, sendCrmEmail, updateEmailSender } from './email.js';", "import { createEmailSender, getEmailHealth, getEmailOverview, listEmailMessages, listEmailSenders, sendCrmEmail, updateEmailSender } from './email.js';", 'email imports');
  content = replaceOnce(content, "  if(p[1]==='email'&&p[2]==='messages'&&method==='GET')return json(await listEmailMessages(env,ctx,request));\n  if(p[1]==='email'&&p[2]==='send'&&method==='POST')return json(await sendCrmEmail(env,ctx,request),201);", "  if(p[1]==='email'&&p[2]==='messages'&&method==='GET')return json(await listEmailMessages(env,ctx,request));\n  if(p[1]==='email'&&p[2]==='overview'&&method==='GET')return json(await getEmailOverview(env,ctx,request));\n  if(p[1]==='email'&&p[2]==='health'&&method==='GET')return json(await getEmailHealth(env,ctx,request));\n  if(p[1]==='email'&&p[2]==='send'&&method==='POST')return json(await sendCrmEmail(env,ctx,request),201);", 'email center routes');
  content = content.replace("version:'2.1.0'", "version:'2.3.0'");
  await write(path, content);
}

{
  const path = 'public/email.js';
  let content = await read(path);
  content = replaceOnce(content, "  permissions: {},\n};", "  permissions: {},\n  overview: null,\n  health: null,\n  centerFilters: { q: '', status: '', sender: '', days: '30' },\n};", 'email center state');
  content = replaceOnce(content, "    .email-draft-note{margin-bottom:14px;padding:10px 12px;border-radius:12px;background:var(--primary-soft,#dcf7f1);font-size:12px}.email-attachments{display:grid;gap:7px;margin-top:8px}.email-attachment{display:flex;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid var(--border,#dbe5e8);border-radius:10px;font-size:12px}.toast.warning{border-color:#f59e0b}.toast.warning strong{color:#b45309}", "    .email-draft-note{margin-bottom:14px;padding:10px 12px;border-radius:12px;background:var(--primary-soft,#dcf7f1);font-size:12px}.email-attachments{display:grid;gap:7px;margin-top:8px}.email-attachment{display:flex;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid var(--border,#dbe5e8);border-radius:10px;font-size:12px}.toast.warning{border-color:#f59e0b}.toast.warning strong{color:#b45309}\n    .email-center-health{display:flex;align-items:center;gap:10px}.email-health-dot{width:10px;height:10px;border-radius:99px;background:var(--red,#c84747);box-shadow:0 0 0 4px color-mix(in srgb,var(--red,#c84747) 18%,transparent)}.email-health-dot.ok{background:var(--green,#15936b);box-shadow:0 0 0 4px color-mix(in srgb,var(--green,#15936b) 18%,transparent)}.email-center-chart{height:180px;display:grid;grid-template-columns:repeat(14,minmax(12px,1fr));align-items:end;gap:7px;padding-top:16px}.email-center-bar{min-height:4px;border-radius:7px 7px 3px 3px;background:linear-gradient(180deg,var(--primary,#0f766e),color-mix(in srgb,var(--primary,#0f766e) 62%,transparent));position:relative}.email-center-bar[data-failed]:after{content:\"\";position:absolute;left:0;right:0;bottom:0;height:var(--failed-height,0%);background:var(--red,#c84747);border-radius:3px}.email-center-bar-label{display:block;text-align:center;font-size:9px;color:var(--muted,#6c7d84);margin-top:6px}.email-sender-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.email-center-message{max-width:430px}.email-center-message strong,.email-center-message small{display:block}.email-center-message small{margin-top:4px;color:var(--muted,#6c7d84)}.email-center-failure{padding:12px;border:1px solid color-mix(in srgb,var(--red,#c84747) 25%,var(--border,#dbe5e8));background:var(--red-soft,#fde8e8);border-radius:12px;margin-bottom:10px}.email-center-failure strong,.email-center-failure small{display:block}.email-center-failure small{margin-top:4px}.email-center-draft{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:14px 16px;border:1px solid color-mix(in srgb,var(--primary,#0f766e) 30%,var(--border,#dbe5e8));background:var(--primary-soft,#dcf7f1);border-radius:14px;margin-bottom:16px}.email-center-draft p{margin:3px 0 0;color:var(--muted,#6c7d84)}", 'email center styles');
  const publicFragment = await read('scripts/fragments/email-center-public.txt');
  content = replaceOnce(content, 'function mailtoDefaults(link) {', `${publicFragment.trim()}\n\nfunction mailtoDefaults(link) {`, 'email center UI');
  content = replaceOnce(content, 'export { openEmailComposer };', 'export { openEmailComposer, renderEmailCenter };', 'email center export');
  await write(path, content);
}

{
  const path = 'public/styles.css';
  let content = await read(path);
  content = appendOnce(content, '.skip-link {', `
.skip-link { position: fixed; left: 14px; top: 10px; z-index: 2000; transform: translateY(-160%); background: var(--primary); color: white; padding: 10px 14px; border-radius: 10px; font-weight: 700; text-decoration: none; box-shadow: var(--shadow); }
.skip-link:focus { transform: translateY(0); }
:where(button,a,input,select,textarea,[tabindex]):focus-visible { outline: 3px solid color-mix(in srgb, var(--primary) 42%, transparent); outline-offset: 2px; }
.nav-item[aria-current="page"] { color: white; }
.panel-header select { min-height: 34px; border: 1px solid var(--border); background: var(--panel); border-radius: 9px; padding: 0 9px; }
@media (max-width: 980px) { .email-center-chart { gap: 4px; overflow-x: auto; } .email-center-draft { align-items: flex-start; flex-direction: column; } }
@media (prefers-reduced-motion: reduce) { *,*::before,*::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }
`);
  await write(path, content);
}

{
  const path = 'scripts/dev-server.mjs';
  let content = await read(path);
  content = replaceOnce(content, "  if(p[1]==='email'&&p[2]==='messages'&&method==='GET')return respond(res,200,visible(emailMessages,ws).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,Number(url.searchParams.get('limit')||100)));", "  if(p[1]==='email'&&p[2]==='messages'&&method==='GET'){let list=visible(emailMessages,ws);const account=url.searchParams.get('account'),status=url.searchParams.get('status'),sender=url.searchParams.get('sender'),q=(url.searchParams.get('q')||'').toLowerCase();if(account)list=list.filter(m=>m.organization_id===account);if(status)list=list.filter(m=>m.status===status);if(sender)list=list.filter(m=>m.sender_identity_id===sender);if(q)list=list.filter(m=>`${m.subject} ${m.from_email} ${m.organization_name||''} ${m.contact_name||''}`.toLowerCase().includes(q));return respond(res,200,list.sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,Number(url.searchParams.get('limit')||100)));}\n  if(p[1]==='email'&&p[2]==='health'&&method==='GET')return respond(res,200,{ok:true,service_binding:true,provider_binding:true,service:'partnermarket-global-email-worker',checked_at:iso()});\n  if(p[1]==='email'&&p[2]==='overview'&&method==='GET'){const list=visible(emailMessages,ws);const sent=list.filter(m=>m.status==='sent').length,failed=list.filter(m=>m.status==='failed').length,total=list.length;return respond(res,200,{window_days:Number(url.searchParams.get('days')||30),totals:{total,sent,failed,queued:list.filter(m=>m.status==='queued').length,recipients:list.reduce((sum,m)=>sum+Number(m.recipient_count||(m.to||[]).length),0),with_attachments:list.filter(m=>(m.attachments||[]).length).length,delivery_rate:total?Math.round(sent/total*1000)/10:0,failure_rate:total?Math.round(failed/total*1000)/10:0},senders:visible(emailSenders,ws).filter(s=>s.is_active).map(s=>({...s,total:list.filter(m=>m.sender_identity_id===s.id).length,sent:list.filter(m=>m.sender_identity_id===s.id&&m.status==='sent').length,failed:list.filter(m=>m.sender_identity_id===s.id&&m.status==='failed').length})),daily:[],failures:list.filter(m=>m.status==='failed').slice(0,8)});}", 'mock email center endpoints');
  content = content.replace("version:'2.0.0'", "version:'2.3.0'").replace('CRM V2 mock server', 'CRM V2.3 mock server');
  await write(path, content);
}

{
  const path = 'docs/EMAIL-OPERATIONS.md';
  let content = await read(path);
  content = appendOnce(content, '## Email Center', `
## Email Center

The CRM navigation now includes a first-class Email Center. It provides:

- private Email Worker and provider-binding health status;
- sent, failed, queued, recipient, delivery-rate and attachment metrics;
- 14, 30 and 90-day delivery volume views;
- sender-identity performance by approved business domain;
- searchable history filtered by CRM account, status and sender;
- recent failure diagnostics;
- CSV export and message reuse;
- recoverable browser-draft visibility and direct compose actions.

The Email Center uses the same workspace and account context as the rest of the CRM. Its health endpoint exposes configuration state only and does not disclose Cloudflare credentials or message content.
`);
  await write(path, content);
}

{
  const path = 'package.json';
  const pkg = JSON.parse(await read(path));
  pkg.version = '2.3.0';
  await write(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

const testFragment = await read('scripts/fragments/email-center-test.txt');
await write('tests/email-center.test.mjs', testFragment);
console.log('Applied Email Center v2.3 pass.');
