const intelligenceState = {
  days: '30',
  data: null,
  workspace: null,
};

const intelEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
const intelTitle = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
const intelWorkspaceId = () => localStorage.getItem('pmg-workspace') || '';
const intelAccountId = () => localStorage.getItem('pmg-account') || '';

async function intelligenceApi(path) {
  const headers = {};
  if (intelWorkspaceId()) headers['x-workspace-id'] = intelWorkspaceId();
  const response = await fetch(path, { headers });
  const payload = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || payload || `Request failed (${response.status})`);
  return payload;
}

function intelCurrency(value) {
  const currency = intelligenceState.workspace?.currency || 'EUR';
  try { return new Intl.NumberFormat('en-NL', { style:'currency', currency, notation:'compact', maximumFractionDigits:1 }).format(Number(value || 0)); }
  catch { return `${currency} ${Number(value || 0).toLocaleString()}`; }
}

function intelDate(value, includeTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', includeTime ? { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' } : { day:'numeric', month:'short', year:'numeric' }).format(date);
}

function intelMetric(label, value, caption, tone = '') {
  return `<article class="metric-card intelligence-metric ${tone}"><span class="metric-label">${intelEscape(label)}</span><strong class="metric-value">${intelEscape(value)}</strong><span class="metric-caption">${intelEscape(caption)}</span></article>`;
}

function riskBadge(score) {
  const value = Number(score || 0);
  const tone = value >= 70 ? 'red' : value >= 45 ? 'amber' : 'primary';
  return `<span class="badge ${tone}">Risk ${value}</span>`;
}

function qualityBar(label, issueCount, total, description) {
  const issues = Number(issueCount || 0);
  const denominator = Math.max(1, Number(total || 0));
  const complete = Math.max(0, Math.round((1 - issues / denominator) * 100));
  return `<div class="intelligence-quality-row"><div><strong>${intelEscape(label)}</strong><small>${intelEscape(description)}</small></div><div class="intelligence-quality-track"><span style="width:${complete}%"></span></div><b>${complete}%</b><em>${issues} issue${issues === 1 ? '' : 's'}</em></div>`;
}

function riskDealRow(deal) {
  const reasons = (deal.risk_reasons || []).map((reason) => `<span class="badge">${intelEscape(reason)}</span>`).join(' ');
  return `<tr><td><strong>${intelEscape(deal.name)}</strong><small class="table-subline">${intelEscape(deal.organization_name || 'No account')} · ${intelEscape(deal.owner_name || 'Unassigned')}</small></td><td><span class="badge blue">${intelEscape(intelTitle(deal.stage))}</span></td><td>${intelCurrency(deal.value)}</td><td>${intelDate(deal.expected_close_date)}</td><td>${riskBadge(deal.risk_score)}</td><td><div class="intelligence-reasons">${reasons}</div></td><td>${deal.organization_id ? `<button class="small-button" data-open-organization="${intelEscape(deal.organization_id)}">Account</button>` : '<span class="badge red">Unlinked</span>'}</td></tr>`;
}

function duplicateCard(group, type) {
  const records = Number(group.record_count || 0);
  const label = type === 'contact' ? group.match_value : `${intelTitle(group.match_type)}: ${group.match_value}`;
  return `<article class="intelligence-duplicate-card"><div><strong>${intelEscape(label)}</strong><small>${intelEscape(group.labels || '')}</small></div><span class="badge amber">${records} records</span></article>`;
}

function intelligenceCsv(rows) {
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return ['deal,account,owner,stage,value,probability,expected_close,risk_score,risk_reasons', ...rows.map((row) => [row.name,row.organization_name,row.owner_name,row.stage,row.value,row.probability,row.expected_close_date,row.risk_score,(row.risk_reasons||[]).join('; ')].map(quote).join(','))].join('\n');
}

function downloadRiskCsv(rows) {
  const blob = new Blob([intelligenceCsv(rows)], { type:'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `pmg-commercial-risks-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function renderForecastChart(rows) {
  const max = Math.max(1, ...rows.map((row) => Number(row.pipeline || 0)));
  return rows.map((row) => {
    const height = Math.max(5, Number(row.pipeline || 0) / max * 100);
    const weightedHeight = Number(row.pipeline || 0) ? Number(row.weighted || 0) / Number(row.pipeline || 1) * 100 : 0;
    const month = new Date(`${row.month}T12:00:00`).toLocaleDateString('en-GB', { month:'short', year:'2-digit' });
    return `<div class="intelligence-forecast-column"><div class="intelligence-forecast-bars" style="height:${height}%" title="${intelEscape(month)}: ${intelEscape(intelCurrency(row.pipeline))} pipeline"><span style="height:${weightedHeight}%"></span></div><small>${intelEscape(month)}</small><strong>${Number(row.deal_count || 0)}</strong></div>`;
  }).join('');
}

async function loadCommercialIntelligence() {
  const account = intelAccountId();
  const query = new URLSearchParams({ days: intelligenceState.days });
  if (account) query.set('account', account);
  const [data, me] = await Promise.all([
    intelligenceApi(`/api/intelligence?${query}`),
    intelligenceApi('/api/me'),
  ]);
  intelligenceState.data = data;
  intelligenceState.workspace = me.workspace;
}

async function renderCommercialIntelligence(root = document.querySelector('#content')) {
  root.innerHTML = '<div class="loading-state"><span class="spinner"></span><span>Building commercial intelligence…</span></div>';
  try { await loadCommercialIntelligence(); }
  catch (error) {
    root.innerHTML = `<div class="empty-state"><strong>Unable to load commercial intelligence</strong><span>${intelEscape(error.message)}</span><div style="margin-top:12px"><button class="button secondary" data-intelligence-refresh>Try again</button></div></div>`;
    root.querySelector('[data-intelligence-refresh]')?.addEventListener('click', () => renderCommercialIntelligence(root));
    return;
  }

  const data = intelligenceState.data;
  const forecast = data.forecast || {};
  const quality = data.data_quality || {};
  const contacts = quality.contacts || {};
  const organizations = quality.organizations || {};
  const deals = quality.deals || {};
  const accountName = document.querySelector('#accountSwitcher')?.selectedOptions?.[0]?.textContent;
  const focused = data.account_id && accountName && accountName !== 'All accounts';
  const duplicateContacts = data.duplicates?.contacts || [];
  const duplicateOrganizations = data.duplicates?.organizations || [];
  const riskDeals = data.risk_deals || [];
  const riskAccounts = data.risk_accounts || [];

  const navigationRiskBadge = document.querySelector('#intelligenceRiskCount');
  if (navigationRiskBadge) navigationRiskBadge.textContent = Number(data.summary?.urgent_deals || 0) || '';

  root.innerHTML = `
    <header class="page-header"><div><p class="eyebrow">Forecast, risk and CRM hygiene</p><h1>Commercial Intelligence</h1><p>Prioritize revenue, repair weak data and surface relationships that need action.${focused ? ` Focused on ${intelEscape(accountName)}.` : ''}</p></div><div class="page-actions"><button class="button secondary" data-intelligence-export ${riskDeals.length ? '' : 'disabled'}>Export risk list</button><button class="button secondary" data-intelligence-refresh>Refresh</button><button class="button primary" data-route-link="pipeline">Open pipeline</button></div></header>
    <section class="metrics-grid">
      ${intelMetric('Open pipeline', intelCurrency(forecast.open_pipeline), `${forecast.open_deals || 0} active deals`, 'green')}
      ${intelMetric('Weighted forecast', intelCurrency(forecast.weighted_pipeline), 'Probability-adjusted value', 'primary')}
      ${intelMetric('Due in 30 days', intelCurrency(forecast.due_30d_value), `${forecast.due_30d_count || 0} expected closes`, 'blue')}
      ${intelMetric('Overdue pipeline', intelCurrency(forecast.overdue_value), `${forecast.overdue_count || 0} deals overdue`, forecast.overdue_count ? 'red' : 'green')}
      ${intelMetric('Data quality', `${quality.score || 0}%`, `${quality.issues || 0} fields need attention`, quality.score >= 85 ? 'green' : quality.score >= 65 ? 'amber' : 'red')}
    </section>

    <section class="layout-grid">
      <article class="panel"><header class="panel-header"><div><h2>Six-month forecast</h2><p>Pipeline and probability-weighted value by expected close month</p></div><select id="intelligenceWindow" aria-label="Opportunity inactivity risk window"><option value="30" ${data.window_days===30?'selected':''}>30-day risk window</option><option value="60" ${data.window_days===60?'selected':''}>60-day risk window</option><option value="90" ${data.window_days===90?'selected':''}>90-day risk window</option><option value="180" ${data.window_days===180?'selected':''}>180-day risk window</option></select></header><div class="panel-body"><div class="intelligence-forecast-chart">${renderForecastChart(data.forecast_by_month || [])}</div><div class="intelligence-legend"><span><i></i>Total pipeline</span><span><i class="weighted"></i>Weighted share</span></div></div></article>
      <article class="panel"><header class="panel-header"><div><h2>Pipeline hygiene</h2><p>Signals that weaken forecast confidence</p></div></header><div class="panel-body intelligence-signal-grid">
        <article class="intelligence-signal ${forecast.overdue_count ? 'danger' : ''}"><strong>${forecast.overdue_count || 0}</strong><span>Overdue close dates</span><small>${intelCurrency(forecast.overdue_value)} affected</small></article>
        <article class="intelligence-signal ${forecast.stale_count ? 'warning' : ''}"><strong>${forecast.stale_count || 0}</strong><span>Stale opportunities</span><small>No update in ${data.stale_after_days || 30}+ days</small></article>
        <article class="intelligence-signal ${forecast.missing_next_step_count ? 'warning' : ''}"><strong>${forecast.missing_next_step_count || 0}</strong><span>Missing next steps</span><small>No explicit commercial action</small></article>
        <article class="intelligence-signal ${forecast.unscheduled_count ? 'warning' : ''}"><strong>${forecast.unscheduled_count || 0}</strong><span>Unscheduled deals</span><small>No expected close date</small></article>
      </div></article>
    </section>

    <section class="panel" style="margin-bottom:16px"><header class="panel-header"><div><h2>Opportunities requiring action</h2><p>Prioritized by overdue dates, inactivity and missing commercial context</p></div><span class="badge ${data.summary?.urgent_deals ? 'red' : 'green'}">${data.summary?.urgent_deals || 0} urgent</span></header><div class="table-wrap"><table><thead><tr><th>Opportunity</th><th>Stage</th><th>Value</th><th>Expected close</th><th>Risk</th><th>Reasons</th><th></th></tr></thead><tbody>${riskDeals.length ? riskDeals.map(riskDealRow).join('') : '<tr><td colspan="7"><div class="empty-state"><strong>Pipeline hygiene is clear</strong><span>No active opportunity currently matches a risk rule.</span></div></td></tr>'}</tbody></table></div></section>

    <section class="layout-grid equal">
      <article class="panel"><header class="panel-header"><div><h2>Data quality scorecard</h2><p>${quality.records_reviewed || data.summary?.records_reviewed || 0} active records reviewed</p></div><strong class="intelligence-score ${quality.score >= 85 ? 'good' : quality.score >= 65 ? 'fair' : 'poor'}">${quality.score || 0}%</strong></header><div class="panel-body intelligence-quality-list">
        ${qualityBar('Contact email', contacts.missing_email, contacts.total, 'Deliverable business address')}
        ${qualityBar('Contact telephone', contacts.missing_phone, contacts.total, 'Phone or mobile number')}
        ${qualityBar('Contact account link', contacts.missing_account, contacts.total, 'Every person assigned to an account')}
        ${qualityBar('Contact job title', contacts.missing_job_title, contacts.total, 'Buying-role context')}
        ${qualityBar('Consent classification', contacts.unknown_consent, contacts.total, 'Known communication basis')}
        ${qualityBar('Account domain', organizations.missing_domain, organizations.total, 'Unique company domain')}
        ${qualityBar('Account industry', organizations.missing_industry, organizations.total, 'Segment and market context')}
        ${qualityBar('Deal next step', deals.missing_next_step, deals.total, 'Explicit commercial action')}
        ${qualityBar('Deal close date', deals.missing_close_date, deals.total, 'Forecast scheduling')}
      </div></article>
      <article class="panel"><header class="panel-header"><div><h2>Possible duplicates</h2><p>Read-only signals for deliberate review</p></div><span class="badge amber">${quality.duplicate_groups || 0} groups</span></header><div class="panel-body"><h3>Contacts by email</h3><div class="intelligence-duplicate-list">${duplicateContacts.length ? duplicateContacts.map((group) => duplicateCard(group, 'contact')).join('') : '<div class="empty-state"><strong>No duplicate contact emails</strong><span>Email identifiers are unique.</span></div>'}</div><h3 style="margin-top:18px">Accounts by name or domain</h3><div class="intelligence-duplicate-list">${duplicateOrganizations.length ? duplicateOrganizations.map((group) => duplicateCard(group, 'organization')).join('') : '<div class="empty-state"><strong>No duplicate account signals</strong><span>Names and domains appear unique.</span></div>'}</div><div class="callout" style="margin-top:16px"><strong>Safe review only</strong>No records are merged or deleted automatically. Confirm ownership, history and linked deals before consolidating records.</div></div></article>
    </section>

    <section class="panel"><header class="panel-header"><div><h2>Accounts needing attention</h2><p>Relationship health, inactivity and overdue operational work</p></div><span class="badge ${riskAccounts.length ? 'amber' : 'green'}">${riskAccounts.length} accounts</span></header><div class="table-wrap"><table><thead><tr><th>Account</th><th>Owner</th><th>Relationship</th><th>Last contact</th><th>Open pipeline</th><th>Overdue work</th><th>Risk</th><th></th></tr></thead><tbody>${riskAccounts.length ? riskAccounts.map((account) => `<tr><td><button class="row-action table-primary" data-open-organization="${intelEscape(account.id)}"><span class="mini-avatar">${intelEscape(String(account.name || '').slice(0,2).toUpperCase())}</span><span><strong>${intelEscape(account.name)}</strong><small>${intelEscape(account.industry || account.country || 'No segment')}</small></span></button></td><td>${intelEscape(account.owner_name || 'Unassigned')}</td><td><span class="badge ${Number(account.relationship_score||0)<35?'red':'amber'}">${Number(account.relationship_score||0)}</span></td><td>${intelDate(account.last_contact_at, true)}</td><td>${intelCurrency(account.open_pipeline)}</td><td><span class="badge">${Number(account.overdue_tasks||0)} tasks</span> <span class="badge">${Number(account.overdue_follow_ups||0)} follow-ups</span></td><td>${riskBadge(account.risk_score)}</td><td><button class="small-button" data-quick="followup" data-organization-id="${intelEscape(account.id)}">Follow-up</button></td></tr>`).join('') : '<tr><td colspan="8"><div class="empty-state"><strong>No account risk signals</strong><span>Relationship health and open work are within the defined thresholds.</span></div></td></tr>'}</tbody></table></div></section>`;

  root.querySelector('[data-intelligence-refresh]')?.addEventListener('click', () => renderCommercialIntelligence(root));
  root.querySelector('[data-intelligence-export]')?.addEventListener('click', () => downloadRiskCsv(riskDeals));
  root.querySelector('#intelligenceWindow')?.addEventListener('change', (event) => { intelligenceState.days = event.target.value; renderCommercialIntelligence(root); });
}

export { renderCommercialIntelligence };
