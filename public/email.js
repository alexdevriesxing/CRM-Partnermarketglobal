const emailUi = {
  senders: [],
  contacts: [],
  organizations: [],
  deals: [],
  messages: [],
};

const emailEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
const emailWorkspaceId = () => localStorage.getItem('pmg-workspace') || '';

async function emailApi(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) };
  if (emailWorkspaceId()) headers['x-workspace-id'] = emailWorkspaceId();
  const response = await fetch(path, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  const payload = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || payload || `Request failed (${response.status})`);
  return payload;
}

function emailToast(title, message = '', type = 'success') {
  const root = document.querySelector('#toastStack') || document.body;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `<strong>${emailEscape(title)}</strong>${message ? `<span>${emailEscape(message)}</span>` : ''}`;
  root.append(node);
  setTimeout(() => node.remove(), 4500);
}

function emailOption(items, value, label, selected = '', placeholder = 'Select…') {
  return `<option value="">${emailEscape(placeholder)}</option>${items.map((item) => `<option value="${emailEscape(item[value])}" ${String(item[value]) === String(selected) ? 'selected' : ''}>${emailEscape(label(item))}</option>`).join('')}`;
}

function emailField(label, name, type = 'text', value = '', options = '', full = false, required = false) {
  const classes = full ? 'field full' : 'field';
  if (type === 'textarea') return `<div class="${classes}"><label>${emailEscape(label)}</label><textarea name="${name}" ${required ? 'required' : ''}>${emailEscape(value)}</textarea></div>`;
  if (type === 'select') return `<div class="${classes}"><label>${emailEscape(label)}</label><select name="${name}" ${required ? 'required' : ''}>${options}</select></div>`;
  return `<div class="${classes}"><label>${emailEscape(label)}</label><input name="${name}" type="${type}" value="${emailEscape(value)}" ${required ? 'required' : ''}></div>`;
}

function composerStyles() {
  if (document.querySelector('#emailComposerStyles')) return;
  const style = document.createElement('style');
  style.id = 'emailComposerStyles';
  style.textContent = `
    .email-composer-backdrop{position:fixed;inset:0;background:rgba(7,18,25,.58);backdrop-filter:blur(7px);z-index:1200;display:grid;place-items:center;padding:24px}
    .email-composer{width:min(1120px,100%);max-height:92vh;overflow:auto;background:var(--surface,#fff);color:var(--text,#17242b);border:1px solid var(--border,#dbe5e8);border-radius:22px;box-shadow:0 28px 80px rgba(0,0,0,.28)}
    .email-composer>header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:22px 24px;border-bottom:1px solid var(--border,#dbe5e8);position:sticky;top:0;background:var(--surface,#fff);z-index:2}
    .email-composer-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:0}.email-composer-main{padding:24px}.email-composer-side{padding:24px;border-left:1px solid var(--border,#dbe5e8);background:var(--surface-muted,#f6f9fa)}
    .email-composer textarea[name=text_body]{min-height:210px}.email-composer textarea[name=html_body]{min-height:120px;font-family:ui-monospace,monospace;font-size:12px}
    .email-history{display:grid;gap:10px;margin-top:14px}.email-history-item{padding:12px;border:1px solid var(--border,#dbe5e8);border-radius:12px;background:var(--surface,#fff)}.email-history-item small{display:block;color:var(--muted,#6c7d84);margin-top:4px}
    .email-status{display:inline-flex;padding:3px 8px;border-radius:999px;background:var(--primary-soft,#dcf7f1);font-size:11px;font-weight:700;text-transform:uppercase}.email-status.failed{background:#fee2e2;color:#b91c1c}
    .email-domain-note{font-size:12px;color:var(--muted,#6c7d84);line-height:1.55}.email-sender-list{display:grid;gap:8px;margin:12px 0}.email-sender-card{padding:10px;border:1px solid var(--border,#dbe5e8);border-radius:12px;background:var(--surface,#fff)}
    @media(max-width:800px){.email-composer-backdrop{padding:0}.email-composer{height:100vh;max-height:none;border-radius:0}.email-composer-layout{grid-template-columns:1fr}.email-composer-side{border-left:0;border-top:1px solid var(--border,#dbe5e8)}}
  `;
  document.head.append(style);
}

async function loadEmailReferences() {
  const [senders, contacts, organizations, deals, messages] = await Promise.all([
    emailApi('/api/email/senders'),
    emailApi('/api/contacts?pageSize=250'),
    emailApi('/api/organizations'),
    emailApi('/api/deals'),
    emailApi('/api/email/messages?limit=12'),
  ]);
  emailUi.senders = senders;
  emailUi.contacts = contacts.items || [];
  emailUi.organizations = organizations;
  emailUi.deals = deals;
  emailUi.messages = messages;
}

function selectedContact(id) { return emailUi.contacts.find((contact) => contact.id === id); }

function renderEmailHistory() {
  if (!emailUi.messages.length) return '<p class="email-domain-note">No emails have been sent from this workspace yet.</p>';
  return `<div class="email-history">${emailUi.messages.map((message) => `<article class="email-history-item"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${emailEscape(message.subject)}</strong><span class="email-status ${message.status === 'failed' ? 'failed' : ''}">${emailEscape(message.status)}</span></div><small>${emailEscape(message.organization_name || '')}${message.contact_name ? ` · ${emailEscape(message.contact_name)}` : ''}</small><small>From ${emailEscape(message.from_email)} · ${new Date(message.sent_at || message.created_at).toLocaleString()}</small></article>`).join('')}</div>`;
}

async function openEmailComposer(defaults = {}) {
  composerStyles();
  try { await loadEmailReferences(); } catch (error) { emailToast('Unable to open email composer', error.message, 'error'); return; }
  const accountId = defaults.organization_id || localStorage.getItem('pmg-account') || '';
  const contact = defaults.contact_id ? selectedContact(defaults.contact_id) : emailUi.contacts.find((item) => item.email?.toLowerCase() === String(defaults.to || '').toLowerCase());
  const sender = emailUi.senders.find((item) => item.is_default) || emailUi.senders[0];
  const backdrop = document.createElement('div');
  backdrop.className = 'email-composer-backdrop';
  backdrop.innerHTML = `<section class="email-composer" role="dialog" aria-modal="true" aria-labelledby="emailComposerTitle">
    <header><div><p class="eyebrow">Cloudflare Email Service</p><h2 id="emailComposerTitle">Compose email</h2><p>Send from an approved business domain and log the conversation to the correct CRM account automatically.</p></div><button class="icon-button" data-email-close aria-label="Close">×</button></header>
    <div class="email-composer-layout"><main class="email-composer-main"><form id="emailComposerForm">
      <div class="form-grid three">
        ${emailField('From identity','sender_identity_id','select','',emailOption(emailUi.senders,'id',(item)=>`${item.display_name} <${item.email_address}>`,sender?.id,'Select sender'),false,true)}
        ${emailField('CRM contact','contact_id','select','',emailOption(emailUi.contacts,'id',(item)=>`${item.first_name} ${item.last_name}${item.email ? ` — ${item.email}` : ''}`,contact?.id,'Optional contact'))}
        ${emailField('CRM account','organization_id','select','',emailOption(emailUi.organizations,'id',(item)=>item.name,contact?.organization_id || accountId,'Select account'),false,true)}
        ${emailField('To','to','email',defaults.to || contact?.email || '', '', true, true)}
        ${emailField('CC','cc','text','')}
        ${emailField('BCC','bcc','text','')}
        ${emailField('Deal','deal_id','select','',emailOption(emailUi.deals,'id',(item)=>item.name,defaults.deal_id,'Optional deal'))}
        ${emailField('Subject','subject','text',defaults.subject || '', '', true, true)}
        ${emailField('Plain-text message','text_body','textarea',defaults.body || '', '', true, true)}
        ${emailField('Optional HTML','html_body','textarea','', '', true)}
        ${emailField('Next step','next_step','text','', '', true)}
        ${emailField('Follow-up date','follow_up_due_at','datetime-local','')}
        ${emailField('Follow-up priority','follow_up_priority','select','',`<option>medium</option><option>high</option><option>urgent</option><option>low</option>`)}
      </div>
      <div class="form-actions"><button type="button" class="button secondary" data-email-close>Cancel</button><button type="submit" class="button primary">Send and log email</button></div>
    </form></main>
    <aside class="email-composer-side"><h3>Sender identities</h3><p class="email-domain-note">Approved domains: <strong>@goldendragoncapital.co</strong>, <strong>@devriessalesconsultancy.com</strong>, and <strong>@partnermarketglobal.com</strong>. Domains must be onboarded in Cloudflare Email Sending before delivery.</p>
      <div class="email-sender-list">${emailUi.senders.map((item)=>`<div class="email-sender-card"><strong>${emailEscape(item.display_name)}</strong><small style="display:block">${emailEscape(item.email_address)}</small></div>`).join('')}</div>
      <button class="small-button" type="button" data-email-add-sender>＋ Add sender identity</button>
      <h3 style="margin-top:24px">Recent sent mail</h3>${renderEmailHistory()}
    </aside></div></section>`;
  document.body.append(backdrop);

  const form = backdrop.querySelector('#emailComposerForm');
  const contactSelect = form.elements.contact_id;
  contactSelect.addEventListener('change', () => {
    const selected = selectedContact(contactSelect.value);
    if (!selected) return;
    form.elements.to.value = selected.email || form.elements.to.value;
    form.elements.organization_id.value = selected.organization_id || form.elements.organization_id.value;
  });

  backdrop.addEventListener('click', async (event) => {
    if (event.target === backdrop || event.target.closest('[data-email-close]')) backdrop.remove();
    if (event.target.closest('[data-email-add-sender]')) await openSenderIdentityForm(backdrop);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true; submit.textContent = 'Sending…';
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const result = await emailApi('/api/email/send', { method: 'POST', body: data });
      emailToast('Email sent and logged', `${result.organization_name || 'The account'} now has this email in its contact history.`);
      backdrop.remove();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (error) {
      emailToast('Email was not sent', error.message, 'error');
      submit.disabled = false; submit.textContent = 'Send and log email';
    }
  });
}

async function openSenderIdentityForm(composerBackdrop) {
  const address = prompt('Sender email address on an approved domain');
  if (!address) return;
  const displayName = prompt('Sender display name', address.split('@')[0]);
  if (!displayName) return;
  try {
    await emailApi('/api/email/senders', { method: 'POST', body: { email_address: address, display_name: displayName, reply_to: address } });
    emailToast('Sender identity added', address);
    composerBackdrop.remove();
    await openEmailComposer();
  } catch (error) { emailToast('Unable to add sender', error.message, 'error'); }
}

function installEmailComposer() {
  composerStyles();
  const actions = document.querySelector('.topbar-actions');
  if (actions && !actions.querySelector('[data-compose-email]')) {
    const button = document.createElement('button');
    button.className = 'button secondary';
    button.dataset.composeEmail = '1';
    button.textContent = '✉ Compose';
    actions.prepend(button);
  }
  document.addEventListener('click', (event) => {
    const compose = event.target.closest('[data-compose-email]');
    if (compose) { event.preventDefault(); openEmailComposer({ contact_id: compose.dataset.contactId, organization_id: compose.dataset.organizationId, deal_id: compose.dataset.dealId, to: compose.dataset.to, subject: compose.dataset.subject }); }
    const mailto = event.target.closest('a[href^="mailto:"]');
    if (mailto) { event.preventDefault(); openEmailComposer({ to: decodeURIComponent(mailto.getAttribute('href').slice(7).split('?')[0]) }); }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installEmailComposer);
else installEmailComposer();

export { openEmailComposer };
