export const STAGE_PROBABILITIES = Object.freeze({
  lead: 10,
  qualified: 30,
  discovery: 40,
  proposal: 55,
  negotiation: 75,
  won: 100,
  lost: 0,
});

export const FOLLOW_UP_CHANNELS = Object.freeze(['email', 'call', 'meeting', 'whatsapp', 'linkedin', 'other']);
export const PRIORITIES = Object.freeze(['low', 'medium', 'high', 'urgent']);

export function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

export function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function normalizeTags(value) {
  const tags = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 40);
}

export function toIsoDate(value, fallback = null) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

export function daysBetween(from, to = new Date()) {
  const first = from instanceof Date ? from : new Date(from);
  const second = to instanceof Date ? to : new Date(to);
  if (Number.isNaN(first.getTime()) || Number.isNaN(second.getTime())) return null;
  return Math.floor((second.getTime() - first.getTime()) / 86_400_000);
}

export function relationshipHealth({
  lastContactAt,
  nextFollowUpAt,
  activityCount = 0,
  openDealValue = 0,
  completedTasks = 0,
  overdueTasks = 0,
  overdueFollowUps = 0,
  base = 45,
}, now = new Date()) {
  let score = Number(base) || 45;
  const recency = lastContactAt ? daysBetween(lastContactAt, now) : null;
  if (recency === null) score -= 18;
  else if (recency <= 7) score += 26;
  else if (recency <= 21) score += 15;
  else if (recency <= 45) score += 4;
  else if (recency <= 90) score -= 8;
  else score -= 20;
  score += Math.min(14, Math.log2(Number(activityCount) + 1) * 4);
  if (Number(openDealValue) > 0) score += Math.min(10, Math.log10(Number(openDealValue) + 1) * 2);
  score += Math.min(7, Number(completedTasks) * 1.25);
  score -= Math.min(20, Number(overdueTasks) * 5);
  score -= Math.min(18, Number(overdueFollowUps) * 7);
  if (nextFollowUpAt) {
    const followUp = new Date(nextFollowUpAt);
    if (!Number.isNaN(followUp.getTime()) && followUp < now) score -= 8;
  }
  return Math.round(clamp(score, 0, 100));
}

export function weightedPipeline(deals = []) {
  return deals.reduce((total, deal) => {
    const probability = deal.probability ?? STAGE_PROBABILITIES[deal.stage] ?? 0;
    return total + Number(deal.value || 0) * clamp(probability, 0, 100) / 100;
  }, 0);
}

export function summarizePipeline(deals = []) {
  const stages = Object.keys(STAGE_PROBABILITIES);
  const byStage = Object.fromEntries(stages.map((stage) => [stage, { count: 0, value: 0 }]));
  for (const deal of deals) {
    const stage = stages.includes(deal.stage) ? deal.stage : 'lead';
    byStage[stage].count += 1;
    byStage[stage].value += Number(deal.value || 0);
  }
  const closed = byStage.won.count + byStage.lost.count;
  return {
    byStage,
    totalValue: deals.filter((deal) => deal.stage !== 'lost').reduce((sum, deal) => sum + Number(deal.value || 0), 0),
    weightedValue: weightedPipeline(deals.filter((deal) => !['won', 'lost'].includes(deal.stage))),
    wonValue: byStage.won.value,
    winRate: closed ? Math.round(byStage.won.count / closed * 100) : 0,
  };
}

export function dueBucket(value, now = new Date()) {
  if (!value) return 'unscheduled';
  const due = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(due.getTime())) return 'unscheduled';
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const tomorrow = new Date(start); tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(start); nextWeek.setDate(nextWeek.getDate() + 8);
  if (due < start) return 'overdue';
  if (due < tomorrow) return 'today';
  if (due < nextWeek) return 'upcoming';
  return 'later';
}

export function groupAgenda(items = [], now = new Date()) {
  const groups = { overdue: [], today: [], upcoming: [], later: [], unscheduled: [] };
  for (const item of items) groups[dueBucket(item.due_at || item.dueAt, now)].push(item);
  for (const values of Object.values(groups)) values.sort((a, b) => String(a.due_at || '').localeCompare(String(b.due_at || '')));
  return groups;
}

export function nextRecurringDate(current, rule) {
  const date = new Date(current);
  if (Number.isNaN(date.getTime()) || !rule || rule === 'none') return null;
  if (rule === 'daily') date.setDate(date.getDate() + 1);
  else if (rule === 'weekly') date.setDate(date.getDate() + 7);
  else if (rule === 'monthly') date.setMonth(date.getMonth() + 1);
  else if (rule === 'quarterly') date.setMonth(date.getMonth() + 3);
  else return null;
  return date.toISOString();
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { values.push(current); current = ''; }
    else current += char;
  }
  values.push(current);
  return values;
}

export function parseCsv(text) {
  const rows = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim()).map(parseCsvLine);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ''])));
}

export function csvEscape(value) {
  const string = String(value ?? '');
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

export function contactsToCsv(contacts = []) {
  const headers = ['first_name', 'last_name', 'job_title', 'email', 'phone', 'organization', 'lifecycle_stage', 'relationship_score', 'last_contact_at', 'next_follow_up_at', 'consent_status', 'tags'];
  return [headers.join(','), ...contacts.map((contact) => headers.map((header) => csvEscape(header === 'tags' ? (Array.isArray(contact.tags) ? contact.tags.join('; ') : contact.tags || '') : contact[header] ?? '')).join(','))].join('\n');
}

export function safeSort(sort, allowed, fallback) { return allowed.includes(sort) ? sort : fallback; }
export function slugify(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
