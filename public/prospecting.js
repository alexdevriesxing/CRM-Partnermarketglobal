import { openEmailComposer } from '/email.js';

const prospectingState = {
  campaign: '',
  status: '',
  q: '',
  page: 1,
  pageSize: 50,
  overview: null,
  campaigns: [],
  results: null,
  error: '',
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]);
const titleCase = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type':'application/json' } : {}), ...(options.headers || {}) };
  const workspaceId = localStorage.getItem('pmg-workspace');
  if (workspaceId) headers['x-workspace-id'] = workspaceId;
  const response = await fetch(path, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  return payload;
}

function safeWebUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function metric(label, value, caption) {
  return `<article class="metric-card"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${Number(value || 0).toLocaleString()}</strong><span class="metric-caption">${escapeHtml(caption)}</span></article>`;
}

function campaignCard(campaign) {
  const active = campaign.id === prospectingState.campaign;
  return `<button class="prospecting-campaign ${active ? 'active' : ''}" type="button" data-campaign-id="${escapeHtml(campaign.id)}">
    <span><strong>${escapeHtml(campaign.name)}</strong><small>${escapeHtml(campaign.target_markets || 'International prospects')}</small></span>
    <span><b>${Number(campaign.prospect_count || 0)}</b><small>prospects</small></span>
    <div class="prospecting-progress"><i style="width:${Number(campaign.prospect_count || 0) ? Math.min(100, (Number(campaign.contacted_count || 0) + Number(campaign.replied_count || 0) + Number(campaign.qualified_count || 0)) / Number(campaign.prospect_count) * 100) : 0}%"></i></div>
  </button>`;
}

function prospectRow(item) {
  const website = safeWebUrl(item.website);
  const sourceUrl = safeWebUrl(item.source_url);
  const disabled = !item.email || item.email_opt_out || item.contact_status === 'do_not_contact';
  return `<tr>
    <td><strong>${escapeHtml(item.organization_name)}</strong><small class="table-subline">${escapeHtml([item.country, item.prospect_type].filter(Boolean).join(' · '))}</small></td>
    <td><a href="mailto:${escapeHtml(item.email || '')}">${escapeHtml(item.email || 'No email')}</a>${item.organization_phone || item.phone ? `<small class="table-subline">${escapeHtml(item.organization_phone || item.phone)}</small>` : ''}</td>
    <td><span class="badge">${escapeHtml(item.email_status || titleCase(item.consent_status || 'unknown'))}</span></td>
    <td class="prospecting-angle">${escapeHtml(item.fit_angle || item.suggested_angle || '—')}</td>
    <td><select class="prospecting-status" data-prospect-status="${escapeHtml(item.id)}" aria-label="Outreach status for ${escapeHtml(item.organization_name)}">${['not_contacted','researching','ready','contacted','replied','qualified','disqualified','do_not_contact'].map((status) => `<option value="${status}" ${status === item.outreach_status ? 'selected' : ''}>${titleCase(status)}</option>`).join('')}</select></td>
    <td><div class="prospecting-actions">${website ? `<a class="small-button" href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">Website</a>` : ''}${sourceUrl ? `<a class="small-button" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Source</a>` : ''}<button class="small-button" type="button" data-prospect-email="${escapeHtml(item.id)}" ${disabled ? 'disabled title="Email is unavailable or opted out"' : ''}>Compose</button></div></td>
  </tr>`;
}

async function loadProspecting() {
  const params = new URLSearchParams({ page: prospectingState.page, pageSize: prospectingState.pageSize });
  if (prospectingState.campaign) params.set('campaign', prospectingState.campaign);
  if (prospectingState.status) params.set('status', prospectingState.status);
  if (prospectingState.q) params.set('q', prospectingState.q);
  const [overview, campaigns, results] = await Promise.all([
    api('/api/prospecting/overview'),
    api('/api/prospecting/campaigns'),
    api(`/api/prospecting/members?${params}`),
  ]);
  prospectingState.overview = overview;
  prospectingState.campaigns = campaigns;
  prospectingState.results = results;
}

export async function renderProspecting(root) {
  await loadProspecting();
  const totals = prospectingState.overview?.totals || {};
  const results = prospectingState.results || { items: [], page: 1, pages: 1, total: 0 };
  root.innerHTML = `<header class="page-header"><div><p class="eyebrow">Spreadsheet-backed outreach workspace</p><h1>Prospecting</h1><p>Review, research and contact imported international prospects without losing campaign context or consent status.</p></div><div class="page-actions"><span class="badge primary">${Number(results.total || 0).toLocaleString()} matching prospects</span></div></header>
    <section class="metrics-grid prospecting-metrics">${metric('Campaigns', totals.campaigns, 'Imported opportunity lists')}${metric('Prospects', totals.prospects, 'Campaign memberships')}${metric('Ready', totals.ready, 'Prepared for outreach')}${metric('Contacted', totals.contacted, 'Outreach started')}${metric('Replies', Number(totals.replied || 0) + Number(totals.qualified || 0), 'Response momentum')}</section>
    <section class="prospecting-layout">
      <aside class="panel prospecting-campaign-panel"><header class="panel-header"><div><h2>Opportunity lists</h2><p>Choose a spreadsheet tab</p></div></header><div class="prospecting-campaigns"><button class="prospecting-campaign ${prospectingState.campaign ? '' : 'active'}" type="button" data-campaign-id=""><span><strong>All opportunities</strong><small>Combined prospect database</small></span><span><b>${Number(totals.prospects || 0)}</b><small>prospects</small></span></button>${prospectingState.campaigns.map(campaignCard).join('')}</div></aside>
      <section class="panel prospecting-results"><div class="toolbar prospecting-toolbar"><input class="search-input" id="prospectingSearch" type="search" value="${escapeHtml(prospectingState.q)}" placeholder="Search company, country, email or fit…"><select id="prospectingStatus"><option value="">All outreach statuses</option>${['not_contacted','researching','ready','contacted','replied','qualified','disqualified','do_not_contact'].map((status) => `<option value="${status}" ${prospectingState.status === status ? 'selected' : ''}>${titleCase(status)}</option>`).join('')}</select><button class="button secondary" type="button" id="prospectingRefresh">Refresh</button></div>${prospectingState.error ? `<div class="prospecting-notice" role="alert">${escapeHtml(prospectingState.error)}</div>` : ''}
        <div class="table-wrap"><table><thead><tr><th>Account</th><th>Contact</th><th>Email status</th><th>Why this fits</th><th>Outreach</th><th>Actions</th></tr></thead><tbody>${results.items.length ? results.items.map(prospectRow).join('') : '<tr><td colspan="6"><div class="empty-state"><strong>No matching prospects</strong><span>Change the campaign, search or status filter.</span></div></td></tr>'}</tbody></table></div>
        <footer class="pagination"><span>Page ${Number(results.page)} of ${Number(results.pages)} · ${Number(results.total).toLocaleString()} records</span><div><button class="small-button" type="button" data-prospect-page="${Math.max(1, Number(results.page) - 1)}" ${Number(results.page) <= 1 ? 'disabled' : ''}>Previous</button><button class="small-button" type="button" data-prospect-page="${Math.min(Number(results.pages), Number(results.page) + 1)}" ${Number(results.page) >= Number(results.pages) ? 'disabled' : ''}>Next</button></div></footer>
      </section>
    </section>`;

  root.querySelectorAll('[data-campaign-id]').forEach((button) => button.addEventListener('click', async () => { prospectingState.campaign = button.dataset.campaignId; prospectingState.page = 1; await renderProspecting(root); }));
  root.querySelector('#prospectingStatus')?.addEventListener('change', async (event) => { prospectingState.status = event.target.value; prospectingState.page = 1; await renderProspecting(root); });
  let searchTimer;
  root.querySelector('#prospectingSearch')?.addEventListener('input', (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(async () => { prospectingState.q = event.target.value.trim(); prospectingState.page = 1; await renderProspecting(root); }, 300); });
  root.querySelector('#prospectingRefresh')?.addEventListener('click', () => renderProspecting(root));
  root.querySelectorAll('[data-prospect-page]').forEach((button) => button.addEventListener('click', async () => { prospectingState.page = Number(button.dataset.prospectPage); await renderProspecting(root); }));
  root.querySelectorAll('[data-prospect-status]').forEach((select) => select.addEventListener('change', async () => {
    select.disabled = true;
    try { await api(`/api/prospecting/members/${encodeURIComponent(select.dataset.prospectStatus)}`, { method:'PATCH', body:{ outreach_status:select.value } }); prospectingState.error = ''; }
    catch (error) { prospectingState.error = `Unable to update outreach status: ${error.message}`; }
    finally { await renderProspecting(root); }
  }));
  root.querySelectorAll('[data-prospect-email]').forEach((button) => button.addEventListener('click', async () => {
    const item = results.items.find((candidate) => candidate.id === button.dataset.prospectEmail);
    if (!item) return;
    await openEmailComposer({ organization_id:item.organization_id, contact_id:item.contact_id, to:item.email, subject:`Introduction regarding ${item.campaign_name}` });
  }));
}
