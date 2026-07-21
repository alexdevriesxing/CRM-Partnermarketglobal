import {
  isAllowedSender,
  normalizeEmailList,
  parseAllowedDomains,
  recipientCount,
  safeEmailHeader,
  validateEmailAddress,
} from './lib/email.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function bodyJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw Object.assign(new Error('Expected application/json'), { status: 415 });
  return request.json();
}

function namedAddress(email, name) {
  return name ? { email, name: safeEmailHeader(name, 150) } : email;
}

function validateMessage(data, env) {
  const allowedDomains = parseAllowedDomains(env.EMAIL_ALLOWED_DOMAINS);
  const from = String(data.from || '').trim().toLowerCase();
  const to = normalizeEmailList(data.to);
  const cc = normalizeEmailList(data.cc);
  const bcc = normalizeEmailList(data.bcc);
  const subject = safeEmailHeader(data.subject, 998);

  if (!isAllowedSender(from, allowedDomains)) throw Object.assign(new Error('Sender address is not allowed'), { status: 400, code: 'E_SENDER_NOT_ALLOWED' });
  if (!to.length) throw Object.assign(new Error('At least one recipient is required'), { status: 400, code: 'E_RECIPIENT_REQUIRED' });
  if ([...to, ...cc, ...bcc].some((email) => !validateEmailAddress(email))) throw Object.assign(new Error('One or more recipient addresses are invalid'), { status: 400, code: 'E_RECIPIENT_INVALID' });
  if (recipientCount({ to, cc, bcc }) > 50) throw Object.assign(new Error('A maximum of 50 total recipients is supported'), { status: 400, code: 'E_TOO_MANY_RECIPIENTS' });
  if (!subject) throw Object.assign(new Error('Subject is required'), { status: 400, code: 'E_SUBJECT_REQUIRED' });
  if (!String(data.text || '').trim() && !String(data.html || '').trim()) throw Object.assign(new Error('Email body is required'), { status: 400, code: 'E_BODY_REQUIRED' });

  return { from, to, cc, bcc, subject };
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method !== 'POST' || url.pathname !== '/send') return json({ error: 'Not found' }, 404);
      if (!env.EMAIL) return json({ error: 'Cloudflare Email Service binding is not configured' }, 503);

      const data = await bodyJson(request);
      const validated = validateMessage(data, env);
      const result = await env.EMAIL.send({
        from: namedAddress(validated.from, data.fromName),
        to: validated.to,
        cc: validated.cc.length ? validated.cc : undefined,
        bcc: validated.bcc.length ? validated.bcc : undefined,
        replyTo: data.replyTo && validateEmailAddress(data.replyTo) ? namedAddress(String(data.replyTo).toLowerCase(), data.replyToName) : undefined,
        subject: validated.subject,
        text: String(data.text || '').trim() || undefined,
        html: String(data.html || '').trim() || undefined,
        headers: {
          'X-PMG-Workspace-ID': safeEmailHeader(data.workspaceId, 100),
          'X-PMG-Email-ID': safeEmailHeader(data.emailId, 100),
          'X-PMG-Account-ID': safeEmailHeader(data.organizationId, 100),
        },
      });

      return json({ ok: true, messageId: result.messageId });
    } catch (error) {
      console.error('Email worker send failed', error);
      const status = Number(error.status || (error.code === 'E_RATE_LIMIT_EXCEEDED' ? 429 : 502));
      return json({ error: error.message || 'Email delivery failed', code: error.code || 'E_EMAIL_DELIVERY_FAILED' }, status);
    }
  },
};
