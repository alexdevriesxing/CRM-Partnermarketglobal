export const DEFAULT_SENDER_DOMAINS = Object.freeze([
  'goldendragoncapital.co',
  'devriessalesconsultancy.com',
  'partnermarketglobal.com',
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function normalizeEmailList(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[;,\n]/);
  const seen = new Set();
  const result = [];
  for (const item of raw) {
    const email = String(typeof item === 'object' ? item?.email : item ?? '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    result.push(email);
  }
  return result;
}

export function validateEmailAddress(value) {
  return EMAIL_PATTERN.test(String(value ?? '').trim());
}

export function emailDomain(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return email.includes('@') ? email.split('@').at(-1) : '';
}

export function parseAllowedDomains(value) {
  const domains = String(value ?? '').split(/[;,\s]+/).map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  return domains.length ? [...new Set(domains)] : [...DEFAULT_SENDER_DOMAINS];
}

export function isAllowedSender(value, allowedDomains = DEFAULT_SENDER_DOMAINS) {
  return validateEmailAddress(value) && allowedDomains.map((domain) => String(domain).toLowerCase()).includes(emailDomain(value));
}

export function recipientCount(message) {
  return normalizeEmailList(message?.to).length + normalizeEmailList(message?.cc).length + normalizeEmailList(message?.bcc).length;
}

export function plainTextFromHtml(html) {
  return String(html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function safeEmailHeader(value, maxLength = 500) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, maxLength);
}
