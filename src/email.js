import { parseJson } from './lib/domain.js';
import {
  isAllowedSender,
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

function senderRecord(row) { return row ? { ...row, is_default: Boolean(row.is_default), is_active: Boolean(row.is_active) } : null; }
function messageRecord(row) {
  return row ? {
    ...row,
    to: parseJson(row.to_json, []),
    cc: parseJson(row.cc_json, []),
    bcc: parseJson(row.bcc_json, []),
  } : null;
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
  const senderId = id();
  if (bool(data.is_default)) await env.DB.prepare('UPDATE email_sender_identities SET is_default=0,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=?').bind(ctx.workspace.id).run();
  await env.DB.prepare(`INSERT INTO email_sender_identities
    (id,workspace_id,email_address,display_name,reply_to,domain,is_default,is_active,created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(senderId, ctx.workspace.id, emailAddress, text(data.display_name), text(data.reply_to, emailAddress), emailAddress.split('@').at(-1), bool(data.is_default), 1, ctx.user.id).run();
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
  if (Object.hasOwn(data, 'display_name')) { sets.push('display_name=?'); values.push(text(data.display_name)); }
  if (Object.hasOwn(data, 'reply_to')) {
    const replyTo = text(data.reply_to);
    if (replyTo && !validateEmailAddress(replyTo)) throw new Error('Reply-to address is invalid');
    sets.push('reply_to=?'); values.push(replyTo);
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
  const limit = Math.max(1, Math.min(250, Number(url.searchParams.get('limit') || 100)));
  const rows = await env.DB.prepare(`SELECT m.*,s.display_name sender_display_name,c.first_name||' '||c.last_name contact_name,o.name organization_name,d.name deal_name,u.name user_name
    FROM email_messages m
    LEFT JOIN email_sender_identities s ON s.id=m.sender_identity_id
    LEFT JOIN contacts c ON c.id=m.contact_id
    LEFT JOIN organizations o ON o.id=m.organization_id
    LEFT JOIN deals d ON d.id=m.deal_id
    LEFT JOIN users u ON u.id=m.user_id
    WHERE ${conditions.join(' AND ')} ORDER BY m.created_at DESC LIMIT ?`).bind(...bindings, limit).all();
  return (rows.results || []).map(messageRecord);
}

async function resolveAssociation(env, ctx, data, to) {
  let contact = null;
  if (text(data.contact_id)) contact = await env.DB.prepare('SELECT * FROM contacts WHERE id=? AND workspace_id=?').bind(data.contact_id, ctx.workspace.id).first();
  if (!contact && to.length) contact = await env.DB.prepare(`SELECT * FROM contacts WHERE workspace_id=? AND lower(email)=lower(?) LIMIT 1`).bind(ctx.workspace.id, to[0]).first();
  if (text(data.contact_id) && !contact) throw Object.assign(new Error('Contact not found'), { status: 404 });

  const organizationId = text(data.organization_id, contact?.organization_id);
  if (!organizationId) throw new Error('Select the account this email belongs to');
  const organization = await env.DB.prepare('SELECT * FROM organizations WHERE id=? AND workspace_id=?').bind(organizationId, ctx.workspace.id).first();
  if (!organization) throw Object.assign(new Error('Account not found'), { status: 404 });
  if (contact && contact.organization_id && contact.organization_id !== organization.id) throw new Error('The selected contact belongs to a different account');
  if (contact && (contact.email_opt_out || contact.status === 'do_not_contact' || contact.consent_status === 'withdrawn')) {
    throw Object.assign(new Error('This contact has opted out of email communication'), { status: 409 });
  }
  return { contact, organization };
}

async function createEmailActivity(env, ctx, data, association, emailId, sender, recipients, providerMessageId, sentAt) {
  const activityId = id();
  const body = text(data.text_body, plainTextFromHtml(data.html_body));
  const metadata = {
    email_message_id: emailId,
    provider_message_id: providerMessageId,
    from: sender.email_address,
    from_name: sender.display_name,
    reply_to: sender.reply_to,
    to: recipients.to,
    cc: recipients.cc,
    bcc: recipients.bcc,
    html_body: text(data.html_body),
  };
  await env.DB.prepare(`INSERT INTO activities
    (id,workspace_id,contact_id,organization_id,user_id,type,direction,subject,body,outcome,occurred_at,metadata_json,deal_id,next_step)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      activityId, ctx.workspace.id, association.contact?.id || null, association.organization.id, ctx.user.id, 'email', 'outbound', text(data.subject), body, 'Sent', sentAt, JSON.stringify(metadata), text(data.deal_id), text(data.next_step)
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
      followUpId, ctx.workspace.id, association.contact?.id || null, association.organization.id, text(data.deal_id), ctx.user.id,
      text(data.follow_up_title, `Follow up: ${data.subject}`), 'email', 'open', text(data.follow_up_priority, 'medium'), dueAt, text(data.follow_up_cadence, 'none'), text(data.next_step), ctx.user.id
    ).run();
  return followUpId;
}

export async function sendCrmEmail(env, ctx, request) {
  requireWrite(ctx);
  if (!env.EMAIL_SERVICE) throw Object.assign(new Error('The private Email Worker service binding is not configured'), { status: 503 });
  const data = await bodyJson(request);
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

  const association = await resolveAssociation(env, ctx, data, recipients.to);
  const emailId = id();
  const createdAt = nowIso();
  await env.DB.prepare(`INSERT INTO email_messages
    (id,workspace_id,sender_identity_id,contact_id,organization_id,deal_id,user_id,from_email,from_name,reply_to,to_json,cc_json,bcc_json,subject,text_body,html_body,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      emailId, ctx.workspace.id, sender.id, association.contact?.id || null, association.organization.id, text(data.deal_id), ctx.user.id,
      sender.email_address, sender.display_name, sender.reply_to, JSON.stringify(recipients.to), JSON.stringify(recipients.cc), JSON.stringify(recipients.bcc),
      text(data.subject), text(data.text_body), text(data.html_body), 'queued', createdAt, createdAt
    ).run();

  try {
    const response = await env.EMAIL_SERVICE.fetch('https://email.internal/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
      }),
    });
    const delivery = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(delivery.error || 'Email delivery failed'), { code: delivery.code || 'E_EMAIL_DELIVERY_FAILED', status: response.status });

    const sentAt = nowIso();
    const activityId = await createEmailActivity(env, ctx, data, association, emailId, sender, recipients, delivery.messageId, sentAt);
    await env.DB.prepare(`UPDATE email_messages SET activity_id=?,status='sent',provider_message_id=?,sent_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?`).bind(activityId, delivery.messageId, sentAt, emailId, ctx.workspace.id).run();
    await env.DB.prepare('UPDATE organizations SET last_contact_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(sentAt, association.organization.id, ctx.workspace.id).run();
    if (association.contact) {
      await env.DB.prepare('UPDATE contacts SET last_contact_at=?,next_follow_up_at=COALESCE(?,next_follow_up_at),updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(sentAt, text(data.follow_up_due_at), association.contact.id, ctx.workspace.id).run();
      try { await env.ACTIVITY_QUEUE?.send({ type: 'recalculate_contact', workspace_id: ctx.workspace.id, contact_id: association.contact.id }, { contentType: 'json' }); } catch { /* logging must not fail after delivery */ }
    }
    const followUpId = await createFollowUpFromEmail(env, ctx, data, association);
    const result = await env.DB.prepare('SELECT * FROM email_messages WHERE id=?').bind(emailId).first();
    await audit(env, ctx, request, 'send', 'email_message', emailId, result);
    try { env.USAGE_ANALYTICS?.writeDataPoint({ indexes: [ctx.workspace.id], blobs: ['email_sent', association.organization.id, association.contact?.id || '', sender.domain], doubles: [1, Date.now()] }); } catch { /* analytics never blocks */ }
    return { ...messageRecord(result), activity_id: activityId, follow_up_id: followUpId };
  } catch (error) {
    await env.DB.prepare(`UPDATE email_messages SET status='failed',failure_code=?,failure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?`).bind(text(error.code, 'E_EMAIL_DELIVERY_FAILED'), text(error.message, 'Email delivery failed'), emailId, ctx.workspace.id).run();
    await audit(env, ctx, request, 'send_failed', 'email_message', emailId, { code: error.code, message: error.message });
    throw Object.assign(error, { status: error.status || 502 });
  }
}
