import { parseJson } from './lib/domain.js';
import {
  attachmentMetadata,
  isAllowedSender,
  normalizeAttachments,
  normalizeClientRequestId,
  normalizeEmailList,
  parseAllowedDomains,
  plainTextFromHtml,
  recipientCount,
  validateEmailAddress,
} from './lib/email.js';

function id() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function text(value, fallback = null) { const result = String(value ?? '').trim(); return result || fallback; }
function bool(value) { return value === true || value === 1 || value === '1' ? 1 : 0; }

async function bodyJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw Object.assign(new Error('Expected application/json'), { status: 415 });
  return request.json();
}

function role(ctx) { return ctx.workspace?.member_role || ctx.user?.role || 'viewer'; }
function requireWrite(ctx) {
  if (!['admin', 'manager', 'member'].includes(role(ctx)) && ctx.user?.role !== 'admin') throw Object.assign(new Error('Insufficient permissions'), { status: 403 });
}
function requireManage(ctx) {
  if (!['admin', 'manager'].includes(role(ctx)) && ctx.user?.role !== 'admin') throw Object.assign(new Error('Insufficient permissions'), { status: 403 });
}

async function audit(env, ctx, request, action, entityType, entityId, after = null) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  let ipHash = null;
  if (ip) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    ipHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }
  await env.DB.prepare(`INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,after_json,ip_hash,workspace_id)
    VALUES (?,?,?,?,?,?,?,?)`).bind(id(), ctx.user.id, action, entityType, entityId, after ? JSON.stringify(after) : null, ipHash, ctx.workspace.id).run();
}

function senderRecord(row) {
  return row ? { ...row, is_default: Boolean(row.is_default), is_active: Boolean(row.is_active) } : null;
}
function messageRecord(row) {
  return row ? {
    ...row,
    to: parseJson(row.to_json, []),
    cc: parseJson(row.cc_json, []),
    bcc: parseJson(row.bcc_json, []),
    attachments: parseJson(row.attachments_json, []),
  } : null;
}
function contactLabel(contact) { return text(`${contact?.first_name || ''} ${contact?.last_name || ''}`, contact?.email || 'Contact'); }
function contactBlocksEmail(contact) { return Boolean(contact?.email_opt_out) || contact?.status === 'do_not_contact' || contact?.consent_status === 'withdrawn'; }

const EMAIL_MESSAGE_SELECT = `SELECT m.*,s.display_name sender_display_name,c.first_name||' '||c.last_name contact_name,
  o.name organization_name,d.name deal_name,u.name user_name
  FROM email_messages m
  LEFT JOIN email_sender_identities s ON s.id=m.sender_identity_id
  LEFT JOIN contacts c ON c.id=m.contact_id
  LEFT JOIN organizations o ON o.id=m.organization_id
  LEFT JOIN deals d ON d.id=m.deal_id
  LEFT JOIN users u ON u.id=m.user_id`;

async function getMessageByRequestId(env, workspaceId, clientRequestId) {
  if (!clientRequestId) return null;
  return env.DB.prepare(`${EMAIL_MESSAGE_SELECT} WHERE m.workspace_id=? AND m.client_request_id=? LIMIT 1`).bind(workspaceId, clientRequestId).first();
}
async function getMessageById(env, workspaceId, emailId) {
  return env.DB.prepare(`${EMAIL_MESSAGE_SELECT} WHERE m.workspace_id=? AND m.id=? LIMIT 1`).bind(workspaceId, emailId).first();
}
function replayResult(row) {
  if (!row) return null;
  if (row.status === 'failed') throw Object.assign(new Error('This send request already failed. Duplicate the draft before retrying so a new request ID is used.'), { status: 409, code: 'E_IDEMPOTENCY_FAILED' });
  return { ...messageRecord(row), idempotent_replay: true };
}

export async function listEmailSenders(env, ctx) {
  const rows = await env.DB.prepare(`SELECT * FROM email_sender_identities
    WHERE workspace_id=? AND is_active=1 ORDER BY is_default DESC, display_name, email_address`).bind(ctx.workspace.id).all();
  return (rows.results || []).map(senderRecord);
}

export async function createEmailSender(env, ctx, request) {
  requireManage(ctx);
  const data = await bodyJson(request);
  const emailAddress = String(data.email_address || '').trim().toLowerCase();
  const allowedDomains = parseAllowedDomains(env.EMAIL_ALLOWED_DOMAINS);
  if (!isAllowedSender(emailAddress, allowedDomains)) throw new Error(`Sender must use ${allowedDomains.join(', ')}`);
  if (!text(data.display_name)) throw new Error('Display name is required');
  const replyTo = text(data.reply_to, emailAddress).toLowerCase();
  if (!validateEmailAddress(replyTo)) throw new Error('Reply-to address is invalid');
  const senderId = id();
  if (bool(data.is_default)) await env.DB.prepare('UPDATE email_sender_identities SET is_default=0,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=?').bind(ctx.workspace.id).run();
  await env.DB.prepare(`INSERT INTO email_sender_identities
    (id,workspace_id,email_address,display_name,reply_to,domain,is_default,is_active,created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(senderId, ctx.workspace.id, emailAddress, text(data.display_name), replyTo, emailAddress.split('@').at(-1), bool(data.is_default), 1, ctx.user.id).run();
  const created = await env.DB.prepare('SELECT * FROM email_sender_identities WHERE id=?').bind(senderId).first();
  await audit(env, ctx, request, 'create', 'email_sender_identity', senderId, created);
  return senderRecord(created);
}

export async function updateEmailSender(env, ctx, request, senderId) {
  requireManage(ctx);
  const before = await env.DB.prepare('SELECT * FROM email_sender_identities WHERE id=? AND workspace_id=?').bind(senderId, ctx.workspace.id).first();
  if (!before) throw Object.assign(new Error('Sender identity not found'), { status: 404 });
  const data = await bodyJson(request);
  const sets = []; const values = [];
  if (Object.hasOwn(data, 'display_name')) {
    if (!text(data.display_name)) throw new Error('Display name is required');
    sets.push('display_name=?'); values.push(text(data.display_name));
  }
  if (Object.hasOwn(data, 'reply_to')) {
    const replyTo = text(data.reply_to);
    if (replyTo && !validateEmailAddress(replyTo)) throw new Error('Reply-to address is invalid');
    sets.push('reply_to=?'); values.push(replyTo?.toLowerCase() || null);
  }
  if (Object.hasOwn(data, 'is_active')) { sets.push('is_active=?'); values.push(bool(data.is_active)); }
  if (Object.hasOwn(data, 'is_default') && bool(data.is_default)) {
    await env.DB.prepare('UPDATE email_sender_identities SET is_default=0,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=?').bind(ctx.workspace.id).run();
    sets.push('is_default=1');
  }
  if (!sets.length) return senderRecord(before);
  sets.push('updated_at=CURRENT_TIMESTAMP');
  await env.DB.prepare(`UPDATE email_sender_identities SET ${sets.join(',')} WHERE id=? AND workspace_id=?`).bind(...values, senderId, ctx.workspace.id).run();
  const after = await env.DB.prepare('SELECT * FROM email_sender_identities WHERE id=?').bind(senderId).first();
  await audit(env, ctx, request, 'update', 'email_sender_identity', senderId, after);
  return senderRecord(after);
}

export async function listEmailMessages(env, ctx, request) {
  const url = new URL(request.url);
  const conditions = ['m.workspace_id=?']; const bindings = [ctx.workspace.id];
  for (const [param, column] of [['account', 'm.organization_id'], ['contact', 'm.contact_id'], ['status', 'm.status'], ['sender', 'm.sender_identity_id']]) {
    const value = text(url.searchParams.get(param));
    if (value) { conditions.push(`${column}=?`); bindings.push(value); }
  }
  const q = text(url.searchParams.get('q'));
  if (q) {
    const match = `%${q.toLowerCase()}%`;
    conditions.push('(lower(m.subject) LIKE ? OR lower(m.to_json) LIKE ? OR lower(o.name) LIKE ? OR lower(c.first_name||\' \'||c.last_name) LIKE ?)');
    bindings.push(match, match, match, match);
  }
  const limit = Math.max(1, Math.min(250, Number(url.searchParams.get('limit') || 100)));
  const rows = await env.DB.prepare(`${EMAIL_MESSAGE_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY m.created_at DESC LIMIT ?`).bind(...bindings, limit).all();
  return (rows.results || []).map(messageRecord);
}

async function contactsForRecipients(env, ctx, addresses) {
  if (!addresses.length) return [];
  const placeholders = addresses.map(() => '?').join(',');
  const rows = await env.DB.prepare(`SELECT * FROM contacts WHERE workspace_id=? AND lower(email) IN (${placeholders})`).bind(ctx.workspace.id, ...addresses.map((address) => address.toLowerCase())).all();
  return rows.results || [];
}

async function resolveAssociation(env, ctx, data, recipients) {
  const addresses = [...new Set([...recipients.to, ...recipients.cc, ...recipients.bcc].map((address) => address.toLowerCase()))];
  let selectedContact = null;
  if (text(data.contact_id)) selectedContact = await env.DB.prepare('SELECT * FROM contacts WHERE id=? AND workspace_id=?').bind(data.contact_id, ctx.workspace.id).first();
  if (text(data.contact_id) && !selectedContact) throw Object.assign(new Error('Contact not found'), { status: 404 });
  if (selectedContact) {
    if (!selectedContact.email) throw new Error('The selected contact has no email address');
    if (!addresses.includes(selectedContact.email.toLowerCase())) throw new Error('The selected contact must be one of the email recipients');
  }

  const recipientContacts = await contactsForRecipients(env, ctx, addresses);
  if (selectedContact && !recipientContacts.some((contact) => contact.id === selectedContact.id)) recipientContacts.unshift(selectedContact);
  const organizationId = text(data.organization_id, selectedContact?.organization_id || recipientContacts[0]?.organization_id);
  if (!organizationId) throw new Error('Select the account this email belongs to');
  const organization = await env.DB.prepare('SELECT * FROM organizations WHERE id=? AND workspace_id=?').bind(organizationId, ctx.workspace.id).first();
  if (!organization) throw Object.assign(new Error('Account not found'), { status: 404 });

  const mismatched = recipientContacts.find((contact) => contact.organization_id && contact.organization_id !== organization.id);
  if (mismatched) throw new Error(`${contactLabel(mismatched)} belongs to a different CRM account`);
  const optedOut = recipientContacts.find(contactBlocksEmail);
  if (optedOut) throw Object.assign(new Error(`${contactLabel(optedOut)} has opted out of email communication`), { status: 409 });

  let deal = null;
  if (text(data.deal_id)) {
    deal = await env.DB.prepare('SELECT * FROM deals WHERE id=? AND workspace_id=?').bind(data.deal_id, ctx.workspace.id).first();
    if (!deal) throw Object.assign(new Error('Deal not found'), { status: 404 });
    if (deal.organization_id && deal.organization_id !== organization.id) throw new Error('The selected deal belongs to a different account');
  }
  return { contact: selectedContact || recipientContacts[0] || null, organization, recipientContacts, deal };
}

function activityMetadata(emailId, sender, recipients, status, extras = {}) {
  return {
    email_message_id: emailId,
    status,
    from: sender.email_address,
    from_name: sender.display_name,
    reply_to: sender.reply_to,
    to: recipients.to,
    cc: recipients.cc,
    bcc: recipients.bcc,
    ...extras,
  };
}

async function createQueuedEmailActivity(env, ctx, data, association, emailId, sender, recipients, createdAt, attachments, clientRequestId) {
  const activityId = id();
  const body = text(data.text_body, plainTextFromHtml(data.html_body));
  const metadata = activityMetadata(emailId, sender, recipients, 'queued', {
    html_body: text(data.html_body),
    attachments: attachmentMetadata(attachments),
    client_request_id: clientRequestId,
  });
  await env.DB.prepare(`INSERT INTO activities
    (id,workspace_id,contact_id,organization_id,user_id,type,direction,subject,body,outcome,occurred_at,metadata_json,deal_id,next_step)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      activityId, ctx.workspace.id, association.contact?.id || null, association.organization.id, ctx.user.id, 'email', 'outbound', text(data.subject), body, 'Queued', createdAt, JSON.stringify(metadata), association.deal?.id || null, text(data.next_step)
    ).run();
  return activityId;
}

async function createFollowUpFromEmail(env, ctx, data, association) {
  const dueAt = text(data.follow_up_due_at);
  if (!dueAt) return null;
  const followUpId = id();
  await env.DB.prepare(`INSERT INTO follow_ups
    (id,workspace_id,contact_id,organization_id,deal_id,owner_id,title,channel,status,priority,due_at,cadence,notes,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      followUpId, ctx.workspace.id, association.contact?.id || null, association.organization.id, association.deal?.id || null, ctx.user.id,
      text(data.follow_up_title, `Follow up: ${data.subject}`), 'email', 'open', text(data.follow_up_priority, 'medium'), dueAt, text(data.follow_up_cadence, 'none'), text(data.next_step), ctx.user.id
    ).run();
  return followUpId;
}

async function markDeliveryFailed(env, ctx, request, emailId, activityId, sender, recipients, attachments, clientRequestId, error) {
  const failureCode = text(error.code, 'E_EMAIL_DELIVERY_FAILED');
  const failureReason = text(error.message, 'Email delivery failed');
  const metadata = activityMetadata(emailId, sender, recipients, 'failed', {
    failure_code: failureCode,
    failure_reason: failureReason,
    attachments: attachmentMetadata(attachments),
    client_request_id: clientRequestId,
  });
  try {
    await env.DB.batch([
      env.DB.prepare(`UPDATE email_messages SET status='failed',failure_code=?,failure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?`).bind(failureCode, failureReason, emailId, ctx.workspace.id),
      env.DB.prepare(`UPDATE activities SET outcome='Failed',metadata_json=? WHERE id=? AND workspace_id=?`).bind(JSON.stringify(metadata), activityId, ctx.workspace.id),
    ]);
  } catch (loggingError) { console.error('Unable to record email delivery failure', loggingError); }
  try { await audit(env, ctx, request, 'send_failed', 'email_message', emailId, { code: failureCode, message: failureReason }); } catch (auditError) { console.error('Unable to audit email delivery failure', auditError); }
}

function emailOverviewDays(request) {
  const raw = Number(new URL(request.url).searchParams.get('days') || 30);
  return Math.max(7, Math.min(365, Number.isFinite(raw) ? Math.trunc(raw) : 30));
}

export async function getEmailOverview(env, ctx, request) {
  const url = new URL(request.url);
  const days = emailOverviewDays(request);
  const modifier = `-${days} days`;
  const accountId = text(url.searchParams.get('account'));
  const accountFilter = accountId ? ' AND organization_id=?' : '';
  const aliasedAccountFilter = accountId ? ' AND m.organization_id=?' : '';
  const accountBindings = accountId ? [accountId] : [];
  const [totals, senders, daily, failures] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
      SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) queued,
      COALESCE(SUM(recipient_count),0) recipients,
      SUM(CASE WHEN attachments_json IS NOT NULL AND attachments_json!='[]' THEN 1 ELSE 0 END) with_attachments
      FROM email_messages WHERE workspace_id=?${accountFilter} AND created_at>=datetime('now',?)`).bind(ctx.workspace.id, ...accountBindings, modifier).first(),
    env.DB.prepare(`SELECT s.id,s.display_name,s.email_address,s.domain,s.is_default,
      COUNT(m.id) total,
      SUM(CASE WHEN m.status='sent' THEN 1 ELSE 0 END) sent,
      SUM(CASE WHEN m.status='failed' THEN 1 ELSE 0 END) failed
      FROM email_sender_identities s
      LEFT JOIN email_messages m ON m.sender_identity_id=s.id AND m.workspace_id=s.workspace_id AND m.created_at>=datetime('now',?)${aliasedAccountFilter}
      WHERE s.workspace_id=? AND s.is_active=1
      GROUP BY s.id,s.display_name,s.email_address,s.domain,s.is_default
      ORDER BY s.is_default DESC,total DESC,s.display_name`).bind(modifier, ...accountBindings, ctx.workspace.id).all(),
    env.DB.prepare(`SELECT date(created_at) day,COUNT(*) total,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed
      FROM email_messages WHERE workspace_id=?${accountFilter} AND created_at>=date('now',?)
      GROUP BY date(created_at) ORDER BY day`).bind(ctx.workspace.id, ...accountBindings, modifier).all(),
    env.DB.prepare(`SELECT m.*,s.display_name sender_display_name,c.first_name||' '||c.last_name contact_name,o.name organization_name
      FROM email_messages m
      LEFT JOIN email_sender_identities s ON s.id=m.sender_identity_id
      LEFT JOIN contacts c ON c.id=m.contact_id
      LEFT JOIN organizations o ON o.id=m.organization_id
      WHERE m.workspace_id=?${aliasedAccountFilter} AND m.status='failed'
      ORDER BY m.created_at DESC LIMIT 8`).bind(ctx.workspace.id, ...accountBindings).all(),
  ]);
  const total = Number(totals?.total || 0);
  const sent = Number(totals?.sent || 0);
  const failed = Number(totals?.failed || 0);
  return {
    window_days: days,
    account_id: accountId,
    totals: {
      total,
      sent,
      failed,
      queued: Number(totals?.queued || 0),
      recipients: Number(totals?.recipients || 0),
      with_attachments: Number(totals?.with_attachments || 0),
      delivery_rate: total ? Math.round((sent / total) * 1000) / 10 : 0,
      failure_rate: total ? Math.round((failed / total) * 1000) / 10 : 0,
    },
    senders: (senders.results || []).map(senderRecord),
    daily: daily.results || [],
    failures: (failures.results || []).map(messageRecord),
  };
}

export async function getEmailHealth(env, ctx, request) {
  const checkedAt = nowIso();
  if (!env.EMAIL_SERVICE) return { ok: false, service_binding: false, provider_binding: false, checked_at: checkedAt, error: 'EMAIL_SERVICE binding is not configured' };
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  try {
    const response = await env.EMAIL_SERVICE.fetch('https://email.internal/health', { headers: { 'x-request-id': requestId } });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok && payload.ok === true,
      service_binding: true,
      provider_binding: payload.binding === 'configured',
      service: payload.service || 'partnermarket-global-email-worker',
      checked_at: payload.timestamp || checkedAt,
      request_id: requestId,
      error: response.ok ? null : (payload.error || 'Email Worker health check failed'),
    };
  } catch (error) {
    return { ok: false, service_binding: true, provider_binding: false, checked_at: checkedAt, request_id: requestId, error: text(error.message, 'Email Worker health check failed') };
  }
}

export async function sendCrmEmail(env, ctx, request) {
  requireWrite(ctx);
  if (!env.EMAIL_SERVICE) throw Object.assign(new Error('The private Email Worker service binding is not configured'), { status: 503 });
  const data = await bodyJson(request);
  const clientRequestId = normalizeClientRequestId(request.headers.get('idempotency-key') || data.client_request_id || crypto.randomUUID());
  const previous = await getMessageByRequestId(env, ctx.workspace.id, clientRequestId);
  if (previous) return replayResult(previous);

  const attachments = normalizeAttachments(data.attachments);
  const recipients = {
    to: normalizeEmailList(data.to),
    cc: normalizeEmailList(data.cc),
    bcc: normalizeEmailList(data.bcc),
  };
  if (!recipients.to.length) throw new Error('At least one recipient is required');
  if ([...recipients.to, ...recipients.cc, ...recipients.bcc].some((address) => !validateEmailAddress(address))) throw new Error('One or more email addresses are invalid');
  if (recipientCount(recipients) > 50) throw new Error('A maximum of 50 total recipients is supported');
  if (!text(data.subject)) throw new Error('Subject is required');
  if (!text(data.text_body) && !text(data.html_body)) throw new Error('Email body is required');

  const sender = await env.DB.prepare('SELECT * FROM email_sender_identities WHERE id=? AND workspace_id=? AND is_active=1').bind(data.sender_identity_id, ctx.workspace.id).first();
  if (!sender) throw new Error('Select an active sender identity');
  const allowedDomains = parseAllowedDomains(env.EMAIL_ALLOWED_DOMAINS);
  if (!isAllowedSender(sender.email_address, allowedDomains)) throw new Error('The selected sender domain is not allowed');

  const association = await resolveAssociation(env, ctx, data, recipients);
  const emailId = id();
  const createdAt = nowIso();
  try {
    await env.DB.prepare(`INSERT INTO email_messages
      (id,workspace_id,sender_identity_id,contact_id,organization_id,deal_id,user_id,from_email,from_name,reply_to,to_json,cc_json,bcc_json,subject,text_body,html_body,status,client_request_id,attachments_json,recipient_count,delivery_attempts,last_attempt_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        emailId, ctx.workspace.id, sender.id, association.contact?.id || null, association.organization.id, association.deal?.id || null, ctx.user.id,
        sender.email_address, sender.display_name, sender.reply_to, JSON.stringify(recipients.to), JSON.stringify(recipients.cc), JSON.stringify(recipients.bcc),
        text(data.subject), text(data.text_body), text(data.html_body), 'queued', clientRequestId, JSON.stringify(attachmentMetadata(attachments)), recipientCount(recipients), 1, createdAt, createdAt, createdAt
      ).run();
  } catch (error) {
    const raced = await getMessageByRequestId(env, ctx.workspace.id, clientRequestId);
    if (raced) return replayResult(raced);
    throw error;
  }

  let activityId;
  try {
    activityId = await createQueuedEmailActivity(env, ctx, data, association, emailId, sender, recipients, createdAt, attachments, clientRequestId);
    await env.DB.prepare('UPDATE email_messages SET activity_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(activityId, emailId, ctx.workspace.id).run();
  } catch (error) {
    try { await env.DB.prepare(`UPDATE email_messages SET status='failed',failure_code='E_CRM_PRELOG_FAILED',failure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?`).bind(text(error.message, 'Unable to create CRM activity'), emailId, ctx.workspace.id).run(); } catch { /* original error is more useful */ }
    throw Object.assign(new Error('Email was not sent because the CRM activity could not be created'), { status: 500, cause: error });
  }

  let delivery;
  try {
    const response = await env.EMAIL_SERVICE.fetch('https://email.internal/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': clientRequestId },
      body: JSON.stringify({
        emailId,
        workspaceId: ctx.workspace.id,
        organizationId: association.organization.id,
        from: sender.email_address,
        fromName: sender.display_name,
        replyTo: sender.reply_to,
        replyToName: sender.display_name,
        to: recipients.to,
        cc: recipients.cc,
        bcc: recipients.bcc,
        subject: text(data.subject),
        text: text(data.text_body, plainTextFromHtml(data.html_body)),
        html: text(data.html_body),
        attachments,
        clientRequestId,
      }),
    });
    delivery = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(delivery.error || 'Email delivery failed'), { code: delivery.code || 'E_EMAIL_DELIVERY_FAILED', status: response.status });
  } catch (error) {
    await markDeliveryFailed(env, ctx, request, emailId, activityId, sender, recipients, attachments, clientRequestId, error);
    throw Object.assign(error, { status: error.status || 502 });
  }

  const sentAt = nowIso();
  const sentMetadata = activityMetadata(emailId, sender, recipients, 'sent', {
    provider_message_id: delivery.messageId,
    html_body: text(data.html_body),
    attachments: attachmentMetadata(attachments),
    client_request_id: clientRequestId,
  });
  let loggingWarning = null;
  try {
    const statements = [
      env.DB.prepare(`UPDATE email_messages SET status='sent',provider_message_id=?,sent_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?`).bind(delivery.messageId, sentAt, emailId, ctx.workspace.id),
      env.DB.prepare(`UPDATE activities SET outcome='Sent',occurred_at=?,metadata_json=? WHERE id=? AND workspace_id=?`).bind(sentAt, JSON.stringify(sentMetadata), activityId, ctx.workspace.id),
      env.DB.prepare('UPDATE organizations SET last_contact_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(sentAt, association.organization.id, ctx.workspace.id),
    ];
    if (association.contact) statements.push(env.DB.prepare('UPDATE contacts SET last_contact_at=?,next_follow_up_at=COALESCE(?,next_follow_up_at),updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(sentAt, text(data.follow_up_due_at), association.contact.id, ctx.workspace.id));
    await env.DB.batch(statements);
  } catch (error) {
    loggingWarning = 'The email was delivered, but some CRM status fields could not be finalized.';
    console.error('Email delivered with incomplete CRM post-processing', error);
    try {
      await env.DB.prepare(`UPDATE email_messages SET status='sent',provider_message_id=?,sent_at=?,failure_code='E_CRM_POSTLOG_INCOMPLETE',failure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?`).bind(delivery.messageId, sentAt, text(error.message, loggingWarning), emailId, ctx.workspace.id).run();
    } catch { /* queued records preserve account association */ }
  }

  let followUpId = null;
  try { followUpId = await createFollowUpFromEmail(env, ctx, data, association); } catch (error) {
    loggingWarning = loggingWarning || 'The email was delivered, but the requested follow-up could not be created.';
    console.error('Unable to create email follow-up', error);
  }
  if (association.contact) {
    try { await env.ACTIVITY_QUEUE?.send({ type: 'recalculate_contact', workspace_id: ctx.workspace.id, contact_id: association.contact.id }, { contentType: 'json' }); } catch { /* delivery and logging are complete */ }
  }
  try { await audit(env, ctx, request, 'send', 'email_message', emailId, { provider_message_id: delivery.messageId, activity_id: activityId, client_request_id: clientRequestId }); } catch (error) { console.error('Unable to audit sent email', error); }
  try { env.USAGE_ANALYTICS?.writeDataPoint({ indexes: [ctx.workspace.id], blobs: ['email_sent', association.organization.id, association.contact?.id || '', sender.domain], doubles: [1, Date.now()] }); } catch { /* analytics never blocks */ }

  const result = await getMessageById(env, ctx.workspace.id, emailId).catch(() => null);
  return {
    ...(messageRecord(result) || {
      id: emailId,
      workspace_id: ctx.workspace.id,
      activity_id: activityId,
      organization_id: association.organization.id,
      contact_id: association.contact?.id || null,
      status: 'sent',
      provider_message_id: delivery.messageId,
      sent_at: sentAt,
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      subject: text(data.subject),
      attachments: attachmentMetadata(attachments),
      client_request_id: clientRequestId,
      recipient_count: recipientCount(recipients),
    }),
    status: 'sent',
    provider_message_id: delivery.messageId,
    activity_id: activityId,
    follow_up_id: followUpId,
    organization_name: association.organization.name,
    contact_name: association.contact ? contactLabel(association.contact) : null,
    logging_warning: loggingWarning,
    idempotent_replay: false,
  };
}
