import {
  isAllowedSender,
  normalizeAttachments,
  normalizeClientRequestId,
  normalizeEmailList,
  parseAllowedDomains,
  recipientCount,
  safeEmailHeader,
  validateEmailAddress,
} from './lib/email.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(data, status = 200, requestId = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(requestId ? { 'x-request-id': requestId } : {}),
    },
  });
}

async function bodyJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw Object.assign(new Error('Expected application/json'), { status: 415, code: 'E_CONTENT_TYPE' });
  return request.json();
}

function namedAddress(email, name) {
  return name ? { email, name: safeEmailHeader(name, 150) } : email;
}

function errorStatus(error) {
  const code = String(error?.code || '');
  if (error?.status) return Number(error.status);
  if (['E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED'].includes(code)) return 429;
  if (code === 'E_CONTENT_TOO_LARGE' || code === 'E_TOO_MANY_ATTACHMENTS') return 413;
  if (['E_RECIPIENT_SUPPRESSED', 'E_DELIVERY_FAILED'].includes(code)) return 409;
  if (['E_SENDER_NOT_VERIFIED', 'E_SENDER_DOMAIN_NOT_AVAILABLE'].includes(code)) return 422;
  if (code.startsWith('E_')) return 400;
  return 502;
}

function validateMessage(data, env) {
  const allowedDomains = parseAllowedDomains(env.EMAIL_ALLOWED_DOMAINS);
  const from = String(data.from || '').trim().toLowerCase();
  const to = normalizeEmailList(data.to);
  const cc = normalizeEmailList(data.cc);
  const bcc = normalizeEmailList(data.bcc);
  const subject = safeEmailHeader(data.subject, 998);
  const requestId = normalizeClientRequestId(data.clientRequestId || data.emailId || crypto.randomUUID());
  const attachments = normalizeAttachments(data.attachments);

  if (!isAllowedSender(from, allowedDomains)) throw Object.assign(new Error('Sender address is not allowed'), { status: 400, code: 'E_SENDER_NOT_ALLOWED' });
  if (!to.length) throw Object.assign(new Error('At least one recipient is required'), { status: 400, code: 'E_RECIPIENT_REQUIRED' });
  if ([...to, ...cc, ...bcc].some((email) => !validateEmailAddress(email))) throw Object.assign(new Error('One or more recipient addresses are invalid'), { status: 400, code: 'E_RECIPIENT_INVALID' });
  if (recipientCount({ to, cc, bcc }) > 50) throw Object.assign(new Error('A maximum of 50 total recipients is supported'), { status: 400, code: 'E_TOO_MANY_RECIPIENTS' });
  if (!subject) throw Object.assign(new Error('Subject is required'), { status: 400, code: 'E_SUBJECT_REQUIRED' });
  if (!String(data.text || '').trim() && !String(data.html || '').trim()) throw Object.assign(new Error('Email body is required'), { status: 400, code: 'E_BODY_REQUIRED' });

  return { from, to, cc, bcc, subject, requestId, attachments };
}

export default {
  async fetch(request, env) {
    const incomingRequestId = safeEmailHeader(request.headers.get('x-request-id') || '', 128);
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true, service: 'partnermarket-global-email-worker', timestamp: new Date().toISOString() }, 200, incomingRequestId);
      }
      if (request.method !== 'POST' || url.pathname !== '/send') return json({ error: 'Not found' }, 404, incomingRequestId);
      if (!env.EMAIL) return json({ error: 'Cloudflare Email Service binding is not configured', code: 'E_EMAIL_BINDING_MISSING' }, 503, incomingRequestId);

      const data = await bodyJson(request);
      const validated = validateMessage(data, env);
      const requestId = incomingRequestId || validated.requestId;
      const result = await env.EMAIL.send({
        from: namedAddress(validated.from, data.fromName),
        to: validated.to,
        cc: validated.cc.length ? validated.cc : undefined,
        bcc: validated.bcc.length ? validated.bcc : undefined,
        replyTo: data.replyTo && validateEmailAddress(data.replyTo) ? namedAddress(String(data.replyTo).toLowerCase(), data.replyToName) : undefined,
        subject: validated.subject,
        text: String(data.text || '').trim() || undefined,
        html: String(data.html || '').trim() || undefined,
        attachments: validated.attachments.length ? validated.attachments.map(({ size_bytes: _size, ...attachment }) => attachment) : undefined,
        headers: {
          'X-PMG-Workspace-ID': safeEmailHeader(data.workspaceId, 100),
          'X-PMG-Email-ID': safeEmailHeader(data.emailId, 100),
          'X-PMG-Account-ID': safeEmailHeader(data.organizationId, 100),
          'X-PMG-Request-ID': safeEmailHeader(requestId, 128),
        },
      });

      return json({ ok: true, messageId: result.messageId, requestId }, 200, requestId);
    } catch (error) {
      const requestId = incomingRequestId || crypto.randomUUID();
      console.error('Email worker send failed', { requestId, code: error.code, message: error.message });
      return json({ error: error.message || 'Email delivery failed', code: error.code || 'E_EMAIL_DELIVERY_FAILED', requestId }, errorStatus(error), requestId);
    }
  },
};
