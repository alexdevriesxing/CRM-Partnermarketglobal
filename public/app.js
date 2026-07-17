const state = {
  route: 'dashboard',
  me: null,
  dashboard: null,
  contacts: { items: [], page: 1, pageSize: 25, total: 0, pages: 1, q: '', stage: '', sort: 'last_contact' },
  organizations: [],
  deals: [],
  tasks: [],
  analytics: null,
  selectedContacts: new Set(),
  activeContact: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const icons = {
  contacts: '◎', organizations: '▦', overdue: '!', followups: '↻', activity: '↗',
  email: '✉', call: '☎', meeting: '◫', whatsapp: '◉', linkedin: 'in', note: '✎', file: '↥', other: '•',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function initials(first = '', last = '') {
  return `${String(first).trim()[0] || ''}${String(last).trim()[0] || ''}`.toUpperCase() || 'PM';
}

function titleCase(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCurrency(value, currency = 'EUR', compact = true) {
  try {
    return new Intl.NumberFormat('en-NL', { style: 'currency', currency, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(Number(value || 0));
  } catch {
    return `€${Number(value || 0).toLocaleString()}`;
  }
}

function formatDate(value, options = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...options }).format(date);
}

function relativeTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return formatter.format(seconds, 'second');
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
  if (abs < 2_592_000) return formatter.format(Math.round(seconds / 86400), 'day');
  return formatter.format(Math.round(seconds / 2_592_000), 'month');
}

function healthColor(score) {
  if (score >= 80) return 'var(--green)';
  if (score >= 55) return 'var(--primary)';
  if (score >= 35) return 'var(--amber)';
  return 'var(--red)';
}

function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

async function api(path, options = {}) {
  const config = { ...options, headers: { ...(options.body && !(options.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } };
  if (config.body && !(config.body instanceof FormData) && typeof config.body !== 'string') config.body = JSON.stringify(config.body);
  const response = await fetch(path, config);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || payload || `Request failed (${response.status})`);
  return payload;
}

function toast(title, message = '', type = 'success') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ''}`;
  $('#toastStack').append(node);
  setTimeout(() => node.remove(), 4200);
}

function setLoading(element, text = 'Loading…') {
  if (element) element.innerHTML = `<div class="empty-state"><div class="skeleton" style="width:180px;margin:0 auto 12px"></div><span>${escapeHtml(text)}</span></div>`;
}

function navigate(route) {
  const known = ['dashboard', 'contacts', 'organizations', 'pipeline', 'tasks', 'analytics', 'data', 'settings'];
  state.route = known.includes(route) ? route : 'dashboard';
  if (location.hash !== `#${state.route}`) history.replaceState(null, '', `#${state.route}`);
  $$('.page').forEach((page) => page.classList.toggle('active', page.dataset.page === state.route));
  $$('.nav-item[data-route]').forEach((item) => item.classList.toggle('active', item.dataset.route === state.route));
  $('#content').focus({ preventScroll: true });
  $('#sidebar').classList.remove('open');
  loadRoute(state.route);
}

async function loadRoute(route) {
  try {
    if (route === 'dashboard' && !state.dashboard) await loadDashboard();
    if (route === 'contacts') await loadContacts();
    if (route === 'organizations') await loadOrganizations();
    if (route === 'pipeline') await loadDeals();
    if (route === 'tasks') await loadTasks();
    if (route === 'analytics') await loadAnalytics();
  } catch (error) {
    toast('Unable to load data', error.message, 'error');
  }
}

async function boot() {
  document.documentElement.dataset.theme = localStorage.getItem('pmg-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  bindEvents();
  try {
    state.me = await api('/api/me');
    renderUser();
    await loadDashboard();
    navigate(location.hash.slice(1) || 'dashboard');
  } catch (error) {
    renderConnectionError(error);
  }
}

function renderUser() {
  const user = state.me?.user || {};
  $('#userName').textContent = user.name || user.email || 'CRM user';
  $('#userRole').textContent = user.role || 'member';
  const names = String(user.name || '').split(' ');
  $('#userAvatar').textContent = initials(names[0], names.at(-1));
  $('#greetingName').textContent = names[0] || 'there';
}

function renderConnectionError(error) {
  $('.content').innerHTML = `<section class="panel" style="max-width:760px;margin:50px auto"><p class="eyebrow">Connection required</p><h1>CRM API could not be reached</h1><p>${escapeHtml(error.message)}</p><hr><p>For local UI testing, run <code>npm run dev:mock</code>. For Cloudflare development, install dependencies, configure the bindings and run <code>npm run dev</code>.</p></section>`;
}

async function loadDashboard(force = false) {
  if (force) state.dashboard = null;
  state.dashboard = await api('/api/dashboard');
  renderDashboard();
}

function renderDashboard() {
  const data = state.dashboard;
  if (!data) return;
  const metrics = [
    { label: 'Active contacts', value: data.counts.contacts, caption: 'relationship records', icon: icons.contacts, color: 'var(--primary)', soft: 'var(--primary-soft)' },
    { label: 'Organizations', value: data.counts.organizations, caption: 'active accounts', icon: icons.organizations, color: 'var(--blue)', soft: 'var(--blue-soft)' },
    { label: 'Pipeline', value: formatCurrency(data.pipeline.total_value), caption: `${data.pipeline.win_rate}% win rate`, icon: '€', color: 'var(--purple)', soft: 'var(--purple-soft)' },
    { label: 'Follow-ups', value: data.counts.follow_ups, caption: 'due within 7 days', icon: icons.followups, color: 'var(--amber)', soft: 'var(--amber-soft)' },
    { label: 'Overdue tasks', value: data.counts.overdue_tasks, caption: data.counts.overdue_tasks ? 'requires attention' : 'all on track', icon: icons.overdue, color: 'var(--red)', soft: 'var(--red-soft)' },
  ];
  $('#dashboardMetrics').innerHTML = metrics.map((metric) => `<article class="metric-card" style="--metric-color:${metric.color};--metric-soft:${metric.soft}"><div class="metric-icon">${metric.icon}</div><span class="metric-label">${escapeHtml(metric.label)}</span><div class="metric-row"><strong class="metric-value">${escapeHtml(metric.value)}</strong></div><span class="metric-caption">${escapeHtml(metric.caption)}</span></article>`).join('');
  $('#contactNavCount').textContent = data.counts.contacts;
  $('#taskNavCount').textContent = data.counts.overdue_tasks;
  renderActivityChart(data.activity_by_day || []);
  renderHealth(data.health || {});
  renderPipelineSummary(data.stages || []);
  renderPriorityTasks(data.tasks || []);
  renderTimeline(data.recent_activities || [], $('#recentTimeline'));
}

function renderActivityChart(rows) {
  const max = Math.max(1, ...rows.map((row) => Number(row.count || 0)));
  $('#activityChart').innerHTML = rows.map((row) => {
    const date = new Date(`${row.day}T12:00:00`);
    const day = date.toLocaleDateString('en-GB', { weekday: 'narrow' });
    const height = Math.max(4, Math.round(Number(row.count || 0) / max * 100));
    return `<div class="chart-column"><div class="chart-bar-wrap"><div class="chart-bar" style="height:${height}%" data-value="${row.count}"></div></div><small>${day}<br>${date.getDate()}</small></div>`;
  }).join('');
}

function renderHealth(health) {
  const values = [Number(health.strong || 0), Number(health.healthy || 0), Number(health.needs_attention || 0), Number(health.at_risk || 0)];
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const colors = ['var(--green)', 'var(--primary)', 'var(--amber)', 'var(--red)'];
  let cursor = 0;
  const stops = values.map((value, index) => {
    const start = cursor;
    cursor += value / total * 100;
    return `${colors[index]} ${start}% ${cursor}%`;
  });
  $('#healthDonut').style.background = `conic-gradient(${stops.join(',')})`;
  const estimatedAverage = Math.round((values[0] * 90 + values[1] * 67 + values[2] * 45 + values[3] * 22) / total);
  $('#healthAverage').textContent = estimatedAverage;
  const labels = ['Strong', 'Healthy', 'Needs attention', 'At risk'];
  $('#healthLegend').innerHTML = labels.map((label, index) => `<div class="legend-row"><span class="legend-dot" style="--legend-color:${colors[index]}"></span><span>${label}</span><strong>${values[index]}</strong></div>`).join('');
}

function renderPipelineSummary(stages) {
  const ordered = ['lead', 'qualified', 'proposal', 'negotiation', 'won'];
  const max = Math.max(1, ...stages.map((stage) => Number(stage.value || 0)));
  const map = Object.fromEntries(stages.map((stage) => [stage.stage, stage]));
  $('#pipelineSummary').innerHTML = ordered.map((stage) => {
    const row = map[stage] || { count: 0, value: 0 };
    return `<div class="pipeline-row"><label>${titleCase(stage)}</label><div class="progress-track"><div class="progress-fill" style="width:${Math.max(3, Number(row.value || 0) / max * 100)}%"></div></div><strong>${formatCurrency(row.value)} · ${row.count}</strong></div>`;
  }).join('');
}

function dueClass(value) {
  return value && new Date(value) < new Date() ? 'overdue' : '';
}

function renderPriorityTasks(tasks) {
  const root = $('#priorityTasks');
  if (!tasks.length) {
    root.innerHTML = '<div class="empty-state"><strong>No priority tasks</strong><span>Your follow-up queue is clear.</span></div>';
    return;
  }
  root.innerHTML = tasks.map((task) => `<div class="task-item"><button class="task-check" data-complete-task="${task.id}" type="button" aria-label="Complete task"></button><div class="task-copy"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.contact_name || task.organization_name || 'General task')} · ${titleCase(task.priority)}</span></div><span class="due ${dueClass(task.due_at)}">${relativeTime(task.due_at)}</span></div>`).join('');
}

function renderTimeline(activities, root) {
  if (!activities.length) {
    root.innerHTML = '<div class="empty-state"><strong>No interactions yet</strong><span>Log a call, email, meeting or note to start the history.</span></div>';
    return;
  }
  root.innerHTML = activities.map((activity) => `<div class="timeline-item"><div class="timeline-icon">${icons[activity.type] || icons.other}</div><div class="timeline-copy"><strong>${escapeHtml(activity.subject)}</strong><p>${escapeHtml(activity.contact_name || activity.organization_name || activity.user_name || '')}${activity.outcome ? ` · ${escapeHtml(activity.outcome)}` : ''}</p></div><time class="timeline-time">${relativeTime(activity.occurred_at)}</time></div>`).join('');
}

async function loadContacts(page = state.contacts.page) {
  $('#contactsTableBody').innerHTML = '<tr><td colspan="8"><div class="loading-state"><span class="spinner"></span><span>Loading contacts…</span></div></td></tr>';
  const params = new URLSearchParams({ page, pageSize: state.contacts.pageSize, sort: state.contacts.sort });
  if (state.contacts.q) params.set('q', state.contacts.q);
  if (state.contacts.stage) params.set('stage', state.contacts.stage);
  const result = await api(`/api/contacts?${params}`);
  state.contacts = { ...state.contacts, ...result };
  renderContacts();
}

function renderContacts() {
  const root = $('#contactsTableBody');
  if (!state.contacts.items.length) {
    root.innerHTML = '<tr><td colspan="8"><div class="empty-state"><strong>No contacts found</strong><span>Adjust the filters or add a new relationship.</span></div></td></tr>';
  } else {
    root.innerHTML = state.contacts.items.map((contact, index) => {
      const palette = index % 4;
      const colors = [
        ['var(--primary-soft)', 'var(--primary)'], ['var(--blue-soft)', 'var(--blue)'], ['var(--purple-soft)', 'var(--purple)'], ['var(--amber-soft)', 'var(--amber)'],
      ][palette];
      return `<tr class="row-link" data-contact-id="${contact.id}">
        <td><input type="checkbox" data-select-contact="${contact.id}" ${state.selectedContacts.has(contact.id) ? 'checked' : ''} aria-label="Select ${escapeHtml(contact.first_name)}"></td>
        <td><div class="contact-cell"><span class="contact-avatar" style="--avatar-bg:${colors[0]};--avatar-color:${colors[1]}">${initials(contact.first_name, contact.last_name)}</span><div><strong>${escapeHtml(`${contact.first_name} ${contact.last_name}`.trim())}</strong><span>${escapeHtml(contact.email || contact.job_title || 'No email')}</span></div></div></td>
        <td><strong>${escapeHtml(contact.organization || 'Independent')}</strong><br><span style="color:var(--faint)">${escapeHtml(contact.job_title || '')}</span></td>
        <td><span class="badge ${contact.lifecycle_stage}">${titleCase(contact.lifecycle_stage)}</span></td>
        <td>${relativeTime(contact.last_contact_at)}</td>
        <td><span class="due ${dueClass(contact.next_follow_up_at)}">${contact.next_follow_up_at ? relativeTime(contact.next_follow_up_at) : 'Not set'}</span></td>
        <td><span class="health-pill" style="--health-color:${healthColor(contact.relationship_score)}">${contact.relationship_score}</span></td>
        <td><button class="row-actions" data-open-contact="${contact.id}" type="button" aria-label="Open contact">•••</button></td>
      </tr>`;
    }).join('');
  }
  renderPagination();
  updateSelectionBar();
}

function renderPagination() {
  const { page, pages, total, pageSize } = state.contacts;
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  const buttons = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i += 1) buttons.push(`<button class="${i === page ? 'active' : ''}" data-contact-page="${i}" type="button">${i}</button>`);
  $('#contactsPagination').innerHTML = `<span>Showing ${start}–${end} of ${total} contacts</span><div class="pagination-buttons"><button data-contact-page="${Math.max(1, page - 1)}" ${page === 1 ? 'disabled' : ''}>‹</button>${buttons.join('')}<button data-contact-page="${Math.min(pages, page + 1)}" ${page === pages ? 'disabled' : ''}>›</button></div>`;
}

function updateSelectionBar() {
  const count = state.selectedContacts.size;
  $('#selectionBar').hidden = count === 0;
  $('#selectionCount').textContent = count;
  $('#selectAllContacts').checked = state.contacts.items.length > 0 && state.contacts.items.every((contact) => state.selectedContacts.has(contact.id));
}

async function openContact(id) {
  $('#drawerBackdrop').hidden = false;
  $('#detailDrawer').classList.add('open');
  $('#detailDrawer').setAttribute('aria-hidden', 'false');
  $('#detailDrawer').innerHTML = '<div class="empty-state" style="margin-top:80px">Loading relationship history…</div>';
  try {
    state.activeContact = await api(`/api/contacts/${id}`);
    renderContactDrawer();
  } catch (error) {
    closeDrawer();
    toast('Unable to open contact', error.message, 'error');
  }
}

function renderContactDrawer() {
  const contact = state.activeContact;
  if (!contact) return;
  const openValue = (contact.deals || []).filter((deal) => !['won', 'lost'].includes(deal.stage)).reduce((sum, deal) => sum + Number(deal.value || 0), 0);
  $('#detailDrawer').innerHTML = `
    <header class="drawer-header"><strong>Contact profile</strong><button class="close-button" data-close-drawer type="button" aria-label="Close">×</button></header>
    <div class="drawer-body">
      <div class="profile-header"><div class="profile-avatar">${initials(contact.first_name, contact.last_name)}</div><div><h2>${escapeHtml(`${contact.first_name} ${contact.last_name}`.trim())}</h2><p>${escapeHtml(contact.job_title || 'Contact')} ${contact.organization ? `at ${escapeHtml(contact.organization)}` : ''}</p><span class="health-pill" style="--health-color:${healthColor(contact.relationship_score)}">Relationship score ${contact.relationship_score}</span></div><span class="badge ${contact.lifecycle_stage}">${titleCase(contact.lifecycle_stage)}</span></div>
      <div class="profile-actions">
        <button class="profile-action" data-contact-action="email" type="button"><strong>✉</strong>Email</button>
        <button class="profile-action" data-contact-action="call" type="button"><strong>☎</strong>Call</button>
        <button class="profile-action" data-contact-action="meeting" type="button"><strong>◫</strong>Meeting</button>
        <button class="profile-action" data-contact-action="note" type="button"><strong>✎</strong>Note</button>
      </div>
      <div class="detail-stats"><div class="detail-stat"><strong>${contact.activities?.length || 0}</strong><span>Interactions</span></div><div class="detail-stat"><strong>${formatCurrency(openValue)}</strong><span>Open pipeline</span></div><div class="detail-stat"><strong>${contact.tasks?.filter((task) => !['completed','cancelled'].includes(task.status)).length || 0}</strong><span>Open tasks</span></div></div>
      <section class="detail-section"><h3>Contact details</h3><div class="info-grid">
        <div class="info-item"><label>Email</label><span>${escapeHtml(contact.email || '—')}</span></div><div class="info-item"><label>Phone</label><span>${escapeHtml(contact.phone || contact.mobile || '—')}</span></div>
        <div class="info-item"><label>Preferred channel</label><span>${titleCase(contact.preferred_channel)}</span></div><div class="info-item"><label>Timezone</label><span>${escapeHtml(contact.timezone || '—')}</span></div>
        <div class="info-item"><label>Last contact</label><span>${relativeTime(contact.last_contact_at)}</span></div><div class="info-item"><label>Next follow-up</label><span>${contact.next_follow_up_at ? relativeTime(contact.next_follow_up_at) : 'Not scheduled'}</span></div>
      </div></section>
      ${contact.notes ? `<section class="detail-section"><h3>Relationship notes</h3><p style="color:var(--muted);font-size:12px">${escapeHtml(contact.notes)}</p></section>` : ''}
      <section class="detail-section"><div class="panel-heading"><h3>Interaction history</h3><button class="text-button" data-contact-action="note" type="button">Add +</button></div><div class="timeline drawer-timeline" id="drawerTimeline"></div></section>
      <section class="detail-section"><h3>Tags</h3><div class="tag-list">${(contact.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('') || '<span class="tag">No tags</span>'}</div></section>
    </div>`;
  renderTimeline(contact.activities || [], $('#drawerTimeline'));
}

function closeDrawer() {
  $('#detailDrawer').classList.remove('open');
  $('#detailDrawer').setAttribute('aria-hidden', 'true');
  $('#drawerBackdrop').hidden = true;
  state.activeContact = null;
}

async function loadOrganizations() {
  const params = new URLSearchParams();
  const q = $('#organizationSearch')?.value.trim();
  const type = $('#organizationTypeFilter')?.value;
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  state.organizations = await api(`/api/organizations?${params}`);
  renderOrganizations();
}

function renderOrganizations() {
  const root = $('#organizationGrid');
  if (!state.organizations.length) {
    root.innerHTML = '<div class="empty-state panel"><strong>No organizations found</strong><span>Add an organization or change the filters.</span></div>';
    return;
  }
  root.innerHTML = state.organizations.map((org) => `<article class="organization-card"><div class="organization-top"><div class="organization-logo">${initials(...org.name.split(' ').slice(0, 2))}</div><div><h3>${escapeHtml(org.name)}</h3><p>${escapeHtml(org.industry || org.domain || org.country || 'Organization')}</p></div><span class="badge ${org.type}">${titleCase(org.type)}</span></div><div class="organization-meta"><div><strong>${org.contact_count || 0}</strong><span>Contacts</span></div><div><strong>${formatCurrency(org.pipeline_value)}</strong><span>Pipeline</span></div><div><strong style="color:${healthColor(org.relationship_score)}">${org.relationship_score}</strong><span>Health</span></div></div><div class="tag-list">${(org.tags || []).slice(0, 4).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div><div class="organization-footer"><span>${escapeHtml([org.city, org.country].filter(Boolean).join(', ') || 'Location not set')}</span><span>${org.last_contact_at ? relativeTime(org.last_contact_at) : 'No contact yet'}</span></div></article>`).join('');
}

async function loadDeals() {
  state.deals = await api('/api/deals');
  renderDeals();
}

function renderDeals() {
  const active = state.deals.filter((deal) => deal.stage !== 'lost');
  const total = active.reduce((sum, deal) => sum + Number(deal.value || 0), 0);
  const weighted = state.deals.filter((deal) => !['won','lost'].includes(deal.stage)).reduce((sum, deal) => sum + Number(deal.value || 0) * Number(deal.probability || 0) / 100, 0);
  const won = state.deals.filter((deal) => deal.stage === 'won').reduce((sum, deal) => sum + Number(deal.value || 0), 0);
  const closed = state.deals.filter((deal) => ['won','lost'].includes(deal.stage));
  const winRate = closed.length ? Math.round(state.deals.filter((deal) => deal.stage === 'won').length / closed.length * 100) : 0;
  $('#pipelineMetrics').innerHTML = [
    ['Total pipeline', formatCurrency(total), 'Open and won value', '€', 'var(--primary)', 'var(--primary-soft)'],
    ['Weighted forecast', formatCurrency(weighted), 'Probability adjusted', '◫', 'var(--blue)', 'var(--blue-soft)'],
    ['Won value', formatCurrency(won), 'Closed successfully', '✓', 'var(--green)', 'var(--green-soft)'],
    ['Win rate', `${winRate}%`, `${closed.length} closed deals`, '↗', 'var(--purple)', 'var(--purple-soft)'],
  ].map(([label, value, caption, icon, color, soft]) => `<article class="metric-card" style="--metric-color:${color};--metric-soft:${soft}"><div class="metric-icon">${icon}</div><span class="metric-label">${label}</span><div class="metric-row"><strong class="metric-value">${value}</strong></div><span class="metric-caption">${caption}</span></article>`).join('');

  const stages = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
  $('#pipelineBoard').innerHTML = stages.map((stage) => {
    const deals = state.deals.filter((deal) => deal.stage === stage);
    const value = deals.reduce((sum, deal) => sum + Number(deal.value || 0), 0);
    return `<section class="kanban-column" data-stage="${stage}"><div class="kanban-heading"><strong>${titleCase(stage)}</strong><span>${deals.length} · ${formatCurrency(value)}</span></div>${deals.map((deal) => `<article class="deal-card" data-deal-id="${deal.id}"><h3>${escapeHtml(deal.name)}</h3><p>${escapeHtml(deal.organization_name || deal.contact_name || 'Unassigned')}</p><div class="deal-value"><strong>${formatCurrency(deal.value, deal.currency)}</strong><span>${deal.expected_close_date ? formatDate(deal.expected_close_date) : 'No close date'}</span></div><div class="progress-track"><div class="progress-fill" style="width:${deal.probability}%"></div></div><div class="deal-footer"><span class="probability">${deal.probability}% likely</span><span class="avatar" style="width:24px;height:24px;font-size:8px">${initials(...String(deal.owner_name || 'PM').split(' ').slice(0,2))}</span></div></article>`).join('') || '<div class="empty-state"><span>No deals</span></div>'}</section>`;
  }).join('');
}

async function loadTasks(status = '') {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  state.tasks = await api(`/api/tasks${query}`);
  renderTasks();
}

function renderTasks() {
  const root = $('#taskBoard');
  if (!state.tasks.length) {
    root.innerHTML = '<div class="empty-state"><strong>No tasks in this view</strong><span>Add a follow-up or choose another status.</span></div>';
    return;
  }
  const priorityColors = { urgent: 'var(--red)', high: 'var(--amber)', medium: 'var(--primary)', low: 'var(--faint)' };
  root.innerHTML = state.tasks.map((task) => `<div class="task-row ${task.status === 'completed' ? 'completed' : ''}"><button class="task-check" data-complete-task="${task.id}" type="button" aria-label="${task.status === 'completed' ? 'Reopen' : 'Complete'} task">${task.status === 'completed' ? '✓' : ''}</button><div class="task-title"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.contact_name || task.organization_name || task.deal_name || 'General')}</span></div><span>${escapeHtml(task.assignee_name || 'Unassigned')}</span><span class="due ${dueClass(task.due_at)}">${task.due_at ? relativeTime(task.due_at) : 'No due date'}</span><span class="badge ${task.status}">${titleCase(task.status)}</span><span class="priority-dot" style="--priority:${priorityColors[task.priority]}"></span></div>`).join('');
}

async function completeTask(id) {
  const task = [...state.tasks, ...(state.dashboard?.tasks || [])].find((item) => item.id === id);
  const status = task?.status === 'completed' ? 'open' : 'completed';
  await api(`/api/tasks/${id}`, { method: 'PATCH', body: { status } });
  toast(status === 'completed' ? 'Task completed' : 'Task reopened');
  state.dashboard = null;
  if (state.route === 'tasks') await loadTasks($('.task-tabs button.active')?.dataset.taskStatus || '');
  else await loadDashboard();
}

async function loadAnalytics() {
  const days = $('#analyticsRange').value;
  state.analytics = await api(`/api/analytics?days=${days}`);
  if (!state.dashboard) state.dashboard = await api('/api/dashboard');
  renderAnalytics();
}

function renderAnalytics() {
  const data = state.analytics;
  const dashboard = state.dashboard;
  if (!data || !dashboard) return;
  const totalActivities = data.activity_types.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const engaged = Math.max(0, ...data.monthly.map((row) => Number(row.engaged_contacts || 0)));
  $('#analyticsMetrics').innerHTML = [
    ['Recorded activities', totalActivities, `Last ${data.days} days`, '↗', 'var(--primary)', 'var(--primary-soft)'],
    ['Engaged contacts', engaged, 'Peak monthly reach', '◎', 'var(--blue)', 'var(--blue-soft)'],
    ['Weighted forecast', formatCurrency(dashboard.pipeline.weighted_value), 'Open pipeline', '€', 'var(--purple)', 'var(--purple-soft)'],
    ['Win rate', `${dashboard.pipeline.win_rate}%`, 'Won vs lost', '✓', 'var(--green)', 'var(--green-soft)'],
    ['Overdue actions', dashboard.counts.overdue_tasks, 'Execution risk', '!', 'var(--red)', 'var(--red-soft)'],
  ].map(([label, value, caption, icon, color, soft]) => `<article class="metric-card" style="--metric-color:${color};--metric-soft:${soft}"><div class="metric-icon">${icon}</div><span class="metric-label">${label}</span><div class="metric-row"><strong class="metric-value">${value}</strong></div><span class="metric-caption">${caption}</span></article>`).join('');

  const maxActivity = Math.max(1, ...data.activity_types.map((row) => Number(row.count || 0)));
  $('#activityMix').innerHTML = data.activity_types.map((row) => `<div class="bar-row"><label>${titleCase(row.type)}</label><div class="progress-track"><div class="progress-fill" style="width:${Number(row.count || 0) / maxActivity * 100}%"></div></div><strong>${row.count}</strong></div>`).join('') || '<div class="empty-state">No activity in this period.</div>';

  const lifecycle = data.conversion;
  const maxLifecycle = Math.max(1, ...lifecycle.map((row) => Number(row.count || 0)));
  $('#lifecycleFunnel').innerHTML = lifecycle.map((row, index) => `<div class="funnel-row" style="width:${Math.max(46, Number(row.count || 0) / maxLifecycle * 100)}%;--level:${index}"><span>${titleCase(row.lifecycle_stage)}</span><strong>${row.count}</strong></div>`).join('');

  const maxWon = Math.max(1, ...data.owner_performance.map((row) => Number(row.won_value || 0)));
  $('#ownerPerformanceBody').innerHTML = data.owner_performance.map((owner) => `<tr><td><strong>${escapeHtml(owner.name)}</strong></td><td>${owner.activities}</td><td>${owner.contacts}</td><td>${formatCurrency(owner.won_value)}</td><td><div class="momentum"><span style="width:${Number(owner.won_value || 0) / maxWon * 100}%"></span></div></td></tr>`).join('');
}

function openModal({ title, body, submitLabel = 'Save', onSubmit = null, width = null }) {
  const modal = $('#modal');
  if (width) modal.style.width = width;
  else modal.style.removeProperty('width');
  modal.innerHTML = `<header class="modal-header"><h2 id="modalTitle">${escapeHtml(title)}</h2><button class="close-button" data-close-modal type="button" aria-label="Close">×</button></header><div class="modal-body">${body}</div><footer class="modal-footer"><button class="button secondary" data-close-modal type="button">Cancel</button>${onSubmit ? `<button class="button primary" id="modalSubmit" type="button">${escapeHtml(submitLabel)}</button>` : ''}</footer>`;
  modal.hidden = false;
  $('#modalBackdrop').hidden = false;
  modal._onSubmit = onSubmit;
  setTimeout(() => $('input, select, textarea, button', modal)?.focus(), 20);
}

function closeModal() {
  $('#modal').hidden = true;
  $('#modalBackdrop').hidden = true;
  $('#modal').innerHTML = '';
  $('#modal')._onSubmit = null;
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function organizationOptions() {
  if (!state.organizations.length) state.organizations = await api('/api/organizations');
  return `<option value="">No organization</option>${state.organizations.map((org) => `<option value="${org.id}">${escapeHtml(org.name)}</option>`).join('')}`;
}

async function showNewContactModal() {
  const options = await organizationOptions();
  openModal({ title: 'Add contact', submitLabel: 'Create contact', body: `<form id="modalForm" class="form-grid"><label>First name *<input name="first_name" required></label><label>Last name<input name="last_name"></label><label class="full">Organization<select name="organization_id">${options}</select></label><label>Job title<input name="job_title"></label><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label><label>Lifecycle stage<select name="lifecycle_stage"><option value="lead">Lead</option><option value="qualified">Qualified</option><option value="opportunity">Opportunity</option><option value="customer">Customer</option><option value="partner">Partner</option></select></label><label>Source<input name="source" placeholder="Referral, event, LinkedIn…"></label><label>Next follow-up<input name="next_follow_up_at" type="datetime-local"></label><label class="full">Tags<input name="tags" placeholder="priority, investor, indonesia"></label><label class="full">Notes<textarea name="notes"></textarea></label></form>`, onSubmit: async () => {
    const form = $('#modalForm'); if (!form.reportValidity()) return;
    const data = formValues(form); data.tags = data.tags.split(',').map((tag) => tag.trim()).filter(Boolean); if (!data.next_follow_up_at) delete data.next_follow_up_at;
    await api('/api/contacts', { method: 'POST', body: data }); closeModal(); toast('Contact created', `${data.first_name} is now in your CRM.`); state.dashboard = null; await loadContacts(1);
  } });
}

function showNewOrganizationModal() {
  openModal({ title: 'Add organization', submitLabel: 'Create organization', body: `<form id="modalForm" class="form-grid"><label class="full">Organization name *<input name="name" required></label><label>Type<select name="type"><option value="prospect">Prospect</option><option value="client">Client</option><option value="partner">Partner</option><option value="investor">Investor</option><option value="supplier">Supplier</option></select></label><label>Industry<input name="industry"></label><label>Domain<input name="domain" placeholder="example.com"></label><label>Website<input name="website" type="url"></label><label>Country<input name="country"></label><label>City<input name="city"></label><label>Annual value<input name="annual_value" type="number" min="0"></label><label>Relationship score<input name="relationship_score" type="number" min="0" max="100" value="50"></label><label class="full">Tags<input name="tags" placeholder="priority, partner"></label><label class="full">Description<textarea name="description"></textarea></label></form>`, onSubmit: async () => {
    const form = $('#modalForm'); if (!form.reportValidity()) return; const data = formValues(form); data.tags = data.tags.split(',').map((tag) => tag.trim()).filter(Boolean); data.annual_value = Number(data.annual_value || 0); data.relationship_score = Number(data.relationship_score || 50);
    await api('/api/organizations', { method: 'POST', body: data }); closeModal(); toast('Organization created', data.name); state.organizations = []; await loadOrganizations();
  } });
}

async function showNewDealModal() {
  const orgs = await organizationOptions();
  const contacts = state.contacts.items.length ? state.contacts.items : (await api('/api/contacts?pageSize=100')).items;
  openModal({ title: 'Create deal', submitLabel: 'Create deal', body: `<form id="modalForm" class="form-grid"><label class="full">Deal name *<input name="name" required></label><label>Organization<select name="organization_id">${orgs}</select></label><label>Primary contact<select name="primary_contact_id"><option value="">No contact</option>${contacts.map((contact) => `<option value="${contact.id}">${escapeHtml(`${contact.first_name} ${contact.last_name}`)}</option>`).join('')}</select></label><label>Stage<select name="stage"><option value="lead">Lead</option><option value="qualified">Qualified</option><option value="proposal">Proposal</option><option value="negotiation">Negotiation</option><option value="won">Won</option></select></label><label>Value<input name="value" type="number" min="0" required></label><label>Currency<select name="currency"><option>EUR</option><option>USD</option><option>GBP</option><option>SGD</option><option>IDR</option></select></label><label>Probability %<input name="probability" type="number" min="0" max="100" value="10"></label><label>Expected close<input name="expected_close_date" type="date"></label><label class="full">Description<textarea name="description"></textarea></label></form>`, onSubmit: async () => {
    const form = $('#modalForm'); if (!form.reportValidity()) return; const data = formValues(form); data.value = Number(data.value || 0); data.probability = Number(data.probability || 0);
    await api('/api/deals', { method: 'POST', body: data }); closeModal(); toast('Deal created', data.name); await loadDeals();
  } });
}

async function showNewTaskModal() {
  const contacts = state.contacts.items.length ? state.contacts.items : (await api('/api/contacts?pageSize=100')).items;
  openModal({ title: 'Add task', submitLabel: 'Create task', body: `<form id="modalForm" class="form-grid"><label class="full">Task title *<input name="title" required></label><label>Contact<select name="contact_id"><option value="">General task</option>${contacts.map((contact) => `<option value="${contact.id}">${escapeHtml(`${contact.first_name} ${contact.last_name}`)}</option>`).join('')}</select></label><label>Priority<select name="priority"><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></select></label><label>Status<select name="status"><option value="open">Open</option><option value="in_progress">In progress</option></select></label><label>Due date<input name="due_at" type="datetime-local"></label><label class="full">Description<textarea name="description"></textarea></label></form>`, onSubmit: async () => {
    const form = $('#modalForm'); if (!form.reportValidity()) return; const data = formValues(form); if (!data.due_at) delete data.due_at;
    await api('/api/tasks', { method: 'POST', body: data }); closeModal(); toast('Task created', data.title); state.dashboard = null; if (state.route === 'tasks') await loadTasks();
  } });
}

async function showActivityModal(presetType = 'note', contact = state.activeContact) {
  const contacts = state.contacts.items.length ? state.contacts.items : (await api('/api/contacts?pageSize=100')).items;
  openModal({ title: 'Log interaction', submitLabel: 'Save interaction', body: `<form id="modalForm" class="form-grid"><label>Contact<select name="contact_id"><option value="">No contact</option>${contacts.map((item) => `<option value="${item.id}" ${contact?.id === item.id ? 'selected' : ''}>${escapeHtml(`${item.first_name} ${item.last_name}`)}</option>`).join('')}</select></label><label>Type<select name="type"><option value="email" ${presetType === 'email' ? 'selected' : ''}>Email</option><option value="call" ${presetType === 'call' ? 'selected' : ''}>Call</option><option value="meeting" ${presetType === 'meeting' ? 'selected' : ''}>Meeting</option><option value="whatsapp">WhatsApp</option><option value="linkedin">LinkedIn</option><option value="note" ${presetType === 'note' ? 'selected' : ''}>Note</option></select></label><label>Direction<select name="direction"><option value="outbound">Outbound</option><option value="inbound">Inbound</option><option value="internal" ${presetType === 'note' ? 'selected' : ''}>Internal</option></select></label><label>Occurred at<input name="occurred_at" type="datetime-local" value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16)}"></label><label class="full">Subject *<input name="subject" required placeholder="What happened?"></label><label class="full">Details<textarea name="body" placeholder="Conversation summary, key context and commitments"></textarea></label><label>Outcome<input name="outcome" placeholder="Positive, waiting, no answer…"></label><label>Next follow-up<input name="next_follow_up_at" type="datetime-local"></label></form>`, onSubmit: async () => {
    const form = $('#modalForm'); if (!form.reportValidity()) return; const data = formValues(form); if (!data.next_follow_up_at) delete data.next_follow_up_at;
    const path = data.contact_id ? `/api/contacts/${data.contact_id}/activities` : '/api/activities'; if (data.contact_id) delete data.contact_id;
    await api(path, { method: 'POST', body: data }); closeModal(); toast('Interaction logged', data.subject); state.dashboard = null; await loadDashboard(); if (contact?.id) await openContact(contact.id);
  } });
}

function showQuickAdd() {
  openModal({ title: 'Quick add', body: `<div class="architecture-grid"><button class="profile-action" data-quick-action="new-contact" type="button"><strong>◎</strong>Contact</button><button class="profile-action" data-quick-action="new-organization" type="button"><strong>▦</strong>Organization</button><button class="profile-action" data-quick-action="new-deal" type="button"><strong>€</strong>Deal</button><button class="profile-action" data-quick-action="new-task" type="button"><strong>✓</strong>Task</button><button class="profile-action" data-quick-action="log-activity" type="button"><strong>↗</strong>Interaction</button></div>` });
}

function triggerImport() {
  $('#csvFileInput').value = '';
  $('#csvFileInput').click();
}

async function handleCsvFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast('File too large', 'CSV imports are limited to 5 MB.', 'error');
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  openModal({ title: 'Import contacts', submitLabel: `Import ${Math.max(0, lines.length - 1)} rows`, body: `<div class="dropzone"><strong>${escapeHtml(file.name)}</strong><span>${(file.size / 1024).toFixed(1)} KB · ${Math.max(0, lines.length - 1)} data rows</span></div><div class="import-summary"><strong>Expected columns</strong><p class="form-hint">first_name, last_name, job_title, email, phone, organization, lifecycle_stage, source, tags</p></div>`, onSubmit: async () => {
    $('#modalSubmit').disabled = true; $('#modalSubmit').textContent = 'Importing…';
    const result = await api('/api/import/contacts', { method: 'POST', body: { csv: text, file_name: file.name } }); closeModal(); toast('Import complete', `${result.success} imported, ${result.failures} failed.`); state.dashboard = null; await loadContacts(1);
  } });
}

async function exportContacts() {
  toast('Preparing export', 'Gathering all contact pages…');
  let page = 1; let pages = 1; const items = [];
  do {
    const result = await api(`/api/contacts?page=${page}&pageSize=100&sort=name&order=asc`);
    items.push(...result.items); pages = result.pages; page += 1;
  } while (page <= pages);
  const headers = ['first_name','last_name','job_title','email','phone','organization','lifecycle_stage','relationship_score','last_contact_at','next_follow_up_at','tags'];
  const csvEscape = (value) => /[",\n]/.test(String(value ?? '')) ? `"${String(value ?? '').replaceAll('"','""')}"` : String(value ?? '');
  const csv = [headers.join(','), ...items.map((contact) => headers.map((header) => csvEscape(header === 'tags' ? (contact.tags || []).join('; ') : contact[header])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `partnermarket-contacts-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(url);
  toast('Export ready', `${items.length} contacts downloaded.`);
}

async function openDealEditor(id) {
  const deal = state.deals.find((item) => item.id === id);
  if (!deal) return;
  openModal({ title: 'Update deal stage', submitLabel: 'Update deal', body: `<form id="modalForm" class="form-grid"><label class="full">Deal<input value="${escapeHtml(deal.name)}" disabled></label><label>Stage<select name="stage">${['lead','qualified','proposal','negotiation','won','lost'].map((stage) => `<option value="${stage}" ${deal.stage === stage ? 'selected' : ''}>${titleCase(stage)}</option>`).join('')}</select></label><label>Probability %<input name="probability" type="number" min="0" max="100" value="${deal.probability}"></label><label>Expected close<input name="expected_close_date" type="date" value="${deal.expected_close_date?.slice(0,10) || ''}"></label><label class="full">Notes<textarea name="description">${escapeHtml(deal.description || '')}</textarea></label></form>`, onSubmit: async () => {
    const data = formValues($('#modalForm')); data.probability = Number(data.probability || 0); await api(`/api/deals/${id}`, { method: 'PATCH', body: data }); closeModal(); toast('Deal updated', deal.name); await loadDeals(); state.dashboard = null;
  } });
}

const searchGlobal = debounce(async (query) => {
  const root = $('#searchResults');
  if (query.trim().length < 2) { root.hidden = true; return; }
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query.trim())}`);
    const groups = [
      ['Contacts', data.contacts], ['Organizations', data.organizations], ['Deals', data.deals],
    ].filter(([, items]) => items?.length);
    root.innerHTML = groups.length ? groups.map(([label, items]) => `<div class="search-group-title">${label}</div>${items.map((item) => `<button class="search-result" data-search-type="${item.type}" data-search-id="${item.id}" type="button"><span class="search-result-icon">${item.type === 'contact' ? '◎' : item.type === 'organization' ? '▦' : '€'}</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.subtitle || item.email || '')}</small></span></button>`).join('')}`).join('') : '<div class="empty-state">No matching records.</div>';
    root.hidden = false;
  } catch {
    root.hidden = true;
  }
}, 220);

function bindEvents() {
  window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
  document.addEventListener('click', async (event) => {
    const nav = event.target.closest('[data-route]');
    if (nav) { event.preventDefault(); navigate(nav.dataset.route); return; }
    const jump = event.target.closest('[data-route-jump]'); if (jump) { navigate(jump.dataset.routeJump); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action) {
      if (action === 'new-contact') await showNewContactModal();
      if (action === 'new-organization') showNewOrganizationModal();
      if (action === 'new-deal') await showNewDealModal();
      if (action === 'new-task') await showNewTaskModal();
      if (action === 'log-activity') await showActivityModal();
      if (action === 'import-contacts') triggerImport();
      if (action === 'export-contacts') await exportContacts();
      return;
    }
    const quick = event.target.closest('[data-quick-action]'); if (quick) { const actionName = quick.dataset.quickAction; closeModal(); setTimeout(() => document.querySelector(`[data-action="${actionName}"]`)?.click(), 20); return; }
    if (event.target.closest('[data-close-modal]') || event.target === $('#modalBackdrop')) { closeModal(); return; }
    if (event.target.closest('[data-close-drawer]') || event.target === $('#drawerBackdrop')) { closeDrawer(); return; }
    const contactRow = event.target.closest('[data-contact-id]');
    if (contactRow && !event.target.matches('input') && !event.target.closest('button')) { await openContact(contactRow.dataset.contactId); return; }
    const contactButton = event.target.closest('[data-open-contact]'); if (contactButton) { await openContact(contactButton.dataset.openContact); return; }
    const pageButton = event.target.closest('[data-contact-page]'); if (pageButton && !pageButton.disabled) { state.contacts.page = Number(pageButton.dataset.contactPage); await loadContacts(state.contacts.page); return; }
    const complete = event.target.closest('[data-complete-task]'); if (complete) { await completeTask(complete.dataset.completeTask); return; }
    const contactAction = event.target.closest('[data-contact-action]'); if (contactAction) { await showActivityModal(contactAction.dataset.contactAction, state.activeContact); return; }
    const dealCard = event.target.closest('[data-deal-id]'); if (dealCard) { await openDealEditor(dealCard.dataset.dealId); return; }
    const searchResult = event.target.closest('[data-search-type]');
    if (searchResult) {
      $('#searchResults').hidden = true; $('#globalSearch').value = '';
      if (searchResult.dataset.searchType === 'contact') await openContact(searchResult.dataset.searchId);
      else navigate(searchResult.dataset.searchType === 'deal' ? 'pipeline' : 'organizations');
      return;
    }
    if (!event.target.closest('.global-search-wrap')) $('#searchResults').hidden = true;
  });

  $('#modal').addEventListener('click', async (event) => {
    if (event.target.id === 'modalSubmit' && $('#modal')._onSubmit) {
      try { event.target.disabled = true; await $('#modal')._onSubmit(); }
      catch (error) { event.target.disabled = false; toast('Unable to save', error.message, 'error'); }
    }
  });

  $('#menuButton').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#themeButton').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; localStorage.setItem('pmg-theme', next);
  });
  $('#quickAddButton').addEventListener('click', showQuickAdd);
  $('#globalSearch').addEventListener('input', (event) => searchGlobal(event.target.value));
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#globalSearch').focus(); }
    if (event.key === 'Escape') { closeModal(); closeDrawer(); $('#searchResults').hidden = true; }
  });

  $('#contactSearch').addEventListener('input', debounce(async (event) => { state.contacts.q = event.target.value.trim(); state.contacts.page = 1; await loadContacts(1); }, 300));
  $('#contactStageFilter').addEventListener('change', async (event) => { state.contacts.stage = event.target.value; await loadContacts(1); });
  $('#contactSort').addEventListener('change', async (event) => { state.contacts.sort = event.target.value; await loadContacts(1); });
  $('#contactRefresh').addEventListener('click', () => loadContacts());
  $('#selectAllContacts').addEventListener('change', (event) => { state.contacts.items.forEach((contact) => event.target.checked ? state.selectedContacts.add(contact.id) : state.selectedContacts.delete(contact.id)); renderContacts(); });
  $('#contactsTableBody').addEventListener('change', (event) => { const id = event.target.dataset.selectContact; if (!id) return; event.target.checked ? state.selectedContacts.add(id) : state.selectedContacts.delete(id); updateSelectionBar(); });
  $('#organizationSearch').addEventListener('input', debounce(loadOrganizations, 300));
  $('#organizationTypeFilter').addEventListener('change', loadOrganizations);
  $('#taskTabs').addEventListener('click', async (event) => { const button = event.target.closest('[data-task-status]'); if (!button) return; $$('#taskTabs button').forEach((item) => item.classList.toggle('active', item === button)); await loadTasks(button.dataset.taskStatus); });
  $('#analyticsRange').addEventListener('change', loadAnalytics);
  $('#csvFileInput').addEventListener('change', (event) => handleCsvFile(event.target.files[0]));
}

boot();
