export const STAGE_PROBABILITIES = Object.freeze({
  lead: 10,
  qualified: 30,
  proposal: 55,
  negotiation: 75,
  won: 100,
  lost: 0,
});

export function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

export function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function normalizeTags(value) {
  const tags = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(',')
        .map((tag) => tag.trim());
  return [...new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 30);
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
  base = 45,
}, now = new Date()) {
  let score = Number(base) || 45;
  const recency = lastContactAt ? daysBetween(lastContactAt, now) : null;

  if (recency === null) score -= 15;
  else if (recency <= 7) score += 24;
  else if (recency <= 21) score += 14;
  else if (recency <= 45) score += 3;
  else if (recency <= 90) score -= 8;
  else score -= 18;

  score += Math.min(14, Math.log2(Number(activityCount) + 1) * 4);
  if (Number(openDealValue) > 0) score += Math.min(10, Math.log10(Number(openDealValue) + 1) * 2);
  score += Math.min(6, Number(completedTasks) * 1.5);
  score -= Math.min(20, Number(overdueTasks) * 6);

  if (nextFollowUpAt) {
    const followUp = new Date(nextFollowUpAt);
    if (!Number.isNaN(followUp.getTime()) && followUp < now) score -= 10;
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
  const stages = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
  const byStage = Object.fromEntries(stages.map((stage) => [stage, { count: 0, value: 0 }]));
  for (const deal of deals) {
    const stage = stages.includes(deal.stage) ? deal.stage : 'lead';
    byStage[stage].count += 1;
    byStage[stage].value += Number(deal.value || 0);
  }
  return {
    byStage,
    totalValue: deals.filter((deal) => !['lost'].includes(deal.stage)).reduce((sum, deal) => sum + Number(deal.value || 0), 0),
    weightedValue: weightedPipeline(deals.filter((deal) => !['won', 'lost'].includes(deal.stage))),
    wonValue: byStage.won.value,
    winRate: deals.filter((deal) => ['won', 'lost'].includes(deal.stage)).length
      ? Math.round((byStage.won.count / (byStage.won.count + byStage.lost.count)) * 100)
      : 0,
  };
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

export function parseCsv(text) {
  const rows = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ''])));
}

export function csvEscape(value) {
  const string = String(value ?? '');
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

export function contactsToCsv(contacts = []) {
  const headers = ['first_name', 'last_name', 'job_title', 'email', 'phone', 'organization', 'lifecycle_stage', 'relationship_score', 'last_contact_at', 'next_follow_up_at', 'tags'];
  const lines = [headers.join(',')];
  for (const contact of contacts) {
    lines.push(headers.map((header) => {
      const value = header === 'tags'
        ? (Array.isArray(contact.tags) ? contact.tags.join('; ') : contact.tags || '')
        : contact[header] ?? '';
      return csvEscape(value);
    }).join(','));
  }
  return lines.join('\n');
}

export function safeSort(sort, allowed, fallback) {
  return allowed.includes(sort) ? sort : fallback;
}

export function paginate(items, page = 1, pageSize = 25) {
  const safePageSize = Math.round(clamp(pageSize, 1, 100));
  const safePage = Math.max(1, Math.round(Number(page) || 1));
  const start = (safePage - 1) * safePageSize;
  return {
    items: items.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    total: items.length,
    pages: Math.max(1, Math.ceil(items.length / safePageSize)),
  };
}

export function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
