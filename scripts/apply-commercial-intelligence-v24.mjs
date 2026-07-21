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

const pkgBefore = JSON.parse(await read('package.json'));
const htmlBefore = await read('public/index.html');
if (pkgBefore.version === '2.4.0' && htmlBefore.includes('data-route="intelligence"')) {
  console.log('Commercial Intelligence v2.4 is already applied.');
  process.exit(0);
}

{
  const path = 'src/intelligence.js';
  let content = await read(path);
  content = replaceOnce(
    content,
    "  const organizationScope = accountScope(url, 'o');",
    "  const organizationScope = { accountId: scope.accountId, clause: scope.accountId ? ' AND o.id=?' : '', bindings: scope.accountId ? [scope.accountId] : [] };",
    'organization account scope',
  );
  await write(path, content);
}

{
  const path = 'public/index.html';
  let content = await read(path);
  content = replaceOnce(
    content,
    '        <button class="nav-item" data-route="analytics"><span>⌁</span><b>Analytics</b></button>',
    '        <button class="nav-item" data-route="analytics"><span>⌁</span><b>Analytics</b></button>\n        <button class="nav-item" data-route="intelligence"><span>◈</span><b>Commercial Intel</b><em id="intelligenceRiskCount"></em></button>',
    'commercial intelligence navigation',
  );
  await write(path, content);
}

{
  const path = 'public/app.js';
  let content = await read(path);
  content = replaceOnce(
    content,
    "const known=['dashboard','agenda','contacts','organizations','activity','email','pipeline','tasks','analytics','data','settings'];",
    "const known=['dashboard','agenda','contacts','organizations','activity','email','pipeline','tasks','analytics','intelligence','data','settings'];",
    'intelligence route allowlist',
  );
  content = replaceOnce(
    content,
    "const routeTitles={dashboard:'Dashboard',agenda:'My Day',contacts:'Contacts',organizations:'Accounts',activity:'Contact Log',email:'Email Center',pipeline:'Pipeline',tasks:'Tasks',analytics:'Analytics',data:'Import & export',settings:'Settings'};",
    "const routeTitles={dashboard:'Dashboard',agenda:'My Day',contacts:'Contacts',organizations:'Accounts',activity:'Contact Log',email:'Email Center',pipeline:'Pipeline',tasks:'Tasks',analytics:'Analytics',intelligence:'Commercial Intelligence',data:'Import & export',settings:'Settings'};",
    'intelligence page title',
  );
  content = replaceOnce(
    content,
    "    else if(state.route==='analytics')await renderAnalytics();\n    else if(state.route==='data')renderData();",
    "    else if(state.route==='analytics')await renderAnalytics();\n    else if(state.route==='intelligence'){const {renderCommercialIntelligence}=await import('/intelligence.js');await renderCommercialIntelligence($('#content'));}\n    else if(state.route==='data')renderData();",
    'intelligence route renderer',
  );
  await write(path, content);
}

{
  const path = 'public/styles.css';
  let content = await read(path);
  content = appendOnce(content, '.intelligence-forecast-chart', `
.intelligence-metric.green { border-top-color: var(--green); }
.intelligence-metric.primary { border-top-color: var(--primary); }
.intelligence-metric.blue { border-top-color: var(--blue); }
.intelligence-metric.amber { border-top-color: var(--amber); }
.intelligence-metric.red { border-top-color: var(--red); }
.intelligence-forecast-chart { height: 220px; display: grid; grid-template-columns: repeat(6,minmax(70px,1fr)); align-items: end; gap: 14px; padding: 18px 4px 2px; overflow-x: auto; }
.intelligence-forecast-column { height: 100%; min-width: 70px; display: grid; grid-template-rows: 1fr auto auto; gap: 5px; align-items: end; text-align: center; }
.intelligence-forecast-column small { color: var(--muted); font-size: 10px; }
.intelligence-forecast-column strong { font-size: 11px; }
.intelligence-forecast-bars { width: min(48px,72%); min-height: 5px; justify-self: center; align-self: end; border-radius: 9px 9px 4px 4px; background: color-mix(in srgb,var(--primary) 28%,var(--panel)); display: flex; align-items: end; overflow: hidden; }
.intelligence-forecast-bars span { display: block; width: 100%; background: var(--primary); border-radius: 7px 7px 3px 3px; }
.intelligence-legend { display: flex; justify-content: center; gap: 20px; color: var(--muted); font-size: 11px; margin-top: 12px; }
.intelligence-legend span { display: inline-flex; align-items: center; gap: 6px; }
.intelligence-legend i { width: 12px; height: 12px; border-radius: 3px; background: color-mix(in srgb,var(--primary) 28%,var(--panel)); }
.intelligence-legend i.weighted { background: var(--primary); }
.intelligence-signal-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.intelligence-signal { border: 1px solid var(--border); border-radius: 14px; padding: 16px; background: var(--panel); }
.intelligence-signal strong { display: block; font-size: 28px; line-height: 1; margin-bottom: 7px; }
.intelligence-signal span,.intelligence-signal small { display: block; }
.intelligence-signal span { font-weight: 750; }
.intelligence-signal small { color: var(--muted); margin-top: 5px; }
.intelligence-signal.warning { border-color: color-mix(in srgb,var(--amber) 42%,var(--border)); background: color-mix(in srgb,var(--amber-soft) 68%,var(--panel)); }
.intelligence-signal.danger { border-color: color-mix(in srgb,var(--red) 42%,var(--border)); background: color-mix(in srgb,var(--red-soft) 68%,var(--panel)); }
.intelligence-reasons { display: flex; flex-wrap: wrap; gap: 5px; max-width: 340px; }
.table-subline { display: block; color: var(--muted); margin-top: 4px; }
.intelligence-score { font-size: 25px; }
.intelligence-score.good { color: var(--green); }
.intelligence-score.fair { color: var(--amber); }
.intelligence-score.poor { color: var(--red); }
.intelligence-quality-list { display: grid; gap: 13px; }
.intelligence-quality-row { display: grid; grid-template-columns: minmax(150px,1.2fr) minmax(110px,1fr) 42px 70px; align-items: center; gap: 10px; }
.intelligence-quality-row strong,.intelligence-quality-row small { display: block; }
.intelligence-quality-row small { color: var(--muted); margin-top: 3px; }
.intelligence-quality-row b { text-align: right; }
.intelligence-quality-row em { color: var(--muted); font-size: 10px; font-style: normal; text-align: right; }
.intelligence-quality-track { height: 9px; background: var(--surface-muted); border-radius: 99px; overflow: hidden; }
.intelligence-quality-track span { height: 100%; display: block; background: linear-gradient(90deg,var(--primary),var(--green)); border-radius: inherit; }
.intelligence-duplicate-list { display: grid; gap: 8px; }
.intelligence-duplicate-card { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); }
.intelligence-duplicate-card strong,.intelligence-duplicate-card small { display: block; }
.intelligence-duplicate-card small { color: var(--muted); margin-top: 4px; }
#intelligenceRiskCount:not(:empty) { background: var(--red); color: white; }
@media (max-width: 760px) { .intelligence-signal-grid { grid-template-columns: 1fr; } .intelligence-quality-row { grid-template-columns: 1fr 54px; } .intelligence-quality-track { grid-column: 1 / -1; grid-row: 2; } .intelligence-quality-row em { display: none; } }
`);
  await write(path, content);
}

{
  const path = 'src/worker.js';
  let content = await read(path);
  content = replaceOnce(
    content,
    "import { createEmailSender, getEmailHealth, getEmailOverview, listEmailMessages, listEmailSenders, sendCrmEmail, updateEmailSender } from './email.js';",
    "import { createEmailSender, getEmailHealth, getEmailOverview, listEmailMessages, listEmailSenders, sendCrmEmail, updateEmailSender } from './email.js';\nimport { getCommercialIntelligence } from './intelligence.js';",
    'intelligence backend import',
  );
  content = replaceOnce(
    content,
    "  if(p[1]==='analytics'&&method==='GET')return json(await analytics(env,ctx));",
    "  if(p[1]==='analytics'&&method==='GET')return json(await analytics(env,ctx));\n  if(p[1]==='intelligence'&&method==='GET')return json(await getCommercialIntelligence(env,ctx,request));",
    'intelligence API route',
  );
  content = content.replace("version:'2.3.0'", "version:'2.4.0'");
  await write(path, content);
}

{
  const path = 'scripts/dev-server.mjs';
  let content = await read(path);
  const endpoint = `  if(p[1]==='intelligence'){
    const account=url.searchParams.get('account');const cs=visible(contacts,ws).filter(c=>!account||c.organization_id===account);const os=visible(organizations,ws).filter(o=>!account||o.id===account);const ds=visible(deals,ws).filter(d=>!['won','lost'].includes(d.stage)&&(!account||d.organization_id===account));
    const risks=ds.map(d=>{const overdue=!!d.expected_close_date&&new Date(d.expected_close_date)<new Date();const stale=!!d.updated_at&&new Date(d.updated_at)<new Date(now-30*864e5);const reasons=[];if(overdue)reasons.push('Close date overdue');if(stale)reasons.push('No update in 30+ days');if(!d.next_step)reasons.push('Missing next step');if(!d.primary_contact_id)reasons.push('Missing primary contact');if(!d.organization_id)reasons.push('Missing CRM account');return{...d,is_overdue:Number(overdue),is_stale:Number(stale),missing_next_step:Number(!d.next_step),missing_contact:Number(!d.primary_contact_id),missing_account:Number(!d.organization_id),risk_score:(overdue?35:0)+(stale?25:0)+(!d.next_step?20:0)+(!d.primary_contact_id?10:0)+(!d.organization_id?10:0),risk_reasons:reasons};}).filter(d=>d.risk_score>0).sort((a,b)=>b.risk_score-a.risk_score||Number(b.value||0)-Number(a.value||0));
    const monthStart=(offset)=>{const d=new Date();d.setUTCDate(1);d.setUTCHours(0,0,0,0);d.setUTCMonth(d.getUTCMonth()+offset);return d.toISOString().slice(0,7)+'-01';};const monthly=Array.from({length:6},(_,i)=>{const month=monthStart(i);const matches=ds.filter(d=>String(d.expected_close_date||'').slice(0,7)===month.slice(0,7));return{month,deal_count:matches.length,pipeline:matches.reduce((s,d)=>s+Number(d.value||0),0),weighted:matches.reduce((s,d)=>s+Number(d.value||0)*Number(d.probability||0)/100,0)};});
    const cq={total:cs.length,missing_email:cs.filter(c=>!c.email).length,missing_phone:cs.filter(c=>!c.phone&&!c.mobile).length,missing_account:cs.filter(c=>!c.organization_id).length,missing_job_title:cs.filter(c=>!c.job_title).length,unknown_consent:cs.filter(c=>!c.consent_status||c.consent_status==='unknown').length};const oq={total:os.length,missing_domain:os.filter(o=>!o.domain).length,missing_industry:os.filter(o=>!o.industry).length,missing_country:os.filter(o=>!o.country).length,missing_owner:os.filter(o=>!o.owner_id).length};const dq={total:ds.length,missing_account:ds.filter(d=>!d.organization_id).length,missing_contact:ds.filter(d=>!d.primary_contact_id).length,missing_next_step:ds.filter(d=>!d.next_step).length,missing_close_date:ds.filter(d=>!d.expected_close_date).length};const issues=Object.entries(cq).filter(([k])=>k!=='total').reduce((s,[,v])=>s+v,0)+Object.entries(oq).filter(([k])=>k!=='total').reduce((s,[,v])=>s+v,0)+Object.entries(dq).filter(([k])=>k!=='total').reduce((s,[,v])=>s+v,0);const possible=cq.total*5+oq.total*4+dq.total*4;const score=possible?Math.max(0,Math.round((1-issues/possible)*100)):100;
    const duplicate=(list,key,label)=>Object.values(list.reduce((m,item)=>{const value=String(key(item)||'').trim().toLowerCase();if(!value)return m;(m[value]||={match_value:value,record_count:0,record_ids:[],labels:[]}).record_count++;m[value].record_ids.push(item.id);m[value].labels.push(label(item));return m;},{})).filter(g=>g.record_count>1).map(g=>({...g,record_ids:g.record_ids.join(','),labels:g.labels.join(' · ')}));const dupContacts=duplicate(cs,c=>c.email,c=>c.first_name+' '+c.last_name);const dupNames=duplicate(os,o=>o.name,o=>o.name).map(g=>({...g,match_type:'name'}));const dupDomains=duplicate(os,o=>o.domain,o=>o.name).map(g=>({...g,match_type:'domain'}));
    const riskAccounts=os.map(o=>{const overdueTasks=visible(tasks,ws).filter(t=>t.organization_id===o.id&&!['completed','cancelled'].includes(t.status)&&new Date(t.due_at)<new Date()).length;const overdueFollow=visible(followUps,ws).filter(f=>f.organization_id===o.id&&['open','snoozed'].includes(f.status)&&new Date(f.snoozed_until||f.due_at)<new Date()).length;const stale=!o.last_contact_at||new Date(o.last_contact_at)<new Date(now-60*864e5);const risk=(Number(o.relationship_score||0)<35?35:Number(o.relationship_score||0)<55?20:0)+(stale?30:0)+(overdueTasks?20:0)+(overdueFollow?15:0);return{...o,open_pipeline:ds.filter(d=>d.organization_id===o.id).reduce((s,d)=>s+Number(d.value||0),0),overdue_tasks:overdueTasks,overdue_follow_ups:overdueFollow,risk_score:risk};}).filter(o=>o.risk_score>0).sort((a,b)=>b.risk_score-a.risk_score);
    const openPipeline=ds.reduce((s,d)=>s+Number(d.value||0),0),weighted=ds.reduce((s,d)=>s+Number(d.value||0)*Number(d.probability||0)/100,0),overdueDeals=ds.filter(d=>d.expected_close_date&&new Date(d.expected_close_date)<new Date()),due30=ds.filter(d=>d.expected_close_date&&new Date(d.expected_close_date)>=new Date()&&new Date(d.expected_close_date)<=new Date(now+30*864e5));
    return respond(res,200,{window_days:Number(url.searchParams.get('days')||90),account_id:account||null,generated_at:iso(),forecast:{open_deals:ds.length,open_pipeline:openPipeline,weighted_pipeline:weighted,due_30d_count:due30.length,due_30d_value:due30.reduce((s,d)=>s+Number(d.value||0),0),overdue_count:overdueDeals.length,overdue_value:overdueDeals.reduce((s,d)=>s+Number(d.value||0),0),unscheduled_count:ds.filter(d=>!d.expected_close_date).length,missing_next_step_count:ds.filter(d=>!d.next_step).length,stale_count:ds.filter(d=>d.updated_at&&new Date(d.updated_at)<new Date(now-30*864e5)).length},forecast_by_month:monthly,risk_deals:risks,risk_accounts:riskAccounts,data_quality:{score,issues,possible,contacts:cq,organizations:oq,deals:dq,duplicate_groups:dupContacts.length+dupNames.length+dupDomains.length},duplicates:{contacts:dupContacts,organizations:[...dupNames,...dupDomains]},summary:{urgent_deals:risks.filter(d=>d.risk_score>=50).length,at_risk_accounts:riskAccounts.length,duplicate_groups:dupContacts.length+dupNames.length+dupDomains.length,records_reviewed:cq.total+oq.total+dq.total}});
  }`;
  content = replaceOnce(content, "  if(p[1]==='analytics'){", `${endpoint}\n  if(p[1]==='analytics'){`, 'mock intelligence endpoint');
  content = content.replace("version:'2.3.0'", "version:'2.4.0'").replace('CRM V2.3 mock server', 'CRM V2.4 mock server');
  await write(path, content);
}

{
  const path = 'tests/mock-server.test.mjs';
  let content = await read(path);
  content = content.replace("assert.equal(health.version,'2.3.0')", "assert.equal(health.version,'2.4.0')");
  content = appendOnce(content, "test('commercial intelligence mock endpoint", `
test('commercial intelligence mock endpoint is account aware',async()=>{
  const all=await fetch('http://127.0.0.1:8787/api/intelligence').then(r=>r.json());
  const focused=await fetch('http://127.0.0.1:8787/api/intelligence?account=o1').then(r=>r.json());
  assert.equal(all.window_days,90);assert.ok(all.forecast);assert.ok(all.data_quality);assert.ok(Array.isArray(all.risk_deals));
  assert.equal(focused.account_id,'o1');assert.ok(focused.forecast.open_deals<=all.forecast.open_deals);
});
`);
  await write(path, content);
}

{
  const path = 'package.json';
  const pkg = JSON.parse(await read(path));
  pkg.version = '2.4.0';
  pkg.scripts.check = pkg.scripts.check
    .replace('node --check src/email-worker.js', 'node --check src/email-worker.js && node --check src/intelligence.js')
    .replace('node --check public/email.js', 'node --check public/email.js && node --check public/intelligence.js');
  await write(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

console.log('Applied Commercial Intelligence v2.4 integration.');
