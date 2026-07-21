const reportingState = {
  preset: localStorage.getItem('pmg-report-period') || '90',
  from: '',
  to: '',
  owner: localStorage.getItem('pmg-report-owner') || '',
  data: null,
  users: [],
};

const reportEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
const reportTitle = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
const reportWorkspace = () => localStorage.getItem('pmg-workspace') || '';
const reportAccount = () => localStorage.getItem('pmg-account') || '';

async function reportingApi(path) {
  const headers = {};
  if (reportWorkspace()) headers['x-workspace-id'] = reportWorkspace();
  const response = await fetch(path, { headers });
  const payload = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || payload || `Request failed (${response.status})`);
  return payload;
}

function reportCurrency(value) {
  const currency = reportingState.data?.report?.currency || 'EUR';
  try { return new Intl.NumberFormat('en-NL', { style:'currency', currency, notation:'compact', maximumFractionDigits:1 }).format(Number(value || 0)); }
  catch { return `${currency} ${Number(value || 0).toLocaleString()}`; }
}

function reportNumber(value) {
  return new Intl.NumberFormat('en', { notation:'compact', maximumFractionDigits:1 }).format(Number(value || 0));
}

function reportPercent(value) {
  return `${Math.round(Number(value || 0) * 10) / 10}%`;
}

function reportDate(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0,10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric' }).format(date);
}

function trend(value, suffix = 'vs previous period') {
  const amount = Number(value || 0);
  const tone = amount > 0 ? 'positive' : amount < 0 ? 'negative' : 'neutral';
  const arrow = amount > 0 ? '↑' : amount < 0 ? '↓' : '→';
  return `<span class="report-trend ${tone}">${arrow} ${Math.abs(amount).toFixed(1)}% ${reportEscape(suffix)}</span>`;
}

function metric(label, value, caption, change = null, tone = '') {
  return `<article class="metric-card report-metric ${tone}"><span class="metric-label">${reportEscape(label)}</span><strong class="metric-value">${reportEscape(value)}</strong><span class="metric-caption">${reportEscape(caption)}</span>${change === null ? '' : trend(change)}</article>`;
}

function horizontalRows(rows, label, value, formatter = reportNumber) {
  const max = Math.max(1, ...rows.map((row) => Number(value(row) || 0)));
  return rows.length ? rows.map((row) => {
    const raw = Number(value(row) || 0);
    return `<div class="report-horizontal-row"><label>${reportEscape(label(row))}</label><div class="report-track"><span style="width:${Math.max(raw ? 2 : 0, raw / max * 100)}%"></span></div><strong>${reportEscape(formatter(raw))}</strong></div>`;
  }).join('') : '<div class="empty-state"><strong>No data in this period</strong><span>Activity will appear when records match the selected report filters.</span></div>';
}

function verticalChart(rows, valueKey, formatter, secondaryKey = '') {
  const max = Math.max(1, ...rows.map((row) => Number(row[valueKey] || 0)));
  return rows.length ? rows.map((row) => {
    const primary = Number(row[valueKey] || 0);
    const secondary = secondaryKey ? Number(row[secondaryKey] || 0) : 0;
    const secondaryHeight = primary ? Math.min(100, secondary / primary * 100) : 0;
    return `<div class="report-chart-column"><div class="report-chart-value">${reportEscape(formatter(primary))}</div><div class="report-chart-bar" style="height:${Math.max(primary ? 6 : 1, primary / max * 100)}%">${secondaryKey ? `<span style="height:${secondaryHeight}%"></span>` : ''}</div><small>${reportEscape(reportDate(row.period))}</small></div>`;
  }).join('') : '<div class="empty-state report-chart-empty"><strong>No trend data</strong><span>This report period has no matching records.</span></div>';
}

function funnelCards(rows) {
  const order = ['lead','qualified','discovery','proposal','negotiation','won','lost'];
  return [...rows].sort((a,b) => order.indexOf(a.stage) - order.indexOf(b.stage)).map((row) => `<article class="report-funnel-card"><span>${reportEscape(reportTitle(row.stage))}</span><strong>${Number(row.count || 0)}</strong><small>${reportEscape(reportCurrency(row.value))}</small><div><i style="width:${Math.max(2, Number(row.weighted || 0) / Math.max(1, Number(row.value || 0)) * 100)}%"></i></div></article>`).join('') || '<div class="empty-state"><strong>No opportunities</strong><span>The selected scope contains no pipeline records.</span></div>';
}

function executiveNarrative(data) {
  const e = data.executive || {};
  const points = [];
  if (Number(e.won_revenue_change) > 5) points.push(`Won revenue increased ${Math.abs(Number(e.won_revenue_change)).toFixed(1)}% versus the previous comparable period.`);
  else if (Number(e.won_revenue_change) < -5) points.push(`Won revenue declined ${Math.abs(Number(e.won_revenue_change)).toFixed(1)}% versus the previous comparable period.`);
  else points.push('Won revenue is broadly stable versus the previous comparable period.');
  points.push(`${reportPercent(e.win_rate)} of closed opportunities were won, with an average successful deal of ${reportCurrency(e.average_won_deal)}.`);
  if (Number(e.forecast_coverage) < 80) points.push(`Forecast coverage is ${reportPercent(e.forecast_coverage)}; open deals without expected close dates reduce planning confidence.`);
  if (Number(e.next_step_coverage) < 80) points.push(`Only ${reportPercent(e.next_step_coverage)} of open opportunities have a recorded next step.`);
  if (Number(data.execution?.tasks?.overdue) || Number(data.execution?.follow_ups?.overdue)) points.push(`${Number(data.execution?.tasks?.overdue || 0)} tasks and ${Number(data.execution?.follow_ups?.overdue || 0)} follow-ups are overdue.`);
  if (Number(data.execution?.email?.failed)) points.push(`Email delivery requires attention: ${Number(data.execution.email.failed)} messages failed, bounced or were suppressed.`);
  return points.slice(0, 6).map((point) => `<li>${reportEscape(point)}</li>`).join('');
}

function sourceTable(rows) {
  return rows.length ? rows.map((row) => `<tr><td><strong>${reportEscape(row.source)}</strong></td><td>${Number(row.opportunities || 0)}</td><td>${reportCurrency(row.opportunity_value)}</td><td>${Number(row.won_count || 0)}</td><td>${reportPercent(row.win_rate)}</td><td>${reportCurrency(row.won_revenue)}</td></tr>`).join('') : '<tr><td colspan="6"><div class="empty-state"><strong>No source data</strong><span>Add a source to opportunities to compare acquisition performance.</span></div></td></tr>';
}

function teamTable(rows) {
  return rows.length ? rows.map((row) => `<tr><td><strong>${reportEscape(row.name)}</strong></td><td>${Number(row.activities || 0)}</td><td>${Number(row.won_deals || 0)}</td><td>${reportCurrency(row.won_revenue)}</td><td>${reportCurrency(row.weighted_pipeline)}</td><td>${Number(row.follow_ups_completed || 0)}</td><td><span class="badge ${Number(row.overdue_tasks || 0) ? 'red' : 'green'}">${Number(row.overdue_tasks || 0)}</span></td></tr>`).join('') : '<tr><td colspan="7"><div class="empty-state"><strong>No team activity</strong><span>No team members match this report scope.</span></div></td></tr>';
}

function accountTable(rows) {
  return rows.length ? rows.map((row) => `<tr><td><button class="row-action" data-open-organization="${reportEscape(row.id)}"><strong>${reportEscape(row.name)}</strong></button></td><td><span class="badge">${reportEscape(reportTitle(row.account_tier))}</span></td><td>${Number(row.activities || 0)}</td><td>${reportCurrency(row.won_revenue)}</td><td>${reportCurrency(row.open_pipeline)}</td><td>${reportCurrency(row.weighted_pipeline)}</td><td>${reportPercent(row.revenue_share)}</td><td><span class="badge ${Number(row.relationship_score || 0) < 35 ? 'red' : Number(row.relationship_score || 0) < 55 ? 'amber' : 'green'}">${Number(row.relationship_score || 0)}</span></td></tr>`).join('') : '<tr><td colspan="8"><div class="empty-state"><strong>No account performance data</strong><span>No active accounts match this report scope.</span></div></td></tr>';
}

function reportCsv(data) {
  const quote = (value) => `"${String(value ?? '').replaceAll('"','""')}"`;
  const rows = [['section','metric','dimension','value','secondary_value','notes']];
  const push = (...values) => rows.push(values.map(quote));
  const e = data.executive || {};
  push('Executive','Won revenue','',e.won_revenue,e.won_revenue_change,'Change vs previous period (%)');
  push('Executive','Win rate','',e.win_rate,e.won_deals,'Percent; won deals');
  push('Executive','Open pipeline','',e.open_pipeline,e.weighted_pipeline,'Total; probability weighted');
  push('Executive','Activities','',e.activities,e.activity_change,'Count; change vs previous (%)');
  push('Execution','Task completion','',data.execution?.tasks?.completion_rate,data.execution?.tasks?.overdue,'Percent; overdue');
  push('Execution','Follow-up completion','',data.execution?.follow_ups?.completion_rate,data.execution?.follow_ups?.overdue,'Percent; overdue');
  push('Execution','Email delivery','',data.execution?.email?.delivery_rate,data.execution?.email?.failed,'Percent; failed');
  (data.trends?.revenue || []).forEach((row) => push('Revenue trend','Won revenue',row.period,row.won_revenue,row.won_count,'Revenue; won deals'));
  (data.trends?.activity || []).forEach((row) => push('Activity trend','Activities',row.period,row.activities,row.accounts,'Activities; active accounts'));
  (data.funnel || []).forEach((row) => push('Pipeline funnel',row.stage,'',row.count,row.value,'Deal count; total value'));
  (data.team_performance || []).forEach((row) => push('Team',row.name,'',row.won_revenue,row.activities,'Won revenue; activities'));
  (data.source_performance || []).forEach((row) => push('Source',row.source,'',row.won_revenue,row.win_rate,'Won revenue; win rate (%)'));
  (data.account_performance || []).forEach((row) => push('Account',row.name,'',row.won_revenue,row.open_pipeline,'Won revenue; open pipeline'));
  (data.loss_reasons || []).forEach((row) => push('Loss reason',row.reason,'',row.count,row.lost_value,'Lost deals; lost value'));
  return rows.map((row) => row.join(',')).join('\n');
}

function downloadReport(data, format = 'csv') {
  const content = format === 'json' ? JSON.stringify(data, null, 2) : reportCsv(data);
  const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `pmg-analytics-${data.report.from}-${data.report.to}.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function loadReport() {
  const query = new URLSearchParams();
  if (reportingState.from && reportingState.to) { query.set('from', reportingState.from); query.set('to', reportingState.to); }
  else query.set('days', reportingState.preset);
  if (reportAccount()) query.set('account', reportAccount());
  if (reportingState.owner) query.set('owner', reportingState.owner);
  const [data, users] = await Promise.all([reportingApi(`/api/analytics?${query}`), reportingApi('/api/users')]);
  reportingState.data = data;
  reportingState.users = users;
}

async function renderDetailedAnalytics(root = document.querySelector('#content')) {
  root.innerHTML = '<div class="loading-state"><span class="spinner"></span><span>Building detailed analytics and reports…</span></div>';
  try { await loadReport(); }
  catch (error) {
    root.innerHTML = `<div class="empty-state"><strong>Unable to build report</strong><span>${reportEscape(error.message)}</span><div style="margin-top:12px"><button class="button secondary" data-report-refresh>Try again</button></div></div>`;
    root.querySelector('[data-report-refresh]')?.addEventListener('click', () => renderDetailedAnalytics(root));
    return;
  }

  const data = reportingState.data;
  const e = data.executive || {};
  const tasks = data.execution?.tasks || {};
  const followUps = data.execution?.follow_ups || {};
  const email = data.execution?.email || {};
  const health = data.relationship_health || {};
  const accountName = document.querySelector('#accountSwitcher')?.selectedOptions?.[0]?.textContent;
  const focused = data.report.account_id && accountName && accountName !== 'All accounts';
  const ownerName = reportingState.users.find((user) => user.id === data.report.owner_id)?.name;

  root.innerHTML = `
    <header class="page-header report-page-header"><div><p class="eyebrow">Executive analytics and management reporting</p><h1>Analytics & Reporting</h1><p>${reportEscape(data.report.workspace_name)} · ${reportDate(data.report.from)}–${reportDate(data.report.to)}${focused ? ` · ${reportEscape(accountName)}` : ''}${ownerName ? ` · ${reportEscape(ownerName)}` : ''}</p></div><div class="page-actions report-actions"><button class="button secondary" data-report-json>JSON</button><button class="button secondary" data-report-export>Export CSV</button><button class="button secondary" data-report-print>Print / PDF</button><button class="button primary" data-report-refresh>Refresh</button></div></header>

    <section class="panel report-filters"><div class="toolbar"><select id="reportPreset" aria-label="Reporting period"><option value="30" ${reportingState.preset==='30'&&!reportingState.from?'selected':''}>Last 30 days</option><option value="90" ${reportingState.preset==='90'&&!reportingState.from?'selected':''}>Last 90 days</option><option value="180" ${reportingState.preset==='180'&&!reportingState.from?'selected':''}>Last 180 days</option><option value="365" ${reportingState.preset==='365'&&!reportingState.from?'selected':''}>Last 12 months</option><option value="custom" ${reportingState.from?'selected':''}>Custom dates</option></select><div class="field compact"><label for="reportFrom">From</label><input id="reportFrom" type="date" value="${reportEscape(data.report.from)}"></div><div class="field compact"><label for="reportTo">To</label><input id="reportTo" type="date" value="${reportEscape(data.report.to)}"></div><select id="reportOwner" aria-label="Report owner"><option value="">All team members</option>${reportingState.users.map((user) => `<option value="${reportEscape(user.id)}" ${user.id===reportingState.owner?'selected':''}>${reportEscape(user.name)}</option>`).join('')}</select><button class="button primary" data-report-apply>Apply filters</button></div></section>

    <section class="metrics-grid report-metrics-grid">
      ${metric('Won revenue', reportCurrency(e.won_revenue), `${e.won_deals || 0} won deals`, e.won_revenue_change, Number(e.won_revenue_change) >= 0 ? 'green' : 'red')}
      ${metric('Win rate', reportPercent(e.win_rate), `${reportPercent(e.previous_win_rate)} previous period`, null, Number(e.win_rate) >= 50 ? 'green' : 'amber')}
      ${metric('Weighted pipeline', reportCurrency(e.weighted_pipeline), `${reportCurrency(e.open_pipeline)} total open`, null, 'primary')}
      ${metric('Average won deal', reportCurrency(e.average_won_deal), `${Number(e.average_sales_cycle_days || 0).toFixed(1)} day sales cycle`, null, 'blue')}
      ${metric('Commercial activity', reportNumber(e.activities), `${e.active_accounts || 0} active accounts`, e.activity_change, Number(e.activity_change) >= 0 ? 'green' : 'amber')}
      ${metric('Forecast coverage', reportPercent(e.forecast_coverage), `${reportPercent(e.next_step_coverage)} next-step coverage`, null, Number(e.forecast_coverage) >= 85 ? 'green' : 'amber')}
      ${metric('Close-date accuracy', reportPercent(e.close_date_accuracy), 'Won within ±7 days of forecast', null, Number(e.close_date_accuracy) >= 70 ? 'green' : 'amber')}
      ${metric('Email delivery', reportPercent(email.delivery_rate), `${email.failed || 0} failed · ${email.recipients || 0} recipients`, null, Number(email.delivery_rate) >= 95 ? 'green' : 'amber')}
    </section>

    <section class="panel report-executive"><header class="panel-header"><div><h2>Executive readout</h2><p>Automatically generated observations from the selected reporting scope</p></div><span class="badge blue">${data.report.days} days</span></header><div class="panel-body"><ul>${executiveNarrative(data)}</ul></div></section>

    <section class="layout-grid equal report-chart-grid">
      <article class="panel"><header class="panel-header"><div><h2>Won revenue trend</h2><p>${reportTitle(data.trends?.granularity)} reporting buckets</p></div><span class="badge green">${reportCurrency(e.won_revenue)}</span></header><div class="panel-body"><div class="report-vertical-chart">${verticalChart(data.trends?.revenue || [], 'won_revenue', reportCurrency, 'average_deal')}</div></div></article>
      <article class="panel"><header class="panel-header"><div><h2>Activity trend</h2><p>Touches and active-account reach</p></div><span class="badge blue">${reportNumber(e.activities)} touches</span></header><div class="panel-body"><div class="report-vertical-chart">${verticalChart(data.trends?.activity || [], 'activities', reportNumber, 'accounts')}</div></div></article>
    </section>

    <section class="panel"><header class="panel-header"><div><h2>Pipeline funnel</h2><p>Current opportunity volume, value and probability weighting</p></div><span class="badge purple">${e.open_deals || 0} open</span></header><div class="panel-body"><div class="report-funnel">${funnelCards(data.funnel || [])}</div></div></section>

    <section class="layout-grid equal">
      <article class="panel"><header class="panel-header"><div><h2>Activity mix</h2><p>Channel and interaction composition</p></div></header><div class="panel-body report-horizontal-list">${horizontalRows(data.activity_mix || [], (row) => reportTitle(row.type), (row) => row.count)}</div></article>
      <article class="panel"><header class="panel-header"><div><h2>Relationship health</h2><p>Current active-contact engagement distribution</p></div><strong class="report-score">${Math.round(Number(health.average_score || 0))}</strong></header><div class="panel-body report-horizontal-list">${horizontalRows([{label:'Strong',value:health.strong},{label:'Healthy',value:health.healthy},{label:'Needs attention',value:health.attention},{label:'At risk',value:health.at_risk}], (row) => row.label, (row) => row.value)}</div></article>
    </section>

    <section class="layout-grid equal">
      <article class="panel"><header class="panel-header"><div><h2>Execution discipline</h2><p>Task and follow-up service levels</p></div></header><div class="panel-body"><div class="report-sla-grid"><article><span>Task completion</span><strong>${reportPercent(tasks.completion_rate)}</strong><small>${tasks.completed || 0} completed · ${tasks.overdue || 0} overdue</small></article><article><span>Tasks on time</span><strong>${reportPercent(tasks.on_time_rate)}</strong><small>${Number(tasks.average_due_variance_days || 0).toFixed(1)} avg due variance days</small></article><article><span>Follow-up completion</span><strong>${reportPercent(followUps.completion_rate)}</strong><small>${followUps.completed || 0} completed · ${followUps.overdue || 0} overdue</small></article><article><span>Follow-ups on time</span><strong>${reportPercent(followUps.on_time_rate)}</strong><small>${Number(followUps.average_due_variance_days || 0).toFixed(1)} avg due variance days</small></article></div></div></article>
      <article class="panel"><header class="panel-header"><div><h2>Email operations</h2><p>Account-linked outbound delivery performance</p></div></header><div class="panel-body"><div class="report-sla-grid"><article><span>Delivery rate</span><strong>${reportPercent(email.delivery_rate)}</strong><small>${email.successful || 0} successful</small></article><article><span>Failed</span><strong>${email.failed || 0}</strong><small>Failed, bounced or suppressed</small></article><article><span>Recipients</span><strong>${email.recipients || 0}</strong><small>Across To, CC and BCC</small></article><article><span>Average attempts</span><strong>${Number(email.average_attempts || 0).toFixed(1)}</strong><small>${email.queued || 0} currently queued</small></article></div></div></article>
    </section>

    <section class="panel"><header class="panel-header"><div><h2>Team performance</h2><p>Commercial outcomes, engagement and execution by owner</p></div></header><div class="table-wrap"><table><thead><tr><th>Team member</th><th>Activities</th><th>Won deals</th><th>Won revenue</th><th>Weighted pipeline</th><th>Follow-ups completed</th><th>Overdue tasks</th></tr></thead><tbody>${teamTable(data.team_performance || [])}</tbody></table></div></section>

    <section class="layout-grid equal">
      <article class="panel"><header class="panel-header"><div><h2>Source performance</h2><p>Opportunities created in the selected period</p></div></header><div class="table-wrap"><table><thead><tr><th>Source</th><th>Opportunities</th><th>Value</th><th>Won</th><th>Win rate</th><th>Won revenue</th></tr></thead><tbody>${sourceTable(data.source_performance || [])}</tbody></table></div></article>
      <article class="panel"><header class="panel-header"><div><h2>Loss analysis</h2><p>Recorded reasons and value at risk</p></div></header><div class="panel-body report-horizontal-list">${horizontalRows(data.loss_reasons || [], (row) => row.reason, (row) => row.lost_value, reportCurrency)}</div></article>
    </section>

    <section class="panel"><header class="panel-header"><div><h2>Account performance and concentration</h2><p>Revenue, engagement, current pipeline and relationship strength</p></div><span class="badge">Top ${Math.min(25, (data.account_performance || []).length)} accounts</span></header><div class="table-wrap"><table><thead><tr><th>Account</th><th>Tier</th><th>Activities</th><th>Won revenue</th><th>Open pipeline</th><th>Weighted</th><th>Revenue share</th><th>Health</th></tr></thead><tbody>${accountTable(data.account_performance || [])}</tbody></table></div></section>

    <section class="panel report-methodology"><header class="panel-header"><div><h2>Report definitions</h2><p>How to interpret this management report</p></div><time>Generated ${new Date(data.generated_at).toLocaleString()}</time></header><div class="panel-body detail-grid"><div class="detail-field"><span>Period comparison</span><strong>${reportDate(data.report.previous_from)}–${reportDate(data.report.previous_to)}</strong></div><div class="detail-field"><span>Revenue recognition</span><strong>Won deals by closed date</strong></div><div class="detail-field"><span>Pipeline</span><strong>Current open opportunity snapshot</strong></div><div class="detail-field"><span>Close-date accuracy</span><strong>Won within ±7 days of expected close</strong></div><div class="detail-field"><span>Source performance</span><strong>Deals created during report period</strong></div><div class="detail-field"><span>Scope</span><strong>${focused ? reportEscape(accountName) : 'All accounts'}${ownerName ? ` · ${reportEscape(ownerName)}` : ''}</strong></div></div></section>`;

  root.querySelector('[data-report-refresh]')?.addEventListener('click', () => renderDetailedAnalytics(root));
  root.querySelector('[data-report-export]')?.addEventListener('click', () => downloadReport(data, 'csv'));
  root.querySelector('[data-report-json]')?.addEventListener('click', () => downloadReport(data, 'json'));
  root.querySelector('[data-report-print]')?.addEventListener('click', () => window.print());
  root.querySelector('[data-report-apply]')?.addEventListener('click', () => {
    const preset = root.querySelector('#reportPreset')?.value || '90';
    const from = root.querySelector('#reportFrom')?.value || '';
    const to = root.querySelector('#reportTo')?.value || '';
    reportingState.owner = root.querySelector('#reportOwner')?.value || '';
    if (preset === 'custom') { reportingState.from = from; reportingState.to = to; }
    else { reportingState.preset = preset; reportingState.from = ''; reportingState.to = ''; }
    localStorage.setItem('pmg-report-period', reportingState.preset);
    if (reportingState.owner) localStorage.setItem('pmg-report-owner', reportingState.owner); else localStorage.removeItem('pmg-report-owner');
    renderDetailedAnalytics(root);
  });
  root.querySelector('#reportPreset')?.addEventListener('change', (event) => {
    const custom = event.target.value === 'custom';
    root.querySelector('#reportFrom').disabled = !custom;
    root.querySelector('#reportTo').disabled = !custom;
  });
  const customActive = root.querySelector('#reportPreset')?.value === 'custom';
  if (root.querySelector('#reportFrom')) root.querySelector('#reportFrom').disabled = !customActive;
  if (root.querySelector('#reportTo')) root.querySelector('#reportTo').disabled = !customActive;
}

export { renderDetailedAnalytics };
