export const DEFAULT_SENDER_DOMAINS = Object.freeze([
  'goldendragoncapital.co',
  'devriessalesconsultancy.com',
]);

export const MAX_EMAIL_RECIPIENTS = 50;
export const MAX_EMAIL_ATTACHMENTS = 10;
export const MAX_EMAIL_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_SINGLE_ATTACHMENT_BYTES = 3 * 1024 * 1024;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

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

export function normalizeClientRequestId(value) {
  const result = String(value ?? '').trim();
  if (!result) return null;
  if (!REQUEST_ID_PATTERN.test(result)) throw new Error('The email request ID is invalid');
  return result;
}

export function base64DecodedBytes(value) {
  const raw = String(value ?? '').replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  if (!raw) return 0;
  const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(raw.length * 3 / 4) - padding);
}

export function normalizeAttachments(value) {
  if (!value) return [];
  if (!Array.isArray(value)) throw new Error('Attachments must be supplied as a list');
  if (value.length > MAX_EMAIL_ATTACHMENTS) throw new Error(`A maximum of ${MAX_EMAIL_ATTACHMENTS} attachments is supported`);

  let totalBytes = 0;
  return value.map((attachment, index) => {
    const filename = String(attachment?.filename ?? '').trim().replace(/[\r\n]/g, '').slice(0, 240);
    const type = String(attachment?.type || 'application/octet-stream').trim().toLowerCase().slice(0, 150);
    const disposition = attachment?.disposition === 'inline' ? 'inline' : 'attachment';
    const contentId = disposition === 'inline' ? String(attachment?.contentId ?? '').trim().replace(/[\r\n<>]/g, '').slice(0, 200) : undefined;
    const content = String(attachment?.content ?? '').replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
    const sizeBytes = Number(attachment?.size_bytes || base64DecodedBytes(content));

    if (!filename) throw new Error(`Attachment ${index + 1} has no filename`);
    if (!content) throw new Error(`${filename} has no content`);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error(`${filename} has an invalid size`);
    if (sizeBytes > MAX_SINGLE_ATTACHMENT_BYTES) throw new Error(`${filename} exceeds the 3 MiB per-file limit`);
    totalBytes += sizeBytes;
    if (totalBytes > MAX_EMAIL_ATTACHMENT_BYTES) throw new Error('Attachments exceed the 4 MiB combined limit');

    return { content, filename, type, disposition, ...(contentId ? { contentId } : {}), size_bytes: sizeBytes };
  });
}

export function attachmentMetadata(attachments) {
  return normalizeAttachments(attachments).map(({ filename, type, disposition, contentId, size_bytes }) => ({ filename, type, disposition, ...(contentId ? { contentId } : {}), size_bytes }));
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
