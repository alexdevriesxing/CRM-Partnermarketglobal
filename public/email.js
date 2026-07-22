const emailUi = {
  senders: [],
  contacts: [],
  organizations: [],
  deals: [],
  messages: [],
  permissions: {},
  overview: null,
  health: null,
  centerFilters: { q: '', status: '', sender: '', days: '30' },
};

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const emailEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
const emailWorkspaceId = () => localStorage.getItem('pmg-workspace') || '';
const emailDraftKey = () => `pmg-email-draft:${emailWorkspaceId() || 'default'}`;
const splitEmailAddresses = (value) => String(value ?? '').split(/[;,\n]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
const createRequestId = () => crypto.randomUUID();

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
  setTimeout(() => node.remove(), type === 'warning' ? 7500 : 4800);
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
    .email-composer-backdrop{position:fixed;inset:0;background:rgba(7,18,25,.64);backdrop-filter:blur(9px);z-index:1200;display:grid;place-items:center;padding:24px}
    .email-composer{width:min(1180px,100%);max-height:94vh;overflow:auto;background:var(--surface,#fff);color:var(--text,#17242b);border:1px solid var(--border,#dbe5e8);border-radius:24px;box-shadow:0 32px 90px rgba(0,0,0,.32)}
    .email-composer>header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:22px 24px;border-bottom:1px solid var(--border,#dbe5e8);position:sticky;top:0;background:color-mix(in srgb,var(--surface,#fff) 96%,transparent);backdrop-filter:blur(12px);z-index:3}
    .email-composer-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px}.email-composer-main{padding:24px}.email-composer-side{padding:24px;border-left:1px solid var(--border,#dbe5e8);background:var(--surface-muted,#f6f9fa)}
    .email-composer textarea[name=text_body]{min-height:230px}.email-composer textarea[name=html_body]{min-height:150px;font-family:ui-monospace,monospace;font-size:12px}
    .email-history{display:grid;gap:10px;margin-top:14px}.email-history-item{padding:12px;border:1px solid var(--border,#dbe5e8);border-radius:13px;background:var(--surface,#fff)}.email-history-item small{display:block;color:var(--muted,#6c7d84);margin-top:4px}.email-history-actions{display:flex;gap:6px;margin-top:9px}
    .email-status{display:inline-flex;padding:3px 8px;border-radius:999px;background:var(--primary-soft,#dcf7f1);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.email-status.failed{background:#fee2e2;color:#b91c1c}.email-status.queued{background:#fef3c7;color:#92400e}
    .email-domain-note,.email-field-hint{font-size:12px;color:var(--muted,#6c7d84);line-height:1.55}.email-field-hint{display:block;margin-top:5px}.email-sender-list{display:grid;gap:8px;margin:12px 0}.email-sender-card{padding:11px;border:1px solid var(--border,#dbe5e8);border-radius:13px;background:var(--surface,#fff)}.email-sender-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}
    .email-sender-form{margin:12px 0;padding:14px;border:1px solid var(--border,#dbe5e8);border-radius:14px;background:var(--surface,#fff)}.email-sender-form .field{margin-bottom:10px}.email-sender-form input{width:100%}.email-sender-form-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
    .email-advanced{margin:14px 0;border:1px solid var(--border,#dbe5e8);border-radius:14px;padding:0 14px}.email-advanced summary{cursor:pointer;font-weight:700;padding:14px 0}.email-advanced .form-grid{padding-bottom:14px}
    .email-draft-note{margin-bottom:14px;padding:10px 12px;border-radius:12px;background:var(--primary-soft,#dcf7f1);font-size:12px}.email-attachments{display:grid;gap:7px;margin-top:8px}.email-attachment{display:flex;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid var(--border,#dbe5e8);border-radius:10px;font-size:12px}.toast.warning{border-color:#f59e0b}.toast.warning strong{color:#b45309}
    .email-center-health{display:flex;align-items:center;gap:10px}.email-health-dot{width:10px;height:10px;border-radius:99px;background:var(--red,#c84747);box-shadow:0 0 0 4px color-mix(in srgb,var(--red,#c84747) 18%,transparent)}.email-health-dot.ok{background:var(--green,#15936b);box-shadow:0 0 0 4px color-mix(in srgb,var(--green,#15936b) 18%,transparent)}.email-center-chart{height:190px;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(22px,1fr);align-items:end;gap:7px;padding:16px 2px 4px;overflow-x:auto;overscroll-behavior-inline:contain}.email-center-bar{min-height:4px;border-radius:7px 7px 3px 3px;background:linear-gradient(180deg,var(--primary,#0f766e),color-mix(in srgb,var(--primary,#0f766e) 62%,transparent));position:relative}.email-center-bar[data-failed]:after{content:"";position:absolute;left:0;right:0;bottom:0;height:var(--failed-height,0%);background:var(--red,#c84747);border-radius:3px}.email-center-bar-label{display:block;text-align:center;font-size:9px;color:var(--muted,#6c7d84);margin-top:6px}.email-sender-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.email-center-message{max-width:430px}.email-center-message strong,.email-center-message small{display:block}.email-center-message small{margin-top:4px;color:var(--muted,#6c7d84)}.email-center-failure{padding:12px;border:1px solid color-mix(in srgb,var(--red,#c84747) 25%,var(--border,#dbe5e8));background:var(--red-soft,#fde8e8);border-radius:12px;margin-bottom:10px}.email-center-failure strong,.email-center-failure small{display:block}.email-center-failure small{margin-top:4px}.email-center-draft{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:14px 16px;border:1px solid color-mix(in srgb,var(--primary,#0f766e) 30%,var(--border,#dbe5e8));background:var(--primary-soft,#dcf7f1);border-radius:14px;margin-bottom:16px}.email-center-draft p{margin:3px 0 0;color:var(--muted,#6c7d84)}
    @media(max-width:820px){.email-composer-backdrop{padding:0}.email-composer{height:100vh;max-height:none;border-radius:0}.email-composer-layout{grid-template-columns:1fr}.email-composer-side{border-left:0;border-top:1px solid var(--border,#dbe5e8)}}
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
    emailApi('/api/email/messages?limit=20'),
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
function readDraft() { try { return JSON.parse(localStorage.getItem(emailDraftKey()) || 'null'); } catch { return null; } }
function clearDraft() { localStorage.removeItem(emailDraftKey()); }
function formatBytes(value) { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }

function renderEmailHistory() {
  if (!emailUi.messages.length) return '<p class="email-domain-note">No emails have been sent from this workspace yet.</p>';
  return `<div class="email-history">${emailUi.messages.map((message, index) => `<article class="email-history-item"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${emailEscape(message.subject)}</strong><span class="email-status ${emailEscape(message.status)}">${emailEscape(message.status)}</span></div><small>${emailEscape(message.organization_name || '')}${message.contact_name ? ` · ${emailEscape(message.contact_name)}` : ''}</small><small>From ${emailEscape(message.from_email)} · ${new Date(message.sent_at || message.created_at).toLocaleString()}</small>${message.failure_reason ? `<small>${emailEscape(message.failure_reason)}</small>` : ''}<div class="email-history-actions"><button class="small-button" type="button" data-email-reuse="${index}">Use again</button></div></article>`).join('')}</div>`;
}

function renderSenderCards() {
  if (!emailUi.senders.length) return '<p class="email-domain-note">No active sender identity exists in this workspace.</p>';
  return emailUi.senders.map((item) => `<div class="email-sender-card" data-sender-id="${emailEscape(item.id)}"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${emailEscape(item.display_name)}</strong>${item.is_default ? '<span class="email-status">Default</span>' : ''}</div><small style="display:block">${emailEscape(item.email_address)}</small>${item.reply_to && item.reply_to !== item.email_address ? `<small style="display:block">Replies to ${emailEscape(item.reply_to)}</small>` : ''}${emailUi.permissions.can_manage ? `<div class="email-sender-actions"><button class="small-button" type="button" data-email-edit-sender="${emailEscape(item.id)}">Edit</button>${item.is_default ? '' : `<button class="small-button" type="button" data-email-default-sender="${emailEscape(item.id)}">Make default</button>`}<button class="small-button" type="button" data-email-disable-sender="${emailEscape(item.id)}">Deactivate</button></div>` : ''}</div>`).join('');
}

function updateAssociationSelectors(form, accountId, selectedContactId = '', selectedDealId = '') {
  form.elements.contact_id.innerHTML = emailOption(contactsForAccount(accountId), 'id', (item) => `${item.first_name} ${item.last_name}${item.email ? ` — ${item.email}` : ''}`, selectedContactId, 'Optional contact');
  form.elements.deal_id.innerHTML = emailOption(dealsForAccount(accountId), 'id', (item) => item.name, selectedDealId, 'Optional deal');
}

function serializeDraft(form, requestId) {
  const data = Object.fromEntries(new FormData(form).entries());
  delete data.attachments;
  return { ...data, client_request_id: requestId, saved_at: new Date().toISOString() };
}

function base64FromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function collectAttachments(input) {
  const files = [...(input?.files || [])];
  if (files.length > MAX_ATTACHMENTS) throw new Error(`Select no more than ${MAX_ATTACHMENTS} attachments.`);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_ATTACHMENT_BYTES) throw new Error('Attachments exceed the 4 MiB combined limit.');
  return Promise.all(files.map(async (file) => ({ content: base64FromBuffer(await file.arrayBuffer()), filename: file.name, type: file.type || 'application/octet-stream', disposition: 'attachment', size_bytes: file.size })));
}

async function openEmailComposer(defaults = {}) {
  composerStyles();
  try { await loadEmailReferences(); } catch (error) { emailToast('Unable to open email composer', error.message, 'error'); return; }
  const storedDraft = Object.keys(defaults).length ? null : readDraft();
  const merged = { ...(storedDraft || {}), ...defaults };
  let requestId = merged.client_request_id || createRequestId();
  const accountId = merged.organization_id || localStorage.getItem('pmg-account') || '';
  const contact = merged.contact_id ? selectedContact(merged.contact_id) : emailUi.contacts.find((item) => item.email?.toLowerCase() === String(merged.to || '').toLowerCase());
  const initialAccountId = contact?.organization_id || accountId;
  const sender = emailUi.senders.find((item) => item.id === merged.sender_identity_id) || emailUi.senders.find((item) => item.is_default) || emailUi.senders[0];
  const backdrop = document.createElement('div');
  backdrop.className = 'email-composer-backdrop';
  backdrop.innerHTML = `<section class="email-composer" role="dialog" aria-modal="true" aria-labelledby="emailComposerTitle">
    <header><div><p class="eyebrow">Secure business email</p><h2 id="emailComposerTitle">Compose email</h2><p>Send from an approved domain and preserve the complete relationship history in the correct CRM account.</p></div><button class="icon-button" data-email-close aria-label="Close">×</button></header>
    <div class="email-composer-layout"><main class="email-composer-main">${storedDraft ? `<div class="email-draft-note"><strong>Draft restored.</strong> Last saved ${new Date(storedDraft.saved_at).toLocaleString()}. Attachments must be selected again.</div>` : ''}<form id="emailComposerForm">
      <div class="form-grid three">
        ${emailField('From identity','sender_identity_id','select','',emailOption(emailUi.senders,'id',(item)=>`${item.display_name} <${item.email_address}>`,sender?.id,'Select sender'),false,true)}
        ${emailField('CRM account','organization_id','select','',emailOption(emailUi.organizations,'id',(item)=>item.name,initialAccountId,'Select account'),false,true)}
        ${emailField('CRM contact','contact_id','select','',emailOption(contactsForAccount(initialAccountId),'id',(item)=>`${item.first_name} ${item.last_name}${item.email ? ` — ${item.email}` : ''}`,contact?.id || merged.contact_id,'Optional contact'))}
        ${emailField('To','to','text',merged.to || contact?.email || '', '', true, true,'Separate multiple recipients with commas or semicolons.')}
        ${emailField('CC','cc','text',merged.cc || '', '', false, false,'Optional; comma or semicolon separated.')}
        ${emailField('BCC','bcc','text',merged.bcc || '', '', false, false,'Optional; comma or semicolon separated.')}
        ${emailField('Deal','deal_id','select','',emailOption(dealsForAccount(initialAccountId),'id',(item)=>item.name,merged.deal_id,'Optional deal'))}
        ${emailField('Subject','subject','text',merged.subject || '', '', true, true)}
        ${emailField('Plain-text message','text_body','textarea',merged.text_body || merged.body || '', '', true, false,'Enter plain text, HTML below, or both. Plain text improves accessibility and deliverability.')}
        <div class="field full"><label>Attachments</label><input name="attachments" type="file" multiple><small class="email-field-hint">Up to 10 files and 4 MiB combined. Files are not retained in browser drafts.</small><div class="email-attachments" data-email-attachments></div></div>
      </div>
      <details class="email-advanced" ${merged.html_body || merged.follow_up_due_at ? 'open' : ''}><summary>HTML and follow-up options</summary><div class="form-grid three">
        ${emailField('Optional HTML','html_body','textarea',merged.html_body || '', '', true)}
        ${emailField('Next step','next_step','text',merged.next_step || '', '', true)}
        ${emailField('Follow-up date','follow_up_due_at','datetime-local',merged.follow_up_due_at || '')}
        ${emailField('Follow-up priority','follow_up_priority','select','',`<option ${merged.follow_up_priority === 'medium' ? 'selected' : ''}>medium</option><option ${merged.follow_up_priority === 'high' ? 'selected' : ''}>high</option><option ${merged.follow_up_priority === 'urgent' ? 'selected' : ''}>urgent</option><option ${merged.follow_up_priority === 'low' ? 'selected' : ''}>low</option>`)}
      </div></details>
      <div class="form-actions"><button type="button" class="button secondary" data-email-discard>Discard draft</button><button type="button" class="button secondary" data-email-close>Close</button><button type="submit" class="button primary" ${sender ? '' : 'disabled'}>Send and log email</button></div>
    </form></main>
    <aside class="email-composer-side"><h3>Sender identities</h3><p class="email-domain-note">Approved domains: <strong>@goldendragoncapital.co</strong> and <strong>@devriessalesconsultancy.com</strong>. Each domain must show Ready in Cloudflare Email Sending.</p>
      <div class="email-sender-list" data-email-sender-list>${renderSenderCards()}</div>
      ${emailUi.permissions.can_manage ? '<button class="small-button" type="button" data-email-add-sender>＋ Add sender identity</button>' : ''}
      <form class="email-sender-form" data-email-sender-form hidden><input type="hidden" name="sender_id">
        ${emailField('Sender email','email_address','email','', '', true, true)}
        ${emailField('Display name','display_name','text','', '', true, true)}
        ${emailField('Reply-to','reply_to','email','', '', true)}
        <label style="display:flex;align-items:center;gap:8px;font-size:12px"><input type="checkbox" name="is_default" value="1"> Use as default for this workspace</label>
        <div class="email-sender-form-actions"><button class="small-button" type="button" data-email-sender-cancel>Cancel</button><button class="small-button" type="submit">Save identity</button></div>
      </form>
      <h3 style="margin-top:24px">Recent email</h3>${renderEmailHistory()}
    </aside></div></section>`;
  document.body.append(backdrop);

  const form = backdrop.querySelector('#emailComposerForm');
  const senderForm = backdrop.querySelector('[data-email-sender-form]');
  const accountSelect = form.elements.organization_id;
  const contactSelect = form.elements.contact_id;
  const attachmentInput = form.elements.attachments;
  let draftTimer;
  const saveDraft = () => { clearTimeout(draftTimer); draftTimer = setTimeout(() => localStorage.setItem(emailDraftKey(), JSON.stringify(serializeDraft(form, requestId))), 350); };
  form.addEventListener('input', saveDraft);
  form.addEventListener('change', saveDraft);
  accountSelect.addEventListener('change', () => updateAssociationSelectors(form, accountSelect.value));
  contactSelect.addEventListener('change', () => { const selected = selectedContact(contactSelect.value); if (!selected) return; accountSelect.value = selected.organization_id || accountSelect.value; updateAssociationSelectors(form, accountSelect.value, selected.id, form.elements.deal_id.value); form.elements.to.value = selected.email || form.elements.to.value; saveDraft(); });
  attachmentInput.addEventListener('change', () => { const files = [...attachmentInput.files]; backdrop.querySelector('[data-email-attachments]').innerHTML = files.map((file) => `<div class="email-attachment"><span>${emailEscape(file.name)}</span><strong>${formatBytes(file.size)}</strong></div>`).join(''); });

  const closeComposer = () => { clearTimeout(draftTimer); document.removeEventListener('keydown', escapeHandler); backdrop.remove(); };
  const escapeHandler = (event) => { if (event.key === 'Escape') closeComposer(); };
  document.addEventListener('keydown', escapeHandler);

  async function refreshSenderUi(preferredId = '') {
    emailUi.senders = await emailApi('/api/email/senders');
    backdrop.querySelector('[data-email-sender-list]').innerHTML = renderSenderCards();
    form.elements.sender_identity_id.innerHTML = emailOption(emailUi.senders,'id',(item)=>`${item.display_name} <${item.email_address}>`,preferredId || emailUi.senders.find((item)=>item.is_default)?.id,'Select sender');
    form.querySelector('[type=submit]').disabled = !emailUi.senders.length;
  }

  backdrop.addEventListener('click', async (event) => {
    if (event.target === backdrop || event.target.closest('[data-email-close]')) closeComposer();
    if (event.target.closest('[data-email-discard]')) { clearDraft(); closeComposer(); emailToast('Draft discarded'); }
    if (event.target.closest('[data-email-add-sender]')) { senderForm.reset(); senderForm.elements.sender_id.value = ''; senderForm.elements.email_address.disabled = false; senderForm.hidden = false; }
    if (event.target.closest('[data-email-sender-cancel]')) { senderForm.reset(); senderForm.hidden = true; }
    const editId = event.target.closest('[data-email-edit-sender]')?.dataset.emailEditSender;
    if (editId) { const senderToEdit = emailUi.senders.find((item)=>item.id===editId); senderForm.reset(); senderForm.elements.sender_id.value = editId; senderForm.elements.email_address.value = senderToEdit.email_address; senderForm.elements.email_address.disabled = true; senderForm.elements.display_name.value = senderToEdit.display_name; senderForm.elements.reply_to.value = senderToEdit.reply_to || ''; senderForm.elements.is_default.checked = senderToEdit.is_default; senderForm.hidden = false; }
    const defaultId = event.target.closest('[data-email-default-sender]')?.dataset.emailDefaultSender;
    if (defaultId) { await emailApi(`/api/email/senders/${defaultId}`, { method:'PATCH', body:{ is_default:true } }); await refreshSenderUi(defaultId); emailToast('Default sender updated'); }
    const disableId = event.target.closest('[data-email-disable-sender]')?.dataset.emailDisableSender;
    if (disableId && confirm('Deactivate this sender identity?')) { await emailApi(`/api/email/senders/${disableId}`, { method:'PATCH', body:{ is_active:false } }); await refreshSenderUi(); emailToast('Sender deactivated'); }
    const reuseIndex = event.target.closest('[data-email-reuse]')?.dataset.emailReuse;
    if (reuseIndex !== undefined) { const message = emailUi.messages[Number(reuseIndex)]; closeComposer(); await openEmailComposer({ organization_id:message.organization_id, contact_id:message.contact_id, deal_id:message.deal_id, sender_identity_id:message.sender_identity_id, to:(message.to||[]).join(', '), cc:(message.cc||[]).join(', '), bcc:(message.bcc||[]).join(', '), subject:message.subject, text_body:message.text_body, html_body:message.html_body }); }
  });

  senderForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = senderForm.querySelector('[type=submit]');
    button.disabled = true; button.textContent = 'Saving…';
    try {
      const data = Object.fromEntries(new FormData(senderForm).entries());
      const senderId = data.sender_id; delete data.sender_id;
      if (senderId) delete data.email_address;
      const saved = await emailApi(senderId ? `/api/email/senders/${senderId}` : '/api/email/senders', { method: senderId ? 'PATCH' : 'POST', body: data });
      await refreshSenderUi(saved.id);
      senderForm.reset(); senderForm.hidden = true;
      emailToast(senderId ? 'Sender updated' : 'Sender identity added', saved.email_address);
    } catch (error) { emailToast('Unable to save sender', error.message, 'error'); }
    finally { button.disabled = false; button.textContent = 'Save identity'; }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true; submit.textContent = 'Sending…';
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      delete data.attachments;
      data.attachments = await collectAttachments(attachmentInput);
      data.client_request_id = requestId;
      const selected = selectedContact(data.contact_id);
      const allRecipients = [...splitEmailAddresses(data.to), ...splitEmailAddresses(data.cc), ...splitEmailAddresses(data.bcc)];
      if (selected?.email && !allRecipients.includes(selected.email.toLowerCase())) throw new Error('The selected CRM contact must be one of the recipients.');
      if (!String(data.text_body || '').trim() && !String(data.html_body || '').trim()) throw new Error('Enter a plain-text or HTML email body.');
      const result = await emailApi('/api/email/send', { method: 'POST', headers: { 'idempotency-key': requestId }, body: data });
      clearDraft();
      emailToast(result.idempotent_replay ? 'Email already processed' : 'Email accepted and logged', result.idempotent_replay ? 'The original send record was returned; no duplicate email was created.' : `${result.organization_name || 'The account'} now has this email in its contact history.`);
      if (result.logging_warning) emailToast('Email accepted with a CRM warning', result.logging_warning, 'warning');
      closeComposer();
      window.dispatchEvent(new Event('hashchange'));
    } catch (error) {
      emailToast('Email was not sent', error.message, 'error');
      if (String(error.message).includes('already failed')) { requestId = createRequestId(); saveDraft(); emailToast('New retry prepared', 'Review the draft and click Send again to create a new delivery attempt.', 'warning'); }
      submit.disabled = false; submit.textContent = 'Send and log email';
    }
  });
  form.elements.subject?.focus();
}

function emailCenterMetric(label, value, caption, soft = 'var(--primary-soft)') {
  return `<article class="metric-card" style="--metric-soft:${soft}"><span class="metric-label">${emailEscape(label)}</span><strong class="metric-value">${emailEscape(value)}</strong><span class="metric-caption">${emailEscape(caption)}</span></article>`;
}

function emailCenterMessageRow(message, index) {
  const sentAt = message.sent_at || message.created_at;
  const recipientTotal = Number(message.recipient_count || (message.to || []).length + (message.cc || []).length + (message.bcc || []).length);
  return `<tr><td><div class="email-center-message"><strong>${emailEscape(message.subject || 'Untitled email')}</strong><small>${emailEscape((message.to || []).join(', ') || 'No recipient')}</small></div></td><td>${emailEscape(message.organization_name || '—')}${message.contact_name ? `<small style="display:block;color:var(--muted)">${emailEscape(message.contact_name)}</small>` : ''}</td><td><strong>${emailEscape(message.sender_display_name || message.from_name || '')}</strong><small style="display:block;color:var(--muted)">${emailEscape(message.from_email)}</small></td><td>${recipientTotal}</td><td><span class="email-status ${emailEscape(message.status)}">${emailEscape(message.status)}</span>${message.failure_reason ? `<small style="display:block;color:var(--red);margin-top:5px">${emailEscape(message.failure_reason)}</small>` : ''}</td><td>${sentAt ? new Date(sentAt).toLocaleString() : '—'}</td><td><button class="small-button" type="button" data-email-center-reuse="${index}">Use again</button></td></tr>`;
}

function emailCenterCsv(messages) {
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return ['subject,status,account,contact,from,to,cc,bcc,recipients,sent_at,failure_reason', ...messages.map((message) => [message.subject,message.status,message.organization_name,message.contact_name,message.from_email,(message.to||[]).join('; '),(message.cc||[]).join('; '),(message.bcc||[]).join('; '),message.recipient_count,message.sent_at||message.created_at,message.failure_reason].map(quote).join(','))].join('\n');
}

function downloadEmailCenterCsv(messages) {
  const blob = new Blob([emailCenterCsv(messages)], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `pmg-email-history-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function loadEmailCenterData() {
  const filters = emailUi.centerFilters;
  const params = new URLSearchParams({ limit: '250' });
  const account = localStorage.getItem('pmg-account') || '';
  if (account) params.set('account', account);
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.sender) params.set('sender', filters.sender);
  const [overview, health, senders, messages, organizations] = await Promise.all([
    emailApi(`/api/email/overview?days=${encodeURIComponent(filters.days || '30')}${account ? `&account=${encodeURIComponent(account)}` : ''}`),
    emailApi('/api/email/health'),
    emailApi('/api/email/senders'),
    emailApi(`/api/email/messages?${params}`),
    emailApi('/api/organizations'),
  ]);
  emailUi.overview = overview;
  emailUi.health = health;
  emailUi.senders = senders;
  emailUi.messages = messages;
  emailUi.organizations = organizations;
}

async function renderEmailCenter(root = document.querySelector('#content')) {
  composerStyles();
  root.innerHTML = '<div class="loading-state"><span class="spinner"></span><span>Loading Email Center…</span></div>';
  try { await loadEmailCenterData(); } catch (error) {
    root.innerHTML = `<div class="empty-state"><strong>Unable to load Email Center</strong><span>${emailEscape(error.message)}</span><div style="margin-top:12px"><button class="button secondary" data-email-center-refresh>Try again</button></div></div>`;
    root.querySelector('[data-email-center-refresh]')?.addEventListener('click', () => renderEmailCenter(root));
    return;
  }
  const overview = emailUi.overview || { totals:{}, senders:[], daily:[], failures:[] };
  const totals = overview.totals || {};
  const draft = readDraft();
  const accountId = localStorage.getItem('pmg-account') || '';
  const accountName = emailUi.organizations.find((item) => item.id === accountId)?.name;
  const health = emailUi.health || {};
  const days = Number(overview.window_days || emailUi.centerFilters.days || 30);
  const daily = overview.daily || [];
  const maxVolume = Math.max(1, ...daily.map((item) => Number(item.total || 0)));
  const failures = overview.failures || [];
  const failureBadge = document.querySelector('#emailFailureCount');
  if (failureBadge) failureBadge.textContent = Number(totals.failed || 0) || '';
  root.innerHTML = `
    <header class="page-header"><div><p class="eyebrow">Outbound relationship operations</p><h1>Email Center</h1><p>Compose, monitor and reuse account-linked business email across all approved domains.${accountName ? ` Focused on ${emailEscape(accountName)}.` : ''}</p></div><div class="page-actions"><button class="button secondary" type="button" data-email-center-export>Export CSV</button><button class="button secondary" type="button" data-email-center-refresh>Refresh</button><button class="button primary" type="button" data-compose-email>✉ Compose email</button></div></header>
    ${draft ? `<section class="email-center-draft"><div><strong>Recoverable draft available</strong><p>Last saved ${new Date(draft.saved_at).toLocaleString()} · Attachments must be selected again.</p></div><button class="button primary" type="button" data-compose-email>Continue draft</button></section>` : ''}
    <section class="metrics-grid">
      ${emailCenterMetric('Sent', totals.sent || 0, `Last ${days} days`, 'var(--green-soft)')}
      ${emailCenterMetric('Delivery rate', `${totals.delivery_rate || 0}%`, `${totals.failed || 0} failed`, 'var(--primary-soft)')}
      ${emailCenterMetric('Recipients', totals.recipients || 0, 'Across To, CC and BCC', 'var(--blue-soft)')}
      ${emailCenterMetric('Queued', totals.queued || 0, 'Awaiting final status', 'var(--amber-soft)')}
      ${emailCenterMetric('Attachments', totals.with_attachments || 0, 'Messages with files', 'var(--purple-soft)')}
    </section>
    <section class="layout-grid">
      <article class="panel"><header class="panel-header"><div><h2>Delivery volume</h2><p>Sent and failed messages during the selected window</p></div><select id="emailCenterDays" aria-label="Email overview period"><option value="14" ${days===14?'selected':''}>14 days</option><option value="30" ${days===30?'selected':''}>30 days</option><option value="90" ${days===90?'selected':''}>90 days</option></select></header><div class="panel-body"><div class="email-center-chart">${daily.length ? daily.map((item) => { const total=Number(item.total||0); const failed=Number(item.failed||0); const height=Math.max(4,total/maxVolume*100); const failedHeight=total?failed/total*100:0; return `<div><div class="email-center-bar" data-failed style="height:${height}%;--failed-height:${failedHeight}%" title="${emailEscape(item.day)}: ${total} total, ${failed} failed"></div><small class="email-center-bar-label">${new Date(item.day+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</small></div>`; }).join('') : '<div class="empty-state" style="grid-column:1/-1"><strong>No email activity yet</strong><span>New sends will appear here.</span></div>'}</div></div></article>
      <article class="panel"><header class="panel-header"><div><h2>Delivery service</h2><p>Private Worker and Cloudflare provider readiness</p></div></header><div class="panel-body"><div class="email-center-health"><i class="email-health-dot ${health.ok ? 'ok' : ''}"></i><div><strong>${health.ok ? 'Operational' : 'Attention required'}</strong><small style="display:block;color:var(--muted);margin-top:4px">${health.ok ? 'CRM service binding and Email Sending provider are responding.' : emailEscape(health.error || 'Email service health could not be confirmed.')}</small></div></div><div class="detail-grid" style="margin-top:18px"><div class="detail-field"><span>Private Worker</span><strong>${health.service_binding ? 'Connected' : 'Missing'}</strong></div><div class="detail-field"><span>Provider binding</span><strong>${health.provider_binding ? 'Configured' : 'Not confirmed'}</strong></div><div class="detail-field"><span>Active identities</span><strong>${emailUi.senders.length}</strong></div><div class="detail-field"><span>Checked</span><strong>${health.checked_at ? new Date(health.checked_at).toLocaleString() : '—'}</strong></div></div></div></article>
    </section>
    <section class="panel" style="margin-bottom:16px"><header class="panel-header"><div><h2>Sender performance</h2><p>Approved identities and delivery outcomes</p></div></header><div class="panel-body"><div class="email-sender-grid">${(overview.senders||[]).map((sender)=>`<article class="email-sender-card"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${emailEscape(sender.display_name)}</strong>${sender.is_default?'<span class="email-status">Default</span>':''}</div><small style="display:block;margin-top:4px">${emailEscape(sender.email_address)}</small><div class="detail-grid" style="margin-top:12px"><div class="detail-field"><span>Sent</span><strong>${Number(sender.sent||0)}</strong></div><div class="detail-field"><span>Failed</span><strong>${Number(sender.failed||0)}</strong></div></div></article>`).join('') || '<div class="empty-state"><strong>No sender identities</strong><span>Add an approved sender from the composer.</span></div>'}</div></div></section>
    <section class="layout-grid">
      <article class="panel"><header class="panel-header"><div><h2>Email history</h2><p>Searchable, account-linked delivery ledger</p></div></header><div class="toolbar"><input class="search-input" id="emailCenterSearch" value="${emailEscape(emailUi.centerFilters.q)}" placeholder="Search subject, sender, account or contact…"><select id="emailCenterStatus"><option value="">All statuses</option>${['sent','failed','queued'].map((status)=>`<option value="${status}" ${emailUi.centerFilters.status===status?'selected':''}>${status[0].toUpperCase()+status.slice(1)}</option>`).join('')}</select><select id="emailCenterSender">${emailOption(emailUi.senders,'id',(item)=>item.display_name,emailUi.centerFilters.sender,'All senders')}</select></div><div class="table-wrap"><table><thead><tr><th>Message</th><th>CRM account</th><th>Sender</th><th>Recipients</th><th>Status</th><th>Sent / attempted</th><th></th></tr></thead><tbody>${emailUi.messages.length ? emailUi.messages.map(emailCenterMessageRow).join('') : `<tr><td colspan="7"><div class="empty-state"><strong>No matching email</strong><span>Change the filters or compose a new message.</span></div></td></tr>`}</tbody></table></div></article>
      <article class="panel"><header class="panel-header"><div><h2>Failure diagnostics</h2><p>Most recent messages requiring attention</p></div></header><div class="panel-body">${failures.length ? failures.map((message)=>`<article class="email-center-failure"><strong>${emailEscape(message.subject)}</strong><small>${emailEscape(message.organization_name||'Unknown account')} · ${new Date(message.created_at).toLocaleString()}</small><small>${emailEscape(message.failure_reason||message.failure_code||'Delivery failed')}</small></article>`).join('') : '<div class="empty-state"><strong>No recent failures</strong><span>The delivery queue is healthy.</span></div>'}</div></article>
    </section>`;

  let searchTimer;
  root.querySelector('#emailCenterSearch')?.addEventListener('input', (event) => { clearTimeout(searchTimer); searchTimer=setTimeout(()=>{emailUi.centerFilters.q=event.target.value.trim();renderEmailCenter(root);},300); });
  root.querySelector('#emailCenterStatus')?.addEventListener('change', (event) => { emailUi.centerFilters.status=event.target.value;renderEmailCenter(root); });
  root.querySelector('#emailCenterSender')?.addEventListener('change', (event) => { emailUi.centerFilters.sender=event.target.value;renderEmailCenter(root); });
  root.querySelector('#emailCenterDays')?.addEventListener('change', (event) => { emailUi.centerFilters.days=event.target.value;renderEmailCenter(root); });
  root.querySelectorAll('[data-email-center-refresh]').forEach((button)=>button.addEventListener('click',()=>renderEmailCenter(root)));
  root.querySelector('[data-email-center-export]')?.addEventListener('click',()=>downloadEmailCenterCsv(emailUi.messages));
  root.querySelectorAll('[data-email-center-reuse]').forEach((button)=>button.addEventListener('click',()=>{const message=emailUi.messages[Number(button.dataset.emailCenterReuse)];openEmailComposer({ organization_id:message.organization_id, contact_id:message.contact_id, deal_id:message.deal_id, sender_identity_id:message.sender_identity_id, to:(message.to||[]).join(', '), cc:(message.cc||[]).join(', '), bcc:(message.bcc||[]).join(', '), subject:message.subject, text_body:message.text_body, html_body:message.html_body });}));
}

function mailtoDefaults(link) {
  const url = new URL(link.href);
  return { to: decodeURIComponent(url.pathname), cc: url.searchParams.get('cc') || '', bcc: url.searchParams.get('bcc') || '', subject: url.searchParams.get('subject') || '', text_body: url.searchParams.get('body') || '' };
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
    if (mailto) { event.preventDefault(); openEmailComposer(mailtoDefaults(mailto)); }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installEmailComposer);
else installEmailComposer();

export { openEmailComposer, renderEmailCenter };
