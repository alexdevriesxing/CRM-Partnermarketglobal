import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

let server;
let baseUrl;
const availablePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
test.before(async()=>{
  const port=await availablePort();baseUrl=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,['scripts/dev-server.mjs'],{cwd:new URL('..',import.meta.url),stdio:'ignore',env:{...process.env,PORT:String(port)}});
  for(let i=0;i<40;i+=1){try{const r=await fetch(`${baseUrl}/health`);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}
  throw new Error('Mock server did not start');
});
test.after(()=>server?.kill());

test('mock app serves shell and health',async()=>{
  const health=await fetch(`${baseUrl}/health`).then(r=>r.json());assert.equal(health.ok,true);assert.equal(health.version,'2.5.0');
  const html=await fetch(baseUrl).then(r=>r.text());assert.match(html,/PartnerMarket Global CRM/);assert.match(html,/workspaceSwitcher/);
});

test('workspace header switches logical database',async()=>{
  const pmg=await fetch(`${baseUrl}/api/contacts`).then(r=>r.json());
  const gdc=await fetch(`${baseUrl}/api/contacts`,{headers:{'x-workspace-id':'ws-gdc'}}).then(r=>r.json());
  assert.ok(pmg.total>gdc.total);assert.equal(gdc.items[0].first_name,'Daniel');
});

test('follow-up completion writes contact log',async()=>{
  const before=await fetch(`${baseUrl}/api/activities`).then(r=>r.json());
  const response=await fetch(`${baseUrl}/api/follow-ups/f2/complete`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({log_activity:{type:'call',subject:'Budget call completed',body:'Agreed next step'}})});
  assert.equal(response.status,200);
  const after=await fetch(`${baseUrl}/api/activities`).then(r=>r.json());
  assert.equal(after.length,before.length+1);assert.equal(after[0].subject,'Budget call completed');
});

test('task creation and completion work',async()=>{
  const created=await fetch(`${baseUrl}/api/tasks`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Test task',priority:'high',task_type:'call',due_at:new Date().toISOString()})}).then(r=>r.json());
  assert.equal(created.title,'Test task');
  const completed=await fetch(`${baseUrl}/api/tasks/${created.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:'completed'})}).then(r=>r.json());
  assert.equal(completed.status,'completed');
});

test('commercial intelligence mock endpoint is account aware',async()=>{
  const all=await fetch(`${baseUrl}/api/intelligence`).then(r=>r.json());
  const focused=await fetch(`${baseUrl}/api/intelligence?account=o1`).then(r=>r.json());
  assert.equal(all.window_days,30);assert.ok(all.forecast);assert.ok(all.data_quality);assert.ok(Array.isArray(all.risk_deals));
  assert.equal(focused.account_id,'o1');assert.equal(focused.stale_after_days,30);assert.equal(focused.stale_after_days,30);assert.ok(focused.forecast.open_deals<=all.forecast.open_deals);
});

test('detailed analytics endpoint supports report filters and comparisons', async()=>{
  const report=await fetch(`${baseUrl}/api/analytics?days=30&account=o1`).then((response)=>response.json());
  assert.equal(report.report.days,30);
  assert.equal(report.report.account_id,'o1');
  assert.ok(Object.hasOwn(report.executive,'won_revenue_change'));
  assert.ok(Array.isArray(report.team_performance));
  assert.ok(Array.isArray(report.source_performance));
  assert.ok(Object.hasOwn(report.execution.email,'delivery_rate'));
});
