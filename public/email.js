const emailUi = {
  senders: [],
  contacts: [],
  organizations: [],
  deals: [],
  messages: [],
  permissions: {},
};

const emailEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
const emailWorkspaceId = () => localStorage.getItem('pmg-workspace') || '';
const splitEmailAddresses = (value) => String(value ?? '').split(/[;,\n]/).map((item) => item.trim().toLowerCase()).filter(Boolean);

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
  setTimeout(() => node.remove(), type === 'warning' ? 7000 : 4500);
}

function emailOption(items, value, label, selected = '', placeholder = 'Select…') {
  return `<option value="">${emailEscape(placeholder)}</option>${items.map((item) => `<option value="${emailEscape(item[value])}" ${String(item[value]) === String(selected) ? 'selected' : ''}>${emailEscape(label(item))}</option>`).join('')}`;
}

function emailField(label, name, type = 'text', value = '', options = '', full = false, required = false, hint = '') {
  const classes = full ? 'field full' : 'field';
  const hintMarkup = hint ? `<small class="email-field-hint">${emailEscape(hint)}</small>` : '';
  if (type === 'textarea') return `<div class="${classes}"><label>${emailEscape(label)}</label><textarea name="${name}" ${required ? 'required' : ''}>${emailEscape(value)}</textarea>${hintMarkup}</div>`;
  if (type === 'select') return `<div class="${classes}"><label>${emailEscape(label)}</label><select name="${name}" ${required ? 'required' : ''}>${options}</select>${hintMarkup}</div>`;
  return `<div class="${classes}"><label>${emailEscape(label)}</label><input name="${name}" type="${type}" value="${emailEscape(value)}" ${required ? 'required' : ''}>${hintMarkup}</div>`;
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
    .email-composer textarea[name=text_body]{min-height:220px}.email-composer textarea[name=html_body]{min-height:140px;font-family:ui-monospace,monospace;font-size:12px}
    .email-history{display:grid;gap:10px;margin-top:14px}.email-history-item{padding:12px;border:1px solid var(--border,#dbe5e8);border-radius:12px;background:var(--surface,#fff)}.email-history-item small{display:block;color:var(--muted,#6c7d84);margin-top:4px}
    .email-status{display:inline-flex;padding:3px 8px;border-radius:999px;background:var(--primary-soft,#dcf7f1);font-size:11px;font-weight:700;text-transform:uppercase}.email-status.failed{background:#fee2e2;color:#b91c1c}.email-status.queued{background:#fef3c7;color:#92400e}
    .email-domain-note,.email-field-hint{font-size:12px;color:var(--muted,#6c7d84);line-height:1.55}.email-field-hint{display:block;margin-top:5px}.email-sender-list{display:grid;gap:8px;margin:12px 0}.email-sender-card{padding:10px;border:1px solid var(--border,#dbe5e8);border-radius:12px;background:var(--surface,#fff)}
    .email-sender-form{margin:12px 0;padding:14px;border:1px solid var(--border,#dbe5e8);border-radius:14px;background:var(--surface,#fff)}.email-sender-form .field{margin-bottom:10px}.email-sender-form input{width:100%}.email-sender-form-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
    .email-advanced{margin:14px 0;border:1px solid var(--border,#dbe5e8);border-radius:14px;padding:0 14px}.email-advanced summary{cursor:pointer;font-weight:700;padding:14px 0}.email-advanced .form-grid{padding-bottom:14px}
    .toast.warning{border-color:#f59e0b}.toast.warning strong{color:#b45309}
    @media(max-width:800px){.email-composer-backdrop{padding:0}.email-composer{height:100vh;max-height:none;border-radius:0}.email-composer-layout{grid-template-columns:1fr}.email-composer-side{border-left:0;border-top:1px solid var(--border,#dbe5e8)}}
  `;
  document.head.append(style);
}

async function loadEmailReferences() {
  const [me, senders, contacts, organizations, deals, messages] = await Promise.all([
    emailApi('/api/me'),
    emailApi('/api/email/senders'),
    emailApi('/api/contacts?pageSize=250'),
    emailApi('/api/organizations'),
    emailApi('/api/deals'),
    emailApi('/api/email/messages?limit=12'),
  ]);
  emailUi.permissions = me.permissions || {};
  emailUi.senders = senders;
  emailUi.contacts = contacts.items || [];
  emailUi.organizations = organizations;
  emailUi.deals = deals;
  emailUi.messages = messages;
}

function selectedContact(id) { return emailUi.contacts.find((contact) => contact.id === id); }
function contactsForAccount(accountId) { return accountId ? emailUi.contacts.filter((contact) => contact.organization_id === accountId) : emailUi.contacts; }
function dealsForAccount(accountId) { return accountId ? emailUi.deals.filter((deal) => deal.organization_id === accountId) : emailUi.deals; }

function renderEmailHistory() {
  if (!emailUi.messages.length) return '<p class="email-domain-note">No emails have been sent from this workspace yet.</p>';
  return `<div class="email-history">${emailUi.messages.map((message) => `<article class="email-history-item"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${emailEscape(message.subject)}</strong><span class="email-status ${emailEscape(message.status)}">${emailEscape(message.status)}</span></div><small>${emailEscape(message.organization_name || '')}${message.contact_name ? ` · ${emailEscape(message.contact_name)}` : ''}</small><small>From ${emailEscape(message.from_email)} · ${new Date(message.sent_at || message.created_at).toLocaleString()}</small>${message.failure_reason ? `<small>${emailEscape(message.failure_reason)}</small>` : ''}</article>`).join('')}</div>`;
}

function renderSenderCards() {
  if (!emailUi.senders.length) return '<p class="email-domain-note">No active sender identity exists in this workspace.</p>';
  return emailUi.senders.map((item) => `<div class="email-sender-card"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${emailEscape(item.display_name)}</strong>${item.is_default ? '<span class="email-status">Default</span>' : ''}</div><small style="display:block">${emailEscape(item.email_address)}</small>${item.reply_to && item.reply_to !== item.email_address ? `<small style="display:block">Replies to ${emailEscape(item.reply_to)}</small>` : ''}</div>`).join('');
}

function updateAssociationSelectors(form, accountId, selectedContactId = '', selectedDealId = '') {
  const contactSelect = form.elements.contact_id;
  const dealSelect = form.elements.deal_id;
  contactSelect.innerHTML = emailOption(contactsForAccount(accountId), 'id', (item) => `${item.first_name} ${item.last_name}${item.email ? ` — ${item.email}` : ''}`, selectedContactId, 'Optional contact');
  dealSelect.innerHTML = emailOption(dealsForAccount(accountId), 'id', (item) => item.name, selectedDealId, 'Optional deal');
}

async function openEmailComposer(defaults = {}) {
  composerStyles();
  try { await loadEmailReferences(); } catch (error) { emailToast('Unable to open email composer', error.message, 'error'); return; }
  const accountId = defaults.organization_id || localStorage.getItem('pmg-account') || '';
  const contact = defaults.contact_id ? selectedContact(defaults.contact_id) : emailUi.contacts.find((item) => item.email?.toLowerCase() === String(defaults.to || '').toLowerCase());
  const initialAccountId = contact?.organization_id || accountId;
  const sender = emailUi.senders.find((item) => item.is_default) || emailUi.senders[0];
  const backdrop = document.createElement('div');
  backdrop.className = 'email-composer-backdrop';
  backdrop.innerHTML = `<section class="email-composer" role="dialog" aria-modal="true" aria-labelledby="emailComposerTitle">
    <header><div><p class="eyebrow">Cloudflare Email Service</p><h2 id="emailComposerTitle">Compose email</h2><p>Send from an approved business domain and log the conversation to the correct CRM account automatically.</p></div><button class="icon-button" data-email-close aria-label="Close">×</button></header>
    <div class="email-composer-layout"><main class="email-composer-main"><form id="emailComposerForm">
      <div class="form-grid three">
        ${emailField('From identity','sender_identity_id','select','',emailOption(emailUi.senders,'id',(item)=>`${item.display_name} <${item.email_address}>`,sender?.id,'Select sender'),false,true)}
        ${emailField('CRM account','organization_id','select','',emailOption(emailUi.organizations,'id',(item)=>item.name,initialAccountId,'Select account'),false,true)}
        ${emailField('CRM contact','contact_id','select','',emailOption(contactsForAccount(initialAccountId),'id',(item)=>`${item.first_name} ${item.last_name}${item.email ? ` — ${item.email}` : ''}`,contact?.id,'Optional contact'))}
        ${emailField('To','to','text',defaults.to || contact?.email || '', '', true, true,'Separate multiple recipients with commas or semicolons.')}
        ${emailField('CC','cc','text','', '', false, false,'Optional; comma or semicolon separated.')}
        ${emailField('BCC','bcc','text','', '', false, false,'Optional; comma or semicolon separated.')}
        ${emailField('Deal','deal_id','select','',emailOption(dealsForAccount(initialAccountId),'id',(item)=>item.name,defaults.deal_id,'Optional deal'))}
        ${emailField('Subject','subject','text',defaults.subject || '', '', true, true)}
        ${emailField('Plain-text message','text_body','textarea',defaults.body || '', '', true, false,'Enter plain text, HTML below, or both. Plain text improves accessibility and deliverability.')}
      </div>
      <details class="email-advanced"><summary>HTML and follow-up options</summary><div class="form-grid three">
        ${emailField('Optional HTML','html_body','textarea','', '', true)}
        ${emailField('Next step','next_step','text','', '', true)}
        ${emailField('Follow-up date','follow_up_due_at','datetime-local','')}
        ${emailField('Follow-up priority','follow_up_priority','select','',`<option>medium</option><option>high</option><option>urgent</option><option>low</option>`)}
      </div></details>
      <div class="form-actions"><button type="button" class="button secondary" data-email-close>Cancel</button><button type="submit" class="button primary" ${sender ? '' : 'disabled'}>Send and log email</button></div>
    </form></main>
    <aside class="email-composer-side"><h3>Sender identities</h3><p class="email-domain-note">Approved domains: <strong>@goldendragoncapital.co</strong>, <strong>@devriessalesconsultancy.com</strong>, and <strong>@partnermarketglobal.com</strong>. Domains must be onboarded in Cloudflare Email Sending before delivery.</p>
      <div class="email-sender-list" data-email-sender-list>${renderSenderCards()}</div>
      ${emailUi.permissions.can_manage ? '<button class="small-button" type="button" data-email-add-sender>＋ Add sender identity</button>' : ''}
      <form class="email-sender-form" data-email-sender-form hidden>
        ${emailField('Sender email','email_address','email','', '', true, true)}
        ${emailField('Display name','display_name','text','', '', true, true)}
        ${emailField('Reply-to','reply_to','email','', '', true)}
        <label style="display:flex;align-items:center;gap:8px;font-size:12px"><input type="checkbox" name="is_default" value="1"> Use as default for this workspace</label>
        <div class="email-sender-form-actions"><button class="small-button" type="button" data-email-sender-cancel>Cancel</button><button class="small-button" type="submit">Add identity</button></div>
      </form>
      <h3 style="margin-top:24px">Recent sent mail</h3>${renderEmailHistory()}
    </aside></div></section>`;
  document.body.append(backdrop);

  const form = backdrop.querySelector('#emailComposerForm');
  const senderForm = backdrop.querySelector('[data-email-sender-form]');
  const accountSelect = form.elements.organization_id;
  const contactSelect = form.elements.contact_id;
  accountSelect.addEventListener('change', () => updateAssociationSelectors(form, accountSelect.value));
  contactSelect.addEventListener('change', () => {
    const selected = selectedContact(contactSelect.value);
    if (!selected) return;
    accountSelect.value = selected.organization_id || accountSelect.value;
    updateAssociationSelectors(form, accountSelect.value, selected.id, form.elements.deal_id.value);
    form.elements.to.value = selected.email || form.elements.to.value;
  });

  const closeComposer = () => backdrop.remove();
  const escapeHandler = (event) => { if (event.key === 'Escape') { closeComposer(); document.removeEventListener('keydown', escapeHandler); } };
  document.addEventListener('keydown', escapeHandler);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target.closest('[data-email-close]')) closeComposer();
    if (event.target.closest('[data-email-add-sender]')) senderForm.hidden = false;
    if (event.target.closest('[data-email-sender-cancel]')) { senderForm.reset(); senderForm.hidden = true; }
  });

  senderForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = senderForm.querySelector('[type=submit]');
    button.disabled = true; button.textContent = 'Adding…';
    try {
      const data = Object.fromEntries(new FormData(senderForm).entries());
      const created = await emailApi('/api/email/senders', { method: 'POST', body: data });
      if (created.is_default) emailUi.senders.forEach((item) => { item.is_default = false; });
      emailUi.senders.push(created);
      form.elements.sender_identity_id.insertAdjacentHTML('beforeend', `<option value="${emailEscape(created.id)}">${emailEscape(`${created.display_name} <${created.email_address}>`)}</option>`);
      form.elements.sender_identity_id.value = created.id;
      backdrop.querySelector('[data-email-sender-list]').innerHTML = renderSenderCards();
      form.querySelector('[type=submit]').disabled = false;
      senderForm.reset(); senderForm.hidden = true;
      emailToast('Sender identity added', created.email_address);
    } catch (error) { emailToast('Unable to add sender', error.message, 'error'); }
    finally { button.disabled = false; button.textContent = 'Add identity'; }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true; submit.textContent = 'Sending…';
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const selected = selectedContact(data.contact_id);
      const allRecipients = [...splitEmailAddresses(data.to), ...splitEmailAddresses(data.cc), ...splitEmailAddresses(data.bcc)];
      if (selected?.email && !allRecipients.includes(selected.email.toLowerCase())) throw new Error('The selected CRM contact must be one of the recipients.');
      if (!String(data.text_body || '').trim() && !String(data.html_body || '').trim()) throw new Error('Enter a plain-text or HTML email body.');
      const result = await emailApi('/api/email/send', { method: 'POST', body: data });
      emailToast('Email sent and logged', `${result.organization_name || 'The account'} now has this email in its contact history.`);
      if (result.logging_warning) emailToast('Email sent with a CRM warning', result.logging_warning, 'warning');
      closeComposer();
      window.dispatchEvent(new Event('hashchange'));
    } catch (error) {
      emailToast('Email was not sent', error.message, 'error');
      submit.disabled = false; submit.textContent = 'Send and log email';
    }
  });
  form.elements.subject?.focus();
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
