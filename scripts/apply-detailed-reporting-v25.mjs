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

const pkg = JSON.parse(await read('package.json'));
const workerBefore = await read('src/worker.js');
const appBefore = await read('public/app.js');
if (pkg.version === '2.5.0' && workerBefore.includes("from './reporting.js'") && appBefore.includes("import('/reporting.js')")) {
  console.log('Detailed Analytics & Reporting v2.5 is already applied.');
  process.exit(0);
}

let worker = workerBefore;
worker = replaceOnce(worker, "import { getCommercialIntelligence } from './intelligence.js';", "import { getCommercialIntelligence } from './intelligence.js';\nimport { getDetailedAnalytics } from './reporting.js';", 'reporting import');
worker = replaceOnce(worker, "if(p[1]==='analytics'&&method==='GET')return json(await analytics(env,ctx));", "if(p[1]==='analytics'&&method==='GET')return json(await getDetailedAnalytics(env,ctx,request));", 'analytics route');
worker = worker.replace("version:'2.4.0'", "version:'2.5.0'");
await write('src/worker.js', worker);

let app = appBefore;
app = replaceOnce(app, "else if(state.route==='analytics')await renderAnalytics();", "else if(state.route==='analytics'){const {renderDetailedAnalytics}=await import('/reporting.js');await renderDetailedAnalytics($('#content'));}", 'analytics browser route');
await write('public/app.js', app);

pkg.version = '2.5.0';
for (const module of ['src/reporting.js','public/reporting.js']) {
  if (!pkg.scripts.check.includes(module)) pkg.scripts.check = pkg.scripts.check.replace(' && node --check scripts/dev-server.mjs', ` && node --check ${module} && node --check scripts/dev-server.mjs`);
}
await write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

try {
  const lock = JSON.parse(await read('package-lock.json'));
  lock.version = '2.5.0';
  if (lock.packages?.['']) lock.packages[''].version = '2.5.0';
  await write('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
} catch { /* lockfile is optional */ }

let mock = await read('scripts/dev-server.mjs');
const analyticsStart = mock.indexOf("  if(p[1]==='analytics'){");
const analyticsEnd = mock.indexOf("  if(p[1]==='search'){", analyticsStart);
if (analyticsStart < 0 || analyticsEnd < 0) throw new Error('Missing mock analytics route');
const mockAnalytics = `  if(p[1]==='analytics'){
    const requestedDays=Math.max(7,Math.min(730,Number(url.searchParams.get('days')||90)||90));
    const to=url.searchParams.get('to')||new Date(now).toISOString().slice(0,10);
    const defaultFrom=new Date(new Date(to+'T00:00:00Z').getTime()-(requestedDays-1)*864e5).toISOString().slice(0,10);
    const from=url.searchParams.get('from')||defaultFrom;
    const start=new Date(from+'T00:00:00Z'),end=new Date(to+'T23:59:59Z');
    const days=Math.round((end-start)/864e5)+1;
    const previousTo=new Date(start.getTime()-864e5),previousFrom=new Date(previousTo.getTime()-(days-1)*864e5);
    const account=url.searchParams.get('account'),owner=url.searchParams.get('owner');
    const inRange=(value,a=start,b=end)=>value&&new Date(value)>=a&&new Date(value)<=b;
    const scoped=(row,ownerField='owner_id')=>(!account||row.organization_id===account)&&(!owner||row[ownerField]===owner);
    const ds=visible(deals,ws).filter((row)=>scoped(row));
    const as=visible(activities,ws).filter((row)=>scoped(row,'user_id'));
    const ts=visible(tasks,ws).filter((row)=>scoped(row,'assignee_id'));
    const fs=visible(followUps,ws).filter((row)=>scoped(row));
    const ms=visible(emailMessages,ws).filter((row)=>scoped(row,'user_id'));
    const cs=visible(contacts,ws).filter((row)=>scoped(row));
    const currentClosed=ds.filter((row)=>['won','lost'].includes(row.stage)&&inRange(row.closed_at));
    const previousClosed=ds.filter((row)=>['won','lost'].includes(row.stage)&&inRange(row.closed_at,previousFrom,previousTo));
    const won=currentClosed.filter((row)=>row.stage==='won'),lost=currentClosed.filter((row)=>row.stage==='lost');
    const previousWon=previousClosed.filter((row)=>row.stage==='won');
    const open=ds.filter((row)=>!['won','lost'].includes(row.stage));
    const periodActivities=as.filter((row)=>inRange(row.occurred_at));
    const previousActivities=as.filter((row)=>inRange(row.occurred_at,previousFrom,previousTo));
    const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
    const rate=(a,b)=>b?Math.round(a/b*1000)/10:0;
    const change=(a,b)=>b?Math.round((a-b)/Math.abs(b)*1000)/10:(a?100:0);
    const group=(rows,key)=>Object.values(rows.reduce((memo,row)=>{const value=row[key]||'Unknown';memo[value]||={ [key]:value,count:0,value:0,weighted:0};memo[value].count++;memo[value].value+=Number(row.value||0);memo[value].weighted+=Number(row.value||0)*Number(row.probability||0)/100;return memo;},{}));
    const revenueMap=won.reduce((memo,row)=>{const period=String(row.closed_at).slice(0,7)+'-01';memo[period]||={period,won_count:0,won_revenue:0,average_deal:0};memo[period].won_count++;memo[period].won_revenue+=Number(row.value||0);memo[period].average_deal=memo[period].won_revenue/memo[period].won_count;return memo;},{});
    const activityMap=periodActivities.reduce((memo,row)=>{const period=String(row.occurred_at).slice(0,10);memo[period]||={period,activities:0,accounts:new Set(),contacts:new Set()};memo[period].activities++;if(row.organization_id)memo[period].accounts.add(row.organization_id);if(row.contact_id)memo[period].contacts.add(row.contact_id);return memo;},{});
    const team=users.filter((user)=>!owner||user.id===owner).map((user)=>{const userActivities=periodActivities.filter((row)=>row.user_id===user.id);const userWon=won.filter((row)=>row.owner_id===user.id);const userOpen=open.filter((row)=>row.owner_id===user.id);return{id:user.id,name:user.name,activities:userActivities.length,won_deals:userWon.length,won_revenue:sum(userWon,'value'),weighted_pipeline:userOpen.reduce((total,row)=>total+Number(row.value||0)*Number(row.probability||0)/100,0),follow_ups_completed:fs.filter((row)=>row.owner_id===user.id&&row.status==='completed'&&inRange(row.completed_at)).length,overdue_tasks:ts.filter((row)=>row.assignee_id===user.id&&!['completed','cancelled'].includes(row.status)&&new Date(row.due_at)<new Date()).length};});
    const sourceRows=Object.values(ds.filter((row)=>inRange(row.created_at)).reduce((memo,row)=>{const source=row.source||'Unknown';memo[source]||={source,opportunities:0,opportunity_value:0,won_count:0,lost_count:0,won_revenue:0};const item=memo[source];item.opportunities++;item.opportunity_value+=Number(row.value||0);if(row.stage==='won'){item.won_count++;item.won_revenue+=Number(row.value||0);}if(row.stage==='lost')item.lost_count++;return memo;},{})).map((row)=>({...row,win_rate:rate(row.won_count,row.won_count+row.lost_count)}));
    const accountRows=visible(organizations,ws).filter((row)=>!account||row.id===account).map((org)=>{const orgWon=won.filter((row)=>row.organization_id===org.id),orgOpen=open.filter((row)=>row.organization_id===org.id);return{id:org.id,name:org.name,account_tier:org.account_tier,relationship_score:org.relationship_score,activities:periodActivities.filter((row)=>row.organization_id===org.id).length,won_revenue:sum(orgWon,'value'),open_pipeline:sum(orgOpen,'value'),weighted_pipeline:orgOpen.reduce((total,row)=>total+Number(row.value||0)*Number(row.probability||0)/100,0),contacts:cs.filter((row)=>row.organization_id===org.id).length};}).sort((a,b)=>b.won_revenue-a.won_revenue||b.open_pipeline-a.open_pipeline).slice(0,25);
    const accountRevenue=accountRows.reduce((total,row)=>total+row.won_revenue,0);accountRows.forEach((row)=>row.revenue_share=accountRevenue?Math.round(row.won_revenue/accountRevenue*1000)/10:0);
    const taskCreated=ts.filter((row)=>inRange(row.created_at)),taskCompleted=ts.filter((row)=>row.status==='completed'&&inRange(row.completed_at));
    const followCreated=fs.filter((row)=>inRange(row.created_at)),followCompleted=fs.filter((row)=>row.status==='completed'&&inRange(row.completed_at));
    const successful=ms.filter((row)=>inRange(row.created_at)&&['sent','delivered'].includes(row.status)).length,failed=ms.filter((row)=>inRange(row.created_at)&&['failed','bounced','suppressed'].includes(row.status)).length;
    const wonRevenue=sum(won,'value'),previousRevenue=sum(previousWon,'value');
    return respond(res,200,{generated_at:iso(),report:{from,to,previous_from:previousFrom.toISOString().slice(0,10),previous_to:previousTo.toISOString().slice(0,10),days,granularity:days>180?'month':days>45?'week':'day',account_id:account||null,owner_id:owner||null,currency:(workspaces.find((row)=>row.id===ws)||workspaces[0]).currency,workspace_name:(workspaces.find((row)=>row.id===ws)||workspaces[0]).name},executive:{won_revenue:wonRevenue,won_revenue_change:change(wonRevenue,previousRevenue),won_deals:won.length,win_rate:rate(won.length,won.length+lost.length),previous_win_rate:rate(previousWon.length,previousClosed.length),average_won_deal:won.length?wonRevenue/won.length:0,average_sales_cycle_days:18,close_date_accuracy:won.length?75:0,open_pipeline:sum(open,'value'),weighted_pipeline:open.reduce((total,row)=>total+Number(row.value||0)*Number(row.probability||0)/100,0),open_deals:open.length,forecast_coverage:rate(open.filter((row)=>row.expected_close_date).length,open.length),next_step_coverage:rate(open.filter((row)=>row.next_step).length,open.length),activities:periodActivities.length,activity_change:change(periodActivities.length,previousActivities.length),active_accounts:new Set(periodActivities.map((row)=>row.organization_id).filter(Boolean)).size,active_contacts:new Set(periodActivities.map((row)=>row.contact_id).filter(Boolean)).size,engagement_minutes:sum(periodActivities,'duration_minutes')},execution:{tasks:{created:taskCreated.length,completed:taskCompleted.length,completed_on_time:taskCompleted.filter((row)=>!row.due_at||new Date(row.completed_at)<=new Date(row.due_at)).length,overdue:ts.filter((row)=>!['completed','cancelled'].includes(row.status)&&new Date(row.due_at)<new Date()).length,average_due_variance_days:0,completion_rate:rate(taskCompleted.length,taskCreated.length),on_time_rate:rate(taskCompleted.filter((row)=>!row.due_at||new Date(row.completed_at)<=new Date(row.due_at)).length,taskCompleted.length)},follow_ups:{created:followCreated.length,completed:followCompleted.length,completed_on_time:followCompleted.filter((row)=>new Date(row.completed_at)<=new Date(row.due_at)).length,overdue:fs.filter((row)=>['open','snoozed'].includes(row.status)&&new Date(row.snoozed_until||row.due_at)<new Date()).length,average_due_variance_days:0,completion_rate:rate(followCompleted.length,followCreated.length),on_time_rate:rate(followCompleted.filter((row)=>new Date(row.completed_at)<=new Date(row.due_at)).length,followCompleted.length)},email:{total:successful+failed,successful,failed,queued:ms.filter((row)=>inRange(row.created_at)&&row.status==='queued').length,recipients:ms.filter((row)=>inRange(row.created_at)).reduce((total,row)=>total+Number(row.recipient_count||(row.to||[]).length),0),average_attempts:1,delivery_rate:rate(successful,successful+failed)}},trends:{revenue:Object.values(revenueMap).sort((a,b)=>a.period.localeCompare(b.period)),activity:Object.values(activityMap).map((row)=>({...row,accounts:row.accounts.size,contacts:row.contacts.size})).sort((a,b)=>a.period.localeCompare(b.period)),granularity:days>180?'month':days>45?'week':'day'},activity_mix:Object.values(periodActivities.reduce((memo,row)=>{const type=row.type||'other';memo[type]||={type,count:0,duration_minutes:0};memo[type].count++;memo[type].duration_minutes+=Number(row.duration_minutes||0);return memo;},{})),funnel:group(ds,'stage'),team_performance:team,source_performance:sourceRows,account_performance:accountRows,loss_reasons:Object.values(lost.reduce((memo,row)=>{const reason=row.loss_reason||row.close_reason||'Unspecified';memo[reason]||={reason,count:0,lost_value:0};memo[reason].count++;memo[reason].lost_value+=Number(row.value||0);return memo;},{})),relationship_health:{strong:cs.filter((row)=>row.relationship_score>=80).length,healthy:cs.filter((row)=>row.relationship_score>=55&&row.relationship_score<80).length,attention:cs.filter((row)=>row.relationship_score>=35&&row.relationship_score<55).length,at_risk:cs.filter((row)=>row.relationship_score<35).length,average_score:cs.length?cs.reduce((total,row)=>total+Number(row.relationship_score||0),0)/cs.length:0},lifecycle:Object.values(cs.reduce((memo,row)=>{const stage=row.lifecycle_stage||'lead';memo[stage]||={lifecycle_stage:stage,count:0};memo[stage].count++;return memo;},{})),comparison:{previous_won_revenue:previousRevenue,previous_won_deals:previousWon.length,previous_activities:previousActivities.length,previous_active_accounts:new Set(previousActivities.map((row)=>row.organization_id).filter(Boolean)).size}});
  }
`;
mock = `${mock.slice(0, analyticsStart)}${mockAnalytics}${mock.slice(analyticsEnd)}`;
mock = mock.replace("version:'2.4.0'", "version:'2.5.0'").replace('CRM V2.4 mock server', 'CRM V2.5 mock server');
await write('scripts/dev-server.mjs', mock);

let emailTest = await read('tests/email-center.test.mjs');
emailTest = emailTest
  .replace("test('release and mock server identify v2.4.0'", "test('release and mock server identify v2.5.0'")
  .replace("assert.equal(JSON.parse(pkg).version, '2.4.0')", "assert.equal(JSON.parse(pkg).version, '2.5.0')")
  .replace(/version:'2\\\.4\\\.0'/g, "version:'2\\.5\\.0'");
await write('tests/email-center.test.mjs', emailTest);

let mockTest = await read('tests/mock-server.test.mjs');
mockTest = mockTest.replace("assert.equal(health.version,'2.4.0')", "assert.equal(health.version,'2.5.0')");
mockTest = appendOnce(mockTest, "test('detailed analytics endpoint supports report filters", `test('detailed analytics endpoint supports report filters and comparisons', async()=>{
  const report=await fetch('http://127.0.0.1:8787/api/analytics?days=30&account=o1').then((response)=>response.json());
  assert.equal(report.report.days,30);
  assert.equal(report.report.account_id,'o1');
  assert.ok(Object.hasOwn(report.executive,'won_revenue_change'));
  assert.ok(Array.isArray(report.team_performance));
  assert.ok(Array.isArray(report.source_performance));
  assert.ok(Object.hasOwn(report.execution.email,'delivery_rate'));
});`);
await write('tests/mock-server.test.mjs', mockTest);

let styles = await read('public/styles.css');
styles = appendOnce(styles, '.report-page-header', `
.report-page-header{align-items:flex-start}.report-actions{flex-wrap:wrap}.report-filters{margin-bottom:16px}.report-filters .toolbar{align-items:flex-end}.field.compact{min-width:145px}.field.compact label{font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em}.report-metrics-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.report-metric{position:relative;overflow:hidden}.report-metric.green{--metric-soft:var(--green-soft)}.report-metric.red{--metric-soft:var(--red-soft)}.report-metric.primary{--metric-soft:var(--primary-soft)}.report-metric.blue{--metric-soft:var(--blue-soft)}.report-trend{display:block;margin-top:8px;font-size:10px;font-weight:700}.report-trend.positive{color:var(--green)}.report-trend.negative{color:var(--red)}.report-trend.neutral{color:var(--muted)}.report-executive{margin-bottom:16px}.report-executive ul{margin:0;padding-left:20px;display:grid;gap:8px;color:var(--text)}.report-vertical-chart{height:260px;display:flex;align-items:flex-end;gap:8px;overflow-x:auto;padding:24px 4px 0}.report-chart-column{height:100%;min-width:54px;flex:1;display:grid;grid-template-rows:20px 1fr 34px;align-items:end;text-align:center}.report-chart-value{font-size:9px;color:var(--muted);white-space:nowrap}.report-chart-bar{position:relative;min-height:2px;background:linear-gradient(180deg,var(--primary),var(--blue));border-radius:7px 7px 2px 2px;overflow:hidden}.report-chart-bar span{position:absolute;left:0;right:0;bottom:0;background:color-mix(in srgb,var(--green) 75%,transparent);border-top:1px solid color-mix(in srgb,var(--green) 80%,white)}.report-chart-column small{font-size:9px;color:var(--muted);transform:rotate(-30deg);transform-origin:center;white-space:nowrap}.report-chart-empty{width:100%;align-self:center}.report-funnel{display:grid;grid-template-columns:repeat(7,minmax(110px,1fr));gap:10px;overflow-x:auto}.report-funnel-card{background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:14px;min-width:110px}.report-funnel-card span,.report-funnel-card small{display:block;color:var(--muted);font-size:10px}.report-funnel-card strong{display:block;font-size:24px;margin:6px 0}.report-funnel-card div{height:5px;background:var(--border);border-radius:99px;overflow:hidden;margin-top:10px}.report-funnel-card i{display:block;height:100%;background:var(--primary);border-radius:inherit}.report-horizontal-list{display:grid;gap:11px}.report-horizontal-row{display:grid;grid-template-columns:minmax(100px,160px) 1fr auto;gap:10px;align-items:center}.report-horizontal-row label{font-size:11px;font-weight:700}.report-horizontal-row strong{font-size:11px}.report-track{height:8px;background:var(--surface-2);border-radius:99px;overflow:hidden}.report-track span{display:block;height:100%;background:linear-gradient(90deg,var(--primary),var(--blue));border-radius:inherit}.report-score{font-size:28px}.report-sla-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.report-sla-grid article{padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2)}.report-sla-grid span,.report-sla-grid small{display:block;color:var(--muted);font-size:10px}.report-sla-grid strong{display:block;font-size:24px;margin:5px 0}.report-methodology time{font-size:10px;color:var(--muted)}
@media(max-width:1100px){.report-metrics-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.report-funnel{grid-template-columns:repeat(4,minmax(120px,1fr))}}
@media(max-width:700px){.report-metrics-grid{grid-template-columns:1fr}.report-sla-grid{grid-template-columns:1fr}.report-horizontal-row{grid-template-columns:100px 1fr auto}.report-filters .toolbar>*{width:100%}.report-funnel{grid-template-columns:repeat(2,minmax(120px,1fr))}}
@media print{body{background:#fff!important}.sidebar,.topbar,.report-filters,.report-actions,.toast-stack{display:none!important}.app-shell,.main-content{display:block!important}.main-content{margin:0!important;padding:0!important}.content{overflow:visible!important}.panel,.metric-card{break-inside:avoid;box-shadow:none!important;border-color:#d8d8d8!important}.layout-grid{display:grid!important;grid-template-columns:1fr 1fr!important}.report-page-header{margin-bottom:12px}.report-vertical-chart{overflow:visible}.table-wrap{overflow:visible}table{font-size:9px}.report-methodology{page-break-before:always}}
`);
await write('public/styles.css', styles);

console.log('Applied detailed Analytics & Reporting v2.5 integration.');
