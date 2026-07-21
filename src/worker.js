import {
  STAGE_PROBABILITIES,
  clamp,
  contactsToCsv,
  nextRecurringDate,
  normalizeTags,
  parseCsv,
  parseJson,
  safeSort,
  slugify,
  toIsoDate,
} from './lib/domain.js';
import { createEmailSender, listEmailMessages, listEmailSenders, sendCrmEmail, updateEmailSender } from './email.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...SECURITY_HEADERS, ...headers } });
}
function error(message, status = 400, details) { return json({ error: message, ...(details ? { details } : {}) }, status); }
async function bodyJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw Object.assign(new Error('Expected application/json'), { status: 415 });
  return request.json();
}
function parts(pathname) { return pathname.split('/').filter(Boolean).map(decodeURIComponent); }
function nowIso() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }
function bool(value) { return value === true || value === 1 || value === '1' ? 1 : 0; }
function text(value, fallback = null) { const result = String(value ?? '').trim(); return result || fallback; }

function contactRecord(row) {
  return row ? { ...row, tags: parseJson(row.tags_json, []), custom_fields: parseJson(row.custom_fields_json, {}), organization: row.organization_name || null } : null;
}
function organizationRecord(row) { return row ? { ...row, tags: parseJson(row.tags_json, []), custom_fields: parseJson(row.custom_fields_json, {}) } : null; }
function activityRecord(row) { return row ? { ...row, metadata: parseJson(row.metadata_json, {}) } : null; }
function savedViewRecord(row) { return row ? { ...row, filters: parseJson(row.filters_json, {}), sort: parseJson(row.sort_json, {}) } : null; }

function b64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
}
async function accessKeys(env) {
  const cacheKey = 'access:jwks:v2';
  const cached = env.CACHE ? await env.CACHE.get(cacheKey, 'json') : null;
  if (cached?.keys?.length) return cached;
  const domain = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const response = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error('Unable to load Cloudflare Access signing keys');
  const keys = await response.json();
  if (env.CACHE) await env.CACHE.put(cacheKey, JSON.stringify(keys), { expirationTtl: 3600 });
  return keys;
}
async function verifyAccessJwt(token, env) {
  const segments = token.split('.');
  if (segments.length !== 3) throw new Error('Invalid access token');
  const header = JSON.parse(new TextDecoder().decode(b64UrlDecode(segments[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64UrlDecode(segments[1])));
  const jwks = await accessKeys(env);
  const jwk = jwks.keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) throw new Error('Unknown access signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64UrlDecode(segments[2]), new TextEncoder().encode(`${segments[0]}.${segments[1]}`));
  if (!valid) throw new Error('Invalid access token signature');
  const now = Math.floor(Date.now() / 1000);
  const issuer = `https://${String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.exp && payload.exp < now) throw new Error('Access token expired');
  if (payload.nbf && payload.nbf > now) throw new Error('Access token not active');
  if (payload.iss !== issuer) throw new Error('Invalid access token issuer');
  if (env.ACCESS_AUD && !audiences.includes(env.ACCESS_AUD)) throw new Error('Invalid access token audience');
  return payload;
}

async function currentUser(request, env) {
  const mode = String(env.AUTH_MODE || 'access').toLowerCase();
  let identity;
  if (mode === 'dev' || mode === 'disabled') {
    identity = { email: request.headers.get('x-dev-user-email') || 'alex@example.com', name: request.headers.get('x-dev-user-name') || 'Alex de Vries' };
  } else {
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) throw Object.assign(new Error('Authentication required'), { status: 401 });
    const payload = await verifyAccessJwt(token, env);
    identity = { email: payload.email, name: payload.name || payload.email?.split('@')[0] || 'CRM User' };
  }
  if (!identity.email) throw Object.assign(new Error('Authenticated identity has no email'), { status: 401 });
  const existing = await env.DB.prepare('SELECT * FROM users WHERE lower(email)=lower(?) LIMIT 1').bind(identity.email).first();
  if (existing) {
    if (!existing.is_active) throw Object.assign(new Error('Your CRM account is disabled'), { status: 403 });
    return existing;
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM users').first();
  const user = { id: id(), email: identity.email, name: identity.name, role: Number(count?.total || 0) === 0 ? 'admin' : 'member', is_active: 1 };
  await env.DB.prepare('INSERT INTO users (id,email,name,role) VALUES (?,?,?,?)').bind(user.id, user.email, user.name, user.role).run();
  let workspace = await env.DB.prepare('SELECT * FROM workspaces WHERE is_active=1 ORDER BY created_at LIMIT 1').first();
  if (!workspace) {
    workspace = { id: id(), name: 'PartnerMarket Global', slug: 'partnermarket-global', currency: 'EUR', timezone: 'Europe/Amsterdam', color: '#0f766e' };
    await env.DB.prepare('INSERT INTO workspaces (id,name,slug,currency,timezone,color,created_by) VALUES (?,?,?,?,?,?,?)').bind(workspace.id, workspace.name, workspace.slug, workspace.currency, workspace.timezone, workspace.color, user.id).run();
  }
  await env.DB.prepare('INSERT OR IGNORE INTO workspace_members (workspace_id,user_id,role,is_default) VALUES (?,?,?,1)').bind(workspace.id, user.id, user.role).run();
  return user;
}

async function workspaceContext(request, env, user) {
  const preferred = request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspace_id');
  const memberships = await env.DB.prepare(`SELECT w.*, wm.role AS member_role, wm.is_default, wm.preferences_json
    FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id
    WHERE wm.user_id=? AND w.is_active=1 ORDER BY wm.is_default DESC, w.name`).bind(user.id).all();
  let workspaces = memberships.results || [];
  if (!workspaces.length && user.role === 'admin') {
    const all = await env.DB.prepare('SELECT *, ? AS member_role, 1 AS is_default FROM workspaces WHERE is_active=1 ORDER BY name').bind('admin').all();
    workspaces = all.results || [];
  }
  const workspace = workspaces.find((item) => item.id === preferred) || workspaces[0];
  if (!workspace) throw Object.assign(new Error('No CRM workspace is available for this account'), { status: 403 });
  return { workspace, workspaces };
}
function requireRole(user, workspace, roles) {
  const role = workspace?.member_role || user.role;
  if (!roles.includes(role) && user.role !== 'admin') throw Object.assign(new Error('Insufficient permissions'), { status: 403 });
}

async function audit(env, ctx, request, action, entityType, entityId, before = null, after = null) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  let ipHash = null;
  if (ip) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    ipHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }
  await env.DB.prepare(`INSERT INTO audit_log (id,user_id,action,entity_type,entity_id,before_json,after_json,ip_hash,workspace_id)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(id(), ctx.user.id, action, entityType, entityId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, ipHash, ctx.workspace.id).run();
}
function track(env, ctx, event, entityType = '', entityId = '') {
  try {
    env.USAGE_ANALYTICS?.writeDataPoint({ indexes: [ctx.workspace.id], blobs: [event, entityType, entityId, ctx.user.role || 'unknown'], doubles: [1, Date.now()] });
  } catch { /* analytics never blocks */ }
}
async function enqueue(env, message) {
  if (!env.ACTIVITY_QUEUE) return;
  try { await env.ACTIVITY_QUEUE.send(message, { contentType: 'json' }); } catch (queueError) { console.warn('Queue send failed', queueError); }
}

async function me(env, ctx) {
  return {
    user: ctx.user,
    workspace: ctx.workspace,
    workspaces: ctx.workspaces.map((row) => ({ ...row, preferences: parseJson(row.preferences_json, {}) })),
    permissions: {
      can_write: ['admin', 'manager', 'member'].includes(ctx.workspace.member_role || ctx.user.role),
      can_manage: ['admin', 'manager'].includes(ctx.workspace.member_role || ctx.user.role),
      can_admin: (ctx.workspace.member_role || ctx.user.role) === 'admin' || ctx.user.role === 'admin',
    },
  };
}

async function dashboard(env, ctx) {
  const ws = ctx.workspace.id;
  const [counts, pipeline, stages, activityByDay, tasks, followUps, recent, health, sources, stale] = await Promise.all([
    env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM contacts WHERE workspace_id=? AND status='active') AS contacts,
      (SELECT COUNT(*) FROM organizations WHERE workspace_id=? AND status='active') AS organizations,
      (SELECT COUNT(*) FROM tasks WHERE workspace_id=? AND status NOT IN ('completed','cancelled') AND due_at < datetime('now')) AS overdue_tasks,
      (SELECT COUNT(*) FROM follow_ups WHERE workspace_id=? AND status IN ('open','snoozed') AND COALESCE(snoozed_until,due_at)<datetime('now')) AS overdue_follow_ups,
      (SELECT COUNT(*) FROM follow_ups WHERE workspace_id=? AND status IN ('open','snoozed') AND date(COALESCE(snoozed_until,due_at))=date('now')) AS follow_ups_today,
      (SELECT COUNT(*) FROM activities WHERE workspace_id=? AND occurred_at>=datetime('now','-30 days')) AS activities_30d`).bind(ws, ws, ws, ws, ws, ws).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN stage!='lost' THEN value ELSE 0 END),0) total_value,
      COALESCE(SUM(CASE WHEN stage NOT IN ('won','lost') THEN value*probability/100.0 ELSE 0 END),0) weighted_value,
      COALESCE(SUM(CASE WHEN stage='won' THEN value ELSE 0 END),0) won_value,
      SUM(CASE WHEN stage='won' THEN 1 ELSE 0 END) won_count,
      SUM(CASE WHEN stage='lost' THEN 1 ELSE 0 END) lost_count FROM deals WHERE workspace_id=?`).bind(ws).first(),
    env.DB.prepare('SELECT stage,COUNT(*) count,COALESCE(SUM(value),0) value FROM deals WHERE workspace_id=? GROUP BY stage').bind(ws).all(),
    env.DB.prepare(`WITH RECURSIVE days(day) AS (SELECT date('now','-13 days') UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<date('now'))
      SELECT days.day,COUNT(a.id) count FROM days LEFT JOIN activities a ON a.workspace_id=? AND date(a.occurred_at)=days.day GROUP BY days.day ORDER BY days.day`).bind(ws).all(),
    env.DB.prepare(`SELECT t.*,c.first_name||' '||c.last_name contact_name,o.name organization_name,u.name assignee_name
      FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id LEFT JOIN organizations o ON o.id=t.organization_id LEFT JOIN users u ON u.id=t.assignee_id
      WHERE t.workspace_id=? AND t.status NOT IN ('completed','cancelled') ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,t.due_at LIMIT 10`).bind(ws).all(),
    env.DB.prepare(`SELECT f.*,c.first_name||' '||c.last_name contact_name,o.name organization_name,d.name deal_name,u.name owner_name
      FROM follow_ups f LEFT JOIN contacts c ON c.id=f.contact_id LEFT JOIN organizations o ON o.id=f.organization_id LEFT JOIN deals d ON d.id=f.deal_id LEFT JOIN users u ON u.id=f.owner_id
      WHERE f.workspace_id=? AND f.status IN ('open','snoozed') ORDER BY COALESCE(f.snoozed_until,f.due_at) LIMIT 10`).bind(ws).all(),
    env.DB.prepare(`SELECT a.*,c.first_name||' '||c.last_name contact_name,o.name organization_name,u.name user_name,d.name deal_name
      FROM activities a LEFT JOIN contacts c ON c.id=a.contact_id LEFT JOIN organizations o ON o.id=a.organization_id LEFT JOIN users u ON u.id=a.user_id LEFT JOIN deals d ON d.id=a.deal_id
      WHERE a.workspace_id=? ORDER BY a.occurred_at DESC LIMIT 12`).bind(ws).all(),
    env.DB.prepare(`SELECT SUM(CASE WHEN relationship_score>=80 THEN 1 ELSE 0 END) strong,
      SUM(CASE WHEN relationship_score BETWEEN 55 AND 79 THEN 1 ELSE 0 END) healthy,
      SUM(CASE WHEN relationship_score BETWEEN 35 AND 54 THEN 1 ELSE 0 END) needs_attention,
      SUM(CASE WHEN relationship_score<35 THEN 1 ELSE 0 END) at_risk FROM contacts WHERE workspace_id=? AND status='active'`).bind(ws).first(),
    env.DB.prepare("SELECT COALESCE(NULLIF(source,''),'Unknown') source,COUNT(*) count FROM contacts WHERE workspace_id=? GROUP BY source ORDER BY count DESC LIMIT 6").bind(ws).all(),
    env.DB.prepare(`SELECT id,first_name,last_name,last_contact_at,relationship_score FROM contacts
      WHERE workspace_id=? AND status='active' AND (last_contact_at IS NULL OR last_contact_at<datetime('now','-60 days')) ORDER BY last_contact_at LIMIT 8`).bind(ws).all(),
  ]);
  const closed = Number(pipeline.won_count || 0) + Number(pipeline.lost_count || 0);
  return {
    counts,
    pipeline: { ...pipeline, win_rate: closed ? Math.round(Number(pipeline.won_count || 0) / closed * 100) : 0 },
    stages: stages.results,
    activity_by_day: activityByDay.results,
    tasks: tasks.results,
    follow_ups: followUps.results,
    recent_activities: recent.results.map(activityRecord),
    health,
    sources: sources.results,
    stale_contacts: stale.results,
  };
}

async function agenda(env, ctx, request) {
  const ws = ctx.workspace.id;
  const url = new URL(request.url);
  const owner = url.searchParams.get('owner') || ctx.user.id;
  const scope = url.searchParams.get('scope') || 'mine';
  const ownerClause = scope === 'all' ? '' : ' AND owner_id=?';
  const bindings = scope === 'all' ? [ws] : [ws, owner];
  const [followUps, tasks] = await Promise.all([
    env.DB.prepare(`SELECT f.*,c.first_name||' '||c.last_name contact_name,o.name organization_name,d.name deal_name,u.name owner_name,
      COALESCE(f.snoozed_until,f.due_at) effective_due_at
      FROM follow_ups f LEFT JOIN contacts c ON c.id=f.contact_id LEFT JOIN organizations o ON o.id=f.organization_id LEFT JOIN deals d ON d.id=f.deal_id LEFT JOIN users u ON u.id=f.owner_id
      WHERE f.workspace_id=? AND f.status IN ('open','snoozed')${ownerClause} ORDER BY effective_due_at`).bind(...bindings).all(),
    env.DB.prepare(`SELECT t.*,c.first_name||' '||c.last_name contact_name,o.name organization_name,d.name deal_name,u.name assignee_name
      FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id LEFT JOIN organizations o ON o.id=t.organization_id LEFT JOIN deals d ON d.id=t.deal_id LEFT JOIN users u ON u.id=t.assignee_id
      WHERE t.workspace_id=? AND t.status NOT IN ('completed','cancelled')${scope === 'all' ? '' : ' AND t.assignee_id=?'} ORDER BY t.due_at`).bind(...bindings).all(),
  ]);
  return { follow_ups: followUps.results, tasks: tasks.results };
}

async function listContacts(env, ctx, request) {
  const url = new URL(request.url);
  const q = text(url.searchParams.get('q'), '');
  const stage = text(url.searchParams.get('stage'), '');
  const account = text(url.searchParams.get('account'), '');
  const owner = text(url.searchParams.get('owner'), '');
  const health = text(url.searchParams.get('health'), '');
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const pageSize = Math.round(clamp(url.searchParams.get('pageSize') || 25, 1, 100));
  const sort = safeSort(url.searchParams.get('sort'), ['name','organization','last_contact','score','follow_up','created'], 'last_contact');
  const order = url.searchParams.get('order') === 'asc' ? 'ASC' : 'DESC';
  const sortSql = { name:'c.first_name',organization:'o.name',last_contact:'c.last_contact_at',score:'c.relationship_score',follow_up:'c.next_follow_up_at',created:'c.created_at' }[sort];
  const conditions = ['c.workspace_id=?'];
  const bindings = [ctx.workspace.id];
  if (q) { const match = `%${q.toLowerCase()}%`; conditions.push("(lower(c.first_name||' '||c.last_name) LIKE ? OR lower(c.email) LIKE ? OR lower(o.name) LIKE ? OR lower(c.job_title) LIKE ?)"); bindings.push(match, match, match, match); }
  if (stage) { conditions.push('c.lifecycle_stage=?'); bindings.push(stage); }
  if (account) { conditions.push('c.organization_id=?'); bindings.push(account); }
  if (owner) { conditions.push('c.owner_id=?'); bindings.push(owner); }
  if (health === 'at_risk') conditions.push('c.relationship_score<35');
  if (health === 'attention') conditions.push('c.relationship_score BETWEEN 35 AND 54');
  if (health === 'healthy') conditions.push('c.relationship_score>=55');
  const where = conditions.join(' AND ');
  const count = await env.DB.prepare(`SELECT COUNT(*) total FROM contacts c LEFT JOIN organizations o ON o.id=c.organization_id WHERE ${where}`).bind(...bindings).first();
  const rows = await env.DB.prepare(`SELECT c.*,o.name organization_name,u.name owner_name,
      (SELECT COUNT(*) FROM activities a WHERE a.contact_id=c.id AND a.workspace_id=c.workspace_id) activity_count,
      (SELECT COUNT(*) FROM follow_ups f WHERE f.contact_id=c.id AND f.status IN ('open','snoozed')) open_follow_ups,
      (SELECT COUNT(*) FROM tasks t WHERE t.contact_id=c.id AND t.status NOT IN ('completed','cancelled')) open_tasks,
      (SELECT COALESCE(SUM(value),0) FROM deals d WHERE d.primary_contact_id=c.id AND d.stage NOT IN ('won','lost')) open_deal_value
    FROM contacts c LEFT JOIN organizations o ON o.id=c.organization_id LEFT JOIN users u ON u.id=c.owner_id
    WHERE ${where} ORDER BY ${sortSql} ${order} NULLS LAST LIMIT ? OFFSET ?`).bind(...bindings, pageSize, (page-1)*pageSize).all();
  const total = Number(count?.total || 0);
  return { items: rows.results.map(contactRecord), page, pageSize, total, pages: Math.max(1, Math.ceil(total/pageSize)) };
}

async function getContact(env, ctx, contactId) {
  const row = await env.DB.prepare(`SELECT c.*,o.name organization_name,o.account_tier,u.name owner_name FROM contacts c
    LEFT JOIN organizations o ON o.id=c.organization_id LEFT JOIN users u ON u.id=c.owner_id WHERE c.id=? AND c.workspace_id=?`).bind(contactId, ctx.workspace.id).first();
  if (!row) throw Object.assign(new Error('Contact not found'), { status: 404 });
  const [activities, tasks, followUps, deals, attachments] = await Promise.all([
    env.DB.prepare(`SELECT a.*,u.name user_name,o.name organization_name,d.name deal_name FROM activities a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN organizations o ON o.id=a.organization_id LEFT JOIN deals d ON d.id=a.deal_id WHERE a.contact_id=? AND a.workspace_id=? ORDER BY a.occurred_at DESC LIMIT 100`).bind(contactId, ctx.workspace.id).all(),
    env.DB.prepare("SELECT * FROM tasks WHERE contact_id=? AND workspace_id=? ORDER BY status='completed',due_at").bind(contactId, ctx.workspace.id).all(),
    env.DB.prepare("SELECT * FROM follow_ups WHERE contact_id=? AND workspace_id=? ORDER BY status='completed',COALESCE(snoozed_until,due_at)").bind(contactId, ctx.workspace.id).all(),
    env.DB.prepare('SELECT * FROM deals WHERE primary_contact_id=? AND workspace_id=? ORDER BY updated_at DESC').bind(contactId, ctx.workspace.id).all(),
    env.DB.prepare('SELECT id,file_name,mime_type,size_bytes,created_at FROM attachments WHERE contact_id=? AND workspace_id=? ORDER BY created_at DESC').bind(contactId, ctx.workspace.id).all(),
  ]);
  return { contact: contactRecord(row), activities: activities.results.map(activityRecord), tasks: tasks.results, follow_ups: followUps.results, deals: deals.results, attachments: attachments.results };
}

async function createContact(env, ctx, request) {
  requireRole(ctx.user, ctx.workspace, ['admin','manager','member']);
  const data = await bodyJson(request);
  if (!text(data.first_name)) throw new Error('First name is required');
  const contactId = id();
  await env.DB.prepare(`INSERT INTO contacts (id,workspace_id,organization_id,first_name,last_name,job_title,email,phone,mobile,linkedin_url,preferred_channel,lifecycle_stage,status,owner_id,relationship_score,source,timezone,birthday,last_contact_at,next_follow_up_at,notes,tags_json,custom_fields_json,account_role,consent_status,email_opt_out,phone_opt_out,preferred_language)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      contactId, ctx.workspace.id, text(data.organization_id), text(data.first_name), text(data.last_name,''), text(data.job_title), text(data.email), text(data.phone), text(data.mobile), text(data.linkedin_url), text(data.preferred_channel,'email'), text(data.lifecycle_stage,'lead'), text(data.status,'active'), text(data.owner_id,ctx.user.id), clamp(data.relationship_score ?? 50,0,100), text(data.source), text(data.timezone), text(data.birthday), toIsoDate(data.last_contact_at), toIsoDate(data.next_follow_up_at), text(data.notes), JSON.stringify(normalizeTags(data.tags)), JSON.stringify(data.custom_fields || {}), text(data.account_role), text(data.consent_status,'unknown'), bool(data.email_opt_out), bool(data.phone_opt_out), text(data.preferred_language)
    ).run();
  const created = await getContact(env, ctx, contactId);
  await audit(env, ctx, request, 'create', 'contact', contactId, null, created.contact);
  track(env, ctx, 'contact_created', 'contact', contactId);
  return created.contact;
}

async function updateContact(env, ctx, request, contactId) {
  requireRole(ctx.user, ctx.workspace, ['admin','manager','member']);
  const before = await env.DB.prepare('SELECT * FROM contacts WHERE id=? AND workspace_id=?').bind(contactId, ctx.workspace.id).first();
  if (!before) throw Object.assign(new Error('Contact not found'), { status: 404 });
  const data = await bodyJson(request);
  const allowed = ['organization_id','first_name','last_name','job_title','email','phone','mobile','linkedin_url','preferred_channel','lifecycle_stage','status','owner_id','relationship_score','source','timezone','birthday','last_contact_at','next_follow_up_at','notes','account_role','consent_status','email_opt_out','phone_opt_out','preferred_language'];
  const sets=[]; const values=[];
  for (const key of allowed) if (Object.hasOwn(data,key)) { sets.push(`${key}=?`); values.push(['email_opt_out','phone_opt_out'].includes(key) ? bool(data[key]) : ['relationship_score'].includes(key) ? clamp(data[key],0,100) : ['last_contact_at','next_follow_up_at'].includes(key) ? toIsoDate(data[key]) : text(data[key])); }
  if (Object.hasOwn(data,'tags')) { sets.push('tags_json=?'); values.push(JSON.stringify(normalizeTags(data.tags))); }
  if (Object.hasOwn(data,'custom_fields')) { sets.push('custom_fields_json=?'); values.push(JSON.stringify(data.custom_fields || {})); }
  if (!sets.length) return contactRecord(before);
  sets.push('updated_at=CURRENT_TIMESTAMP');
  await env.DB.prepare(`UPDATE contacts SET ${sets.join(',')} WHERE id=? AND workspace_id=?`).bind(...values, contactId, ctx.workspace.id).run();
  const after = (await getContact(env, ctx, contactId)).contact;
  await audit(env, ctx, request, 'update', 'contact', contactId, before, after);
  return after;
}

async function listOrganizations(env, ctx, request) {
  const url = new URL(request.url); const q = text(url.searchParams.get('q'),'');
  const conditions=['o.workspace_id=?']; const bindings=[ctx.workspace.id];
  if (q) { const match=`%${q.toLowerCase()}%`; conditions.push('(lower(o.name) LIKE ? OR lower(o.industry) LIKE ? OR lower(o.country) LIKE ?)'); bindings.push(match,match,match); }
  const rows = await env.DB.prepare(`SELECT o.*,u.name owner_name,
    (SELECT COUNT(*) FROM contacts c WHERE c.organization_id=o.id) contact_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.organization_id=o.id AND t.status NOT IN ('completed','cancelled')) open_tasks,
    (SELECT COUNT(*) FROM follow_ups f WHERE f.organization_id=o.id AND f.status IN ('open','snoozed')) open_follow_ups,
    (SELECT COALESCE(SUM(value),0) FROM deals d WHERE d.organization_id=o.id AND d.stage NOT IN ('lost')) pipeline_value
    FROM organizations o LEFT JOIN users u ON u.id=o.owner_id WHERE ${conditions.join(' AND ')} ORDER BY CASE o.account_tier WHEN 'strategic' THEN 1 WHEN 'key' THEN 2 ELSE 3 END,o.name`).bind(...bindings).all();
  return rows.results.map(organizationRecord);
}

async function getOrganization(env, ctx, organizationId) {
  const row = await env.DB.prepare('SELECT o.*,u.name owner_name FROM organizations o LEFT JOIN users u ON u.id=o.owner_id WHERE o.id=? AND o.workspace_id=?').bind(organizationId,ctx.workspace.id).first();
  if (!row) throw Object.assign(new Error('Account not found'), { status:404 });
  const [contacts,activities,tasks,followUps,deals] = await Promise.all([
    env.DB.prepare('SELECT * FROM contacts WHERE organization_id=? AND workspace_id=? ORDER BY first_name,last_name').bind(organizationId,ctx.workspace.id).all(),
    env.DB.prepare(`SELECT a.*,c.first_name||' '||c.last_name contact_name,u.name user_name FROM activities a LEFT JOIN contacts c ON c.id=a.contact_id LEFT JOIN users u ON u.id=a.user_id WHERE a.organization_id=? AND a.workspace_id=? ORDER BY occurred_at DESC LIMIT 100`).bind(organizationId,ctx.workspace.id).all(),
    env.DB.prepare("SELECT * FROM tasks WHERE organization_id=? AND workspace_id=? ORDER BY status='completed',due_at").bind(organizationId,ctx.workspace.id).all(),
    env.DB.prepare("SELECT * FROM follow_ups WHERE organization_id=? AND workspace_id=? ORDER BY status='completed',COALESCE(snoozed_until,due_at)").bind(organizationId,ctx.workspace.id).all(),
    env.DB.prepare('SELECT * FROM deals WHERE organization_id=? AND workspace_id=? ORDER BY updated_at DESC').bind(organizationId,ctx.workspace.id).all(),
  ]);
  return { organization:organizationRecord(row), contacts:contacts.results.map(contactRecord), activities:activities.results.map(activityRecord), tasks:tasks.results, follow_ups:followUps.results, deals:deals.results };
}

async function createOrganization(env,ctx,request) {
  requireRole(ctx.user,ctx.workspace,['admin','manager','member']); const data=await bodyJson(request);
  if (!text(data.name)) throw new Error('Account name is required');
  const organizationId=id();
  await env.DB.prepare(`INSERT INTO organizations (id,workspace_id,name,domain,industry,type,status,country,city,website,linkedin_url,phone,description,owner_id,annual_value,relationship_score,last_contact_at,next_follow_up_at,tags_json,custom_fields_json,account_tier,territory,employee_count,revenue_band)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(organizationId,ctx.workspace.id,text(data.name),text(data.domain),text(data.industry),text(data.type,'prospect'),text(data.status,'active'),text(data.country),text(data.city),text(data.website),text(data.linkedin_url),text(data.phone),text(data.description),text(data.owner_id,ctx.user.id),Number(data.annual_value||0),clamp(data.relationship_score??50,0,100),toIsoDate(data.last_contact_at),toIsoDate(data.next_follow_up_at),JSON.stringify(normalizeTags(data.tags)),JSON.stringify(data.custom_fields||{}),text(data.account_tier,'standard'),text(data.territory),Number(data.employee_count||0)||null,text(data.revenue_band)).run();
  const result=(await getOrganization(env,ctx,organizationId)).organization; await audit(env,ctx,request,'create','organization',organizationId,null,result); return result;
}

async function listActivities(env,ctx,request) {
  const url=new URL(request.url); const conditions=['a.workspace_id=?']; const bindings=[ctx.workspace.id];
  for (const [param,column] of [['contact','a.contact_id'],['account','a.organization_id'],['deal','a.deal_id'],['type','a.type'],['user','a.user_id']]) { const value=text(url.searchParams.get(param),''); if(value){conditions.push(`${column}=?`);bindings.push(value);} }
  const q=text(url.searchParams.get('q'),''); if(q){conditions.push('(lower(a.subject) LIKE ? OR lower(a.body) LIKE ? OR lower(a.outcome) LIKE ?)'); const m=`%${q.toLowerCase()}%`;bindings.push(m,m,m);}
  const limit=Math.round(clamp(url.searchParams.get('limit')||100,1,250));
  const rows=await env.DB.prepare(`SELECT a.*,c.first_name||' '||c.last_name contact_name,o.name organization_name,u.name user_name,d.name deal_name
    FROM activities a LEFT JOIN contacts c ON c.id=a.contact_id LEFT JOIN organizations o ON o.id=a.organization_id LEFT JOIN users u ON u.id=a.user_id LEFT JOIN deals d ON d.id=a.deal_id
    WHERE ${conditions.join(' AND ')} ORDER BY a.occurred_at DESC LIMIT ?`).bind(...bindings,limit).all();
  return rows.results.map(activityRecord);
}

async function createActivity(env,ctx,request) {
  requireRole(ctx.user,ctx.workspace,['admin','manager','member']); const data=await bodyJson(request);
  if(!text(data.subject)) throw new Error('A subject is required');
  const activityId=id(); const occurred=toIsoDate(data.occurred_at,nowIso());
  await env.DB.prepare(`INSERT INTO activities (id,workspace_id,contact_id,organization_id,user_id,type,direction,subject,body,outcome,occurred_at,duration_minutes,metadata_json,deal_id,task_id,follow_up_id,sentiment,next_step,is_pinned)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(activityId,ctx.workspace.id,text(data.contact_id),text(data.organization_id),ctx.user.id,text(data.type,'note'),text(data.direction,'internal'),text(data.subject),text(data.body),text(data.outcome),occurred,Number(data.duration_minutes||0)||null,JSON.stringify(data.metadata||{}),text(data.deal_id),text(data.task_id),text(data.follow_up_id),text(data.sentiment),text(data.next_step),bool(data.is_pinned)).run();
  if(data.contact_id){
    await env.DB.prepare('UPDATE contacts SET last_contact_at=?,next_follow_up_at=COALESCE(?,next_follow_up_at),updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(occurred,toIsoDate(data.next_follow_up_at),data.contact_id,ctx.workspace.id).run();
    await enqueue(env,{type:'recalculate_contact',workspace_id:ctx.workspace.id,contact_id:data.contact_id});
  }
  if(data.organization_id) await env.DB.prepare('UPDATE organizations SET last_contact_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(occurred,data.organization_id,ctx.workspace.id).run();
  if(data.follow_up_id && data.complete_follow_up) await completeFollowUp(env,ctx,request,data.follow_up_id,{skipBody:true});
  if(data.create_follow_up && data.follow_up_due_at){
    await createFollowUp(env,ctx,request,{ ...data.create_follow_up,contact_id:data.contact_id,organization_id:data.organization_id,deal_id:data.deal_id,due_at:data.follow_up_due_at },true);
  }
  const created=await env.DB.prepare('SELECT * FROM activities WHERE id=? AND workspace_id=?').bind(activityId,ctx.workspace.id).first();
  await audit(env,ctx,request,'create','activity',activityId,null,created); track(env,ctx,'activity_logged','activity',activityId); return activityRecord(created);
}

async function listDeals(env,ctx,request) {
  const url=new URL(request.url); const account=text(url.searchParams.get('account'),''); const conditions=['d.workspace_id=?']; const bindings=[ctx.workspace.id]; if(account){conditions.push('d.organization_id=?');bindings.push(account);}
  const rows=await env.DB.prepare(`SELECT d.*,o.name organization_name,c.first_name||' '||c.last_name contact_name,u.name owner_name
    FROM deals d LEFT JOIN organizations o ON o.id=d.organization_id LEFT JOIN contacts c ON c.id=d.primary_contact_id LEFT JOIN users u ON u.id=d.owner_id
    WHERE ${conditions.join(' AND ')} ORDER BY CASE d.stage WHEN 'negotiation' THEN 1 WHEN 'proposal' THEN 2 WHEN 'discovery' THEN 3 WHEN 'qualified' THEN 4 WHEN 'lead' THEN 5 ELSE 6 END,d.expected_close_date`).bind(...bindings).all();
  return rows.results;
}
async function createDeal(env,ctx,request){requireRole(ctx.user,ctx.workspace,['admin','manager','member']);const data=await bodyJson(request);if(!text(data.name))throw new Error('Deal name is required');const dealId=id();const stage=text(data.stage,'lead');await env.DB.prepare(`INSERT INTO deals (id,workspace_id,name,organization_id,primary_contact_id,owner_id,stage,value,currency,probability,expected_close_date,closed_at,loss_reason,description,next_step,competitor,source,close_reason)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(dealId,ctx.workspace.id,text(data.name),text(data.organization_id),text(data.primary_contact_id),text(data.owner_id,ctx.user.id),stage,Number(data.value||0),text(data.currency,ctx.workspace.currency||'EUR'),clamp(data.probability??STAGE_PROBABILITIES[stage]??10,0,100),text(data.expected_close_date),['won','lost'].includes(stage)?nowIso():null,text(data.loss_reason),text(data.description),text(data.next_step),text(data.competitor),text(data.source),text(data.close_reason)).run();const created=await env.DB.prepare('SELECT * FROM deals WHERE id=? AND workspace_id=?').bind(dealId,ctx.workspace.id).first();await audit(env,ctx,request,'create','deal',dealId,null,created);return created;}
async function updateDeal(env,ctx,request,dealId){requireRole(ctx.user,ctx.workspace,['admin','manager','member']);const before=await env.DB.prepare('SELECT * FROM deals WHERE id=? AND workspace_id=?').bind(dealId,ctx.workspace.id).first();if(!before)throw Object.assign(new Error('Deal not found'),{status:404});const data=await bodyJson(request);const allowed=['name','organization_id','primary_contact_id','owner_id','stage','value','currency','probability','expected_close_date','loss_reason','description','next_step','competitor','source','close_reason'];const sets=[];const values=[];for(const key of allowed)if(Object.hasOwn(data,key)){sets.push(`${key}=?`);values.push(key==='value'?Number(data[key]||0):key==='probability'?clamp(data[key],0,100):text(data[key]));}if(Object.hasOwn(data,'stage')){sets.push('closed_at=?');values.push(['won','lost'].includes(data.stage)?nowIso():null);if(!Object.hasOwn(data,'probability')){sets.push('probability=?');values.push(STAGE_PROBABILITIES[data.stage]??before.probability);}}sets.push('updated_at=CURRENT_TIMESTAMP');await env.DB.prepare(`UPDATE deals SET ${sets.join(',')} WHERE id=? AND workspace_id=?`).bind(...values,dealId,ctx.workspace.id).run();const after=await env.DB.prepare('SELECT * FROM deals WHERE id=?').bind(dealId).first();await audit(env,ctx,request,'update','deal',dealId,before,after);return after;}

async function listTasks(env,ctx,request){const url=new URL(request.url);const conditions=['t.workspace_id=?'];const bindings=[ctx.workspace.id];for(const [param,column] of [['status','t.status'],['assignee','t.assignee_id'],['account','t.organization_id'],['contact','t.contact_id'],['type','t.task_type']]){const value=text(url.searchParams.get(param),'');if(value){conditions.push(`${column}=?`);bindings.push(value);}}const q=text(url.searchParams.get('q'),'');if(q){conditions.push('(lower(t.title) LIKE ? OR lower(t.description) LIKE ?)');const m=`%${q.toLowerCase()}%`;bindings.push(m,m);}const rows=await env.DB.prepare(`SELECT t.*,c.first_name||' '||c.last_name contact_name,o.name organization_name,d.name deal_name,u.name assignee_name
FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id LEFT JOIN organizations o ON o.id=t.organization_id LEFT JOIN deals d ON d.id=t.deal_id LEFT JOIN users u ON u.id=t.assignee_id
WHERE ${conditions.join(' AND ')} ORDER BY CASE t.status WHEN 'in_progress' THEN 1 WHEN 'open' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,t.due_at`).bind(...bindings).all();return rows.results;}
async function createTask(env,ctx,request,dataOverride){requireRole(ctx.user,ctx.workspace,['admin','manager','member']);const data=dataOverride||await bodyJson(request);if(!text(data.title))throw new Error('Task title is required');const taskId=id();await env.DB.prepare(`INSERT INTO tasks (id,workspace_id,title,description,contact_id,organization_id,deal_id,assignee_id,priority,status,due_at,completed_at,task_type,start_at,reminder_at,recurring_rule,parent_task_id,estimated_minutes,position)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(taskId,ctx.workspace.id,text(data.title),text(data.description),text(data.contact_id),text(data.organization_id),text(data.deal_id),text(data.assignee_id,ctx.user.id),text(data.priority,'medium'),text(data.status,'open'),toIsoDate(data.due_at),data.status==='completed'?nowIso():null,text(data.task_type,'task'),toIsoDate(data.start_at),toIsoDate(data.reminder_at),text(data.recurring_rule,'none'),text(data.parent_task_id),Number(data.estimated_minutes||0)||null,Number(data.position||0)).run();const created=await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(taskId).first();if(!dataOverride)await audit(env,ctx,request,'create','task',taskId,null,created);return created;}
async function updateTask(env,ctx,request,taskId){requireRole(ctx.user,ctx.workspace,['admin','manager','member']);const before=await env.DB.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=?').bind(taskId,ctx.workspace.id).first();if(!before)throw Object.assign(new Error('Task not found'),{status:404});const data=await bodyJson(request);const allowed=['title','description','contact_id','organization_id','deal_id','assignee_id','priority','status','due_at','task_type','start_at','reminder_at','recurring_rule','estimated_minutes','position'];const sets=[];const values=[];for(const key of allowed)if(Object.hasOwn(data,key)){sets.push(`${key}=?`);values.push(['due_at','start_at','reminder_at'].includes(key)?toIsoDate(data[key]):key==='estimated_minutes'||key==='position'?Number(data[key]||0):text(data[key]));}if(data.status==='completed'&&before.status!=='completed'){sets.push('completed_at=?');values.push(nowIso());}if(data.status&&data.status!=='completed'){sets.push('completed_at=NULL');}sets.push('updated_at=CURRENT_TIMESTAMP');await env.DB.prepare(`UPDATE tasks SET ${sets.join(',')} WHERE id=? AND workspace_id=?`).bind(...values,taskId,ctx.workspace.id).run();if(data.status==='completed'&&before.status!=='completed'&&before.recurring_rule&&before.recurring_rule!=='none'){const next=nextRecurringDate(before.due_at||nowIso(),before.recurring_rule);if(next)await createTask(env,ctx,request,{...before,id:undefined,status:'open',due_at:next,parent_task_id:before.parent_task_id||before.id},true);}const after=await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(taskId).first();await audit(env,ctx,request,'update','task',taskId,before,after);return after;}

async function listFollowUps(env,ctx,request){const url=new URL(request.url);const conditions=['f.workspace_id=?'];const bindings=[ctx.workspace.id];for(const [param,column] of [['status','f.status'],['owner','f.owner_id'],['account','f.organization_id'],['contact','f.contact_id'],['channel','f.channel'],['priority','f.priority']]){const value=text(url.searchParams.get(param),'');if(value){conditions.push(`${column}=?`);bindings.push(value);}}const bucket=text(url.searchParams.get('bucket'),'');if(bucket==='overdue')conditions.push("COALESCE(f.snoozed_until,f.due_at)<datetime('now') AND f.status IN ('open','snoozed')");if(bucket==='today')conditions.push("date(COALESCE(f.snoozed_until,f.due_at))=date('now') AND f.status IN ('open','snoozed')");if(bucket==='upcoming')conditions.push("date(COALESCE(f.snoozed_until,f.due_at))>date('now') AND date(COALESCE(f.snoozed_until,f.due_at))<=date('now','+7 days') AND f.status IN ('open','snoozed')");const rows=await env.DB.prepare(`SELECT f.*,c.first_name||' '||c.last_name contact_name,o.name organization_name,d.name deal_name,u.name owner_name,COALESCE(f.snoozed_until,f.due_at) effective_due_at
FROM follow_ups f LEFT JOIN contacts c ON c.id=f.contact_id LEFT JOIN organizations o ON o.id=f.organization_id LEFT JOIN deals d ON d.id=f.deal_id LEFT JOIN users u ON u.id=f.owner_id
WHERE ${conditions.join(' AND ')} ORDER BY CASE f.status WHEN 'open' THEN 1 WHEN 'snoozed' THEN 2 ELSE 3 END,effective_due_at`).bind(...bindings).all();return rows.results;}
async function createFollowUp(env,ctx,request,dataOverride,skipAudit=false){requireRole(ctx.user,ctx.workspace,['admin','manager','member']);const data=dataOverride||await bodyJson(request);if(!text(data.title))throw new Error('Follow-up title is required');if(!toIsoDate(data.due_at))throw new Error('Follow-up date is required');const followUpId=id();await env.DB.prepare(`INSERT INTO follow_ups (id,workspace_id,contact_id,organization_id,deal_id,owner_id,title,channel,status,priority,due_at,snoozed_until,completed_at,cadence,notes,created_by)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(followUpId,ctx.workspace.id,text(data.contact_id),text(data.organization_id),text(data.deal_id),text(data.owner_id,ctx.user.id),text(data.title),text(data.channel,'email'),text(data.status,'open'),text(data.priority,'medium'),toIsoDate(data.due_at),toIsoDate(data.snoozed_until),data.status==='completed'?nowIso():null,text(data.cadence,'none'),text(data.notes),ctx.user.id).run();if(data.contact_id)await env.DB.prepare('UPDATE contacts SET next_follow_up_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(toIsoDate(data.due_at),data.contact_id,ctx.workspace.id).run();const created=await env.DB.prepare('SELECT * FROM follow_ups WHERE id=?').bind(followUpId).first();if(!skipAudit)await audit(env,ctx,request,'create','follow_up',followUpId,null,created);return created;}
async function completeFollowUp(env,ctx,request,followUpId,options={}){requireRole(ctx.user,ctx.workspace,['admin','manager','member']);const before=await env.DB.prepare('SELECT * FROM follow_ups WHERE id=? AND workspace_id=?').bind(followUpId,ctx.workspace.id).first();if(!before)throw Object.assign(new Error('Follow-up not found'),{status:404});const data=options.skipBody?{}:await bodyJson(request).catch(()=>({}));await env.DB.prepare("UPDATE follow_ups SET status='completed',completed_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(nowIso(),followUpId,ctx.workspace.id).run();if(before.cadence&&before.cadence!=='none'){const next=nextRecurringDate(before.due_at,before.cadence);if(next)await createFollowUp(env,ctx,request,{...before,status:'open',due_at:next,snoozed_until:null,completed_at:null},true);}if(data.log_activity){await createActivity(env,ctx,new Request(request.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...data.log_activity,contact_id:before.contact_id,organization_id:before.organization_id,deal_id:before.deal_id,follow_up_id:followUpId})}));}const after=await env.DB.prepare('SELECT * FROM follow_ups WHERE id=?').bind(followUpId).first();await audit(env,ctx,request,'complete','follow_up',followUpId,before,after);return after;}
async function snoozeFollowUp(env,ctx,request,followUpId){requireRole(ctx.user,ctx.workspace,['admin','manager','member']);const data=await bodyJson(request);const until=toIsoDate(data.until);if(!until)throw new Error('A valid snooze date is required');const before=await env.DB.prepare('SELECT * FROM follow_ups WHERE id=? AND workspace_id=?').bind(followUpId,ctx.workspace.id).first();if(!before)throw Object.assign(new Error('Follow-up not found'),{status:404});await env.DB.prepare("UPDATE follow_ups SET status='snoozed',snoozed_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(until,followUpId,ctx.workspace.id).run();const after=await env.DB.prepare('SELECT * FROM follow_ups WHERE id=?').bind(followUpId).first();await audit(env,ctx,request,'snooze','follow_up',followUpId,before,after);return after;}
async function updateFollowUp(env,ctx,request,followUpId){requireRole(ctx.user,ctx.workspace,['admin','manager','member']);const before=await env.DB.prepare('SELECT * FROM follow_ups WHERE id=? AND workspace_id=?').bind(followUpId,ctx.workspace.id).first();if(!before)throw Object.assign(new Error('Follow-up not found'),{status:404});const data=await bodyJson(request);const allowed=['title','contact_id','organization_id','deal_id','owner_id','channel','status','priority','due_at','snoozed_until','cadence','notes'];const sets=[];const values=[];for(const key of allowed)if(Object.hasOwn(data,key)){sets.push(`${key}=?`);values.push(['due_at','snoozed_until'].includes(key)?toIsoDate(data[key]):text(data[key]));}sets.push('updated_at=CURRENT_TIMESTAMP');await env.DB.prepare(`UPDATE follow_ups SET ${sets.join(',')} WHERE id=? AND workspace_id=?`).bind(...values,followUpId,ctx.workspace.id).run();const after=await env.DB.prepare('SELECT * FROM follow_ups WHERE id=?').bind(followUpId).first();await audit(env,ctx,request,'update','follow_up',followUpId,before,after);return after;}

async function analytics(env,ctx){const ws=ctx.workspace.id;const [activityTypes,users,months,followUpStats,taskStats,conversion,accounts]=await Promise.all([
  env.DB.prepare('SELECT type,COUNT(*) count FROM activities WHERE workspace_id=? AND occurred_at>=datetime(\'now\',\'-90 days\') GROUP BY type ORDER BY count DESC').bind(ws).all(),
  env.DB.prepare(`SELECT u.name,COUNT(a.id) activities FROM users u LEFT JOIN activities a ON a.user_id=u.id AND a.workspace_id=? AND a.occurred_at>=datetime('now','-30 days') JOIN workspace_members wm ON wm.user_id=u.id AND wm.workspace_id=? GROUP BY u.id ORDER BY activities DESC`).bind(ws,ws).all(),
  env.DB.prepare(`WITH RECURSIVE months(month) AS (SELECT date('now','start of month','-5 months') UNION ALL SELECT date(month,'+1 month') FROM months WHERE month<date('now','start of month')) SELECT months.month,COALESCE(SUM(CASE WHEN d.stage='won' THEN d.value ELSE 0 END),0) won_value,COUNT(CASE WHEN d.stage='won' THEN 1 END) won_count FROM months LEFT JOIN deals d ON d.workspace_id=? AND date(d.closed_at,'start of month')=months.month GROUP BY months.month`).bind(ws).all(),
  env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,SUM(CASE WHEN status IN ('open','snoozed') AND COALESCE(snoozed_until,due_at)<datetime('now') THEN 1 ELSE 0 END) overdue FROM follow_ups WHERE workspace_id=?`).bind(ws).first(),
  env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,SUM(CASE WHEN status NOT IN ('completed','cancelled') AND due_at<datetime('now') THEN 1 ELSE 0 END) overdue FROM tasks WHERE workspace_id=?`).bind(ws).first(),
  env.DB.prepare(`SELECT stage,COUNT(*) count,COALESCE(SUM(value),0) value FROM deals WHERE workspace_id=? GROUP BY stage`).bind(ws).all(),
  env.DB.prepare(`SELECT o.id,o.name,o.account_tier,o.relationship_score,COUNT(DISTINCT c.id) contacts,COUNT(DISTINCT a.id) activities,COALESCE(SUM(DISTINCT CASE WHEN d.stage NOT IN ('lost') THEN d.value ELSE 0 END),0) pipeline FROM organizations o LEFT JOIN contacts c ON c.organization_id=o.id LEFT JOIN activities a ON a.organization_id=o.id AND a.occurred_at>=datetime('now','-90 days') LEFT JOIN deals d ON d.organization_id=o.id WHERE o.workspace_id=? GROUP BY o.id ORDER BY pipeline DESC LIMIT 10`).bind(ws).all(),
]);return{activity_types:activityTypes.results,users:users.results,revenue_by_month:months.results,follow_up_stats:followUpStats,task_stats:taskStats,conversion:conversion.results,top_accounts:accounts.results};}

async function globalSearch(env,ctx,request){const q=text(new URL(request.url).searchParams.get('q'),'');if(q.length<2)return{contacts:[],organizations:[],deals:[]};const m=`%${q.toLowerCase()}%`;const [contacts,organizations,deals]=await Promise.all([
  env.DB.prepare("SELECT id,first_name,last_name,email,job_title FROM contacts WHERE workspace_id=? AND (lower(first_name||' '||last_name) LIKE ? OR lower(email) LIKE ?) LIMIT 8").bind(ctx.workspace.id,m,m).all(),
  env.DB.prepare('SELECT id,name,industry,type FROM organizations WHERE workspace_id=? AND lower(name) LIKE ? LIMIT 8').bind(ctx.workspace.id,m).all(),
  env.DB.prepare('SELECT id,name,stage,value,currency FROM deals WHERE workspace_id=? AND lower(name) LIKE ? LIMIT 8').bind(ctx.workspace.id,m).all(),
]);return{contacts:contacts.results,organizations:organizations.results,deals:deals.results};}

async function listUsers(env,ctx){const rows=await env.DB.prepare(`SELECT u.id,u.name,u.email,u.avatar_url,wm.role,wm.is_default FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=? AND u.is_active=1 ORDER BY u.name`).bind(ctx.workspace.id).all();return rows.results;}
async function listSavedViews(env,ctx,request){const entity=text(new URL(request.url).searchParams.get('entity'),'');const rows=await env.DB.prepare(`SELECT * FROM saved_views WHERE workspace_id=? AND user_id=? ${entity?'AND entity_type=?':''} ORDER BY is_default DESC,name`).bind(...(entity?[ctx.workspace.id,ctx.user.id,entity]:[ctx.workspace.id,ctx.user.id])).all();return rows.results.map(savedViewRecord);}
async function createSavedView(env,ctx,request){const data=await bodyJson(request);if(!text(data.name)||!text(data.entity_type))throw new Error('Name and entity type are required');const viewId=id();await env.DB.prepare('INSERT INTO saved_views (id,workspace_id,user_id,entity_type,name,filters_json,sort_json,is_default) VALUES (?,?,?,?,?,?,?,?)').bind(viewId,ctx.workspace.id,ctx.user.id,data.entity_type,data.name,JSON.stringify(data.filters||{}),JSON.stringify(data.sort||{}),bool(data.is_default)).run();return savedViewRecord(await env.DB.prepare('SELECT * FROM saved_views WHERE id=?').bind(viewId).first());}

async function createWorkspace(env,ctx,request){requireRole(ctx.user,ctx.workspace,['admin']);const data=await bodyJson(request);if(!text(data.name))throw new Error('Workspace name is required');const workspaceId=id();let slug=slugify(data.slug||data.name)||`workspace-${workspaceId.slice(0,8)}`;const collision=await env.DB.prepare('SELECT 1 FROM workspaces WHERE slug=?').bind(slug).first();if(collision)slug=`${slug}-${workspaceId.slice(0,6)}`;await env.DB.prepare('INSERT INTO workspaces (id,name,slug,description,timezone,currency,color,created_by) VALUES (?,?,?,?,?,?,?,?)').bind(workspaceId,data.name,slug,text(data.description),text(data.timezone,'Europe/Amsterdam'),text(data.currency,'EUR'),text(data.color,'#0f766e'),ctx.user.id).run();await env.DB.prepare('INSERT INTO workspace_members (workspace_id,user_id,role,is_default) VALUES (?,?,?,0)').bind(workspaceId,ctx.user.id,'admin').run();return await env.DB.prepare('SELECT * FROM workspaces WHERE id=?').bind(workspaceId).first();}
async function updateWorkspace(env,ctx,request,workspaceId){requireRole(ctx.user,ctx.workspace,['admin']);if(workspaceId!==ctx.workspace.id&&ctx.user.role!=='admin')throw Object.assign(new Error('Cannot edit this workspace'),{status:403});const data=await bodyJson(request);const allowed=['name','description','timezone','currency','color','is_active'];const sets=[];const values=[];for(const key of allowed)if(Object.hasOwn(data,key)){sets.push(`${key}=?`);values.push(key==='is_active'?bool(data[key]):text(data[key]));}sets.push('updated_at=CURRENT_TIMESTAMP');await env.DB.prepare(`UPDATE workspaces SET ${sets.join(',')} WHERE id=?`).bind(...values,workspaceId).run();return await env.DB.prepare('SELECT * FROM workspaces WHERE id=?').bind(workspaceId).first();}

async function importContacts(env,ctx,request){requireRole(ctx.user,ctx.workspace,['admin','manager','member']);const data=await bodyJson(request);const rows=parseCsv(data.csv||'');if(!rows.length)throw new Error('The CSV contains no contact rows');let success=0;const errors=[];for(let index=0;index<rows.length;index+=1){const row=rows[index];try{if(!text(row.first_name))throw new Error('first_name is required');let organizationId=null;if(row.organization){let org=await env.DB.prepare('SELECT id FROM organizations WHERE workspace_id=? AND lower(name)=lower(?)').bind(ctx.workspace.id,row.organization).first();if(!org){organizationId=id();await env.DB.prepare('INSERT INTO organizations (id,workspace_id,name,type,owner_id) VALUES (?,?,?,?,?)').bind(organizationId,ctx.workspace.id,row.organization,'prospect',ctx.user.id).run();}else organizationId=org.id;}await env.DB.prepare(`INSERT INTO contacts (id,workspace_id,organization_id,first_name,last_name,job_title,email,phone,lifecycle_stage,owner_id,source,notes,tags_json,consent_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id(),ctx.workspace.id,organizationId,row.first_name,row.last_name||'',text(row.job_title),text(row.email),text(row.phone),text(row.lifecycle_stage,'lead'),ctx.user.id,text(row.source),text(row.notes),JSON.stringify(normalizeTags(String(row.tags||'').replaceAll(';',','))),text(row.consent_status,'unknown')).run();success+=1;}catch(e){errors.push({row:index+2,error:e.message});}}
const importId=id();await env.DB.prepare('INSERT INTO imports (id,user_id,file_name,entity_type,row_count,success_count,failure_count,errors_json,workspace_id) VALUES (?,?,?,?,?,?,?,?,?)').bind(importId,ctx.user.id,text(data.file_name,'contacts.csv'),'contacts',rows.length,success,errors.length,JSON.stringify(errors),ctx.workspace.id).run();return{id:importId,row_count:rows.length,success_count:success,failure_count:errors.length,errors};}
async function exportContacts(env,ctx){const rows=await env.DB.prepare(`SELECT c.*,o.name organization FROM contacts c LEFT JOIN organizations o ON o.id=c.organization_id WHERE c.workspace_id=? ORDER BY c.first_name,c.last_name`).bind(ctx.workspace.id).all();return new Response(contactsToCsv(rows.results.map(contactRecord)),{headers:{...SECURITY_HEADERS,'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="${ctx.workspace.slug}-contacts.csv"`}});}

async function uploadAttachment(env,ctx,request){requireRole(ctx.user,ctx.workspace,['admin','manager','member']);if(!env.ATTACHMENTS)throw Object.assign(new Error('R2 attachment storage is not configured'),{status:503});const form=await request.formData();const file=form.get('file');if(!(file instanceof File))throw new Error('A file is required');if(file.size>20*1024*1024)throw new Error('Files may not exceed 20 MB');const attachmentId=id();const key=`${ctx.workspace.id}/${new Date().toISOString().slice(0,10)}/${attachmentId}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;await env.ATTACHMENTS.put(key,file.stream(),{httpMetadata:{contentType:file.type||'application/octet-stream'}});await env.DB.prepare('INSERT INTO attachments (id,workspace_id,activity_id,contact_id,organization_id,uploaded_by,r2_key,file_name,mime_type,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(attachmentId,ctx.workspace.id,text(form.get('activity_id')),text(form.get('contact_id')),text(form.get('organization_id')),ctx.user.id,key,file.name,file.type,file.size).run();return{id:attachmentId,file_name:file.name,mime_type:file.type,size_bytes:file.size};}
async function downloadAttachment(env,ctx,attachmentId){const row=await env.DB.prepare('SELECT * FROM attachments WHERE id=? AND workspace_id=?').bind(attachmentId,ctx.workspace.id).first();if(!row)throw Object.assign(new Error('Attachment not found'),{status:404});const object=await env.ATTACHMENTS.get(row.r2_key);if(!object)throw Object.assign(new Error('Attachment file is missing'),{status:404});return new Response(object.body,{headers:{...SECURITY_HEADERS,'content-type':row.mime_type||'application/octet-stream','content-disposition':`attachment; filename="${row.file_name.replaceAll('"','')}"`}});}

async function recalculateContact(env,workspaceId,contactId){const row=await env.DB.prepare(`SELECT c.id,c.last_contact_at,c.next_follow_up_at,
(SELECT COUNT(*) FROM activities a WHERE a.contact_id=c.id) activity_count,
(SELECT COALESCE(SUM(value),0) FROM deals d WHERE d.primary_contact_id=c.id AND d.stage NOT IN ('won','lost')) open_deal_value,
(SELECT COUNT(*) FROM tasks t WHERE t.contact_id=c.id AND t.status='completed') completed_tasks,
(SELECT COUNT(*) FROM tasks t WHERE t.contact_id=c.id AND t.status NOT IN ('completed','cancelled') AND t.due_at<datetime('now')) overdue_tasks,
(SELECT COUNT(*) FROM follow_ups f WHERE f.contact_id=c.id AND f.status IN ('open','snoozed') AND COALESCE(f.snoozed_until,f.due_at)<datetime('now')) overdue_follow_ups
FROM contacts c WHERE c.id=? AND c.workspace_id=?`).bind(contactId,workspaceId).first();if(!row)return;const {relationshipHealth}=await import('./lib/domain.js');const score=relationshipHealth({lastContactAt:row.last_contact_at,nextFollowUpAt:row.next_follow_up_at,activityCount:row.activity_count,openDealValue:row.open_deal_value,completedTasks:row.completed_tasks,overdueTasks:row.overdue_tasks,overdueFollowUps:row.overdue_follow_ups});await env.DB.prepare('UPDATE contacts SET relationship_score=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?').bind(score,contactId,workspaceId).run();}

async function handleApi(request,env){const user=await currentUser(request,env);const wc=await workspaceContext(request,env,user);const ctx={user,...wc};const url=new URL(request.url);const p=parts(url.pathname);const method=request.method;
  if(p[1]==='me'&&method==='GET')return json(await me(env,ctx));
  if(p[1]==='dashboard'&&method==='GET')return json(await dashboard(env,ctx));
  if(p[1]==='agenda'&&method==='GET')return json(await agenda(env,ctx,request));
  if(p[1]==='search'&&method==='GET')return json(await globalSearch(env,ctx,request));
  if(p[1]==='analytics'&&method==='GET')return json(await analytics(env,ctx));
  if(p[1]==='users'&&method==='GET')return json(await listUsers(env,ctx));
  if(p[1]==='workspaces'&&method==='POST')return json(await createWorkspace(env,ctx,request),201);
  if(p[1]==='workspaces'&&p[2]&&method==='PATCH')return json(await updateWorkspace(env,ctx,request,p[2]));
  if(p[1]==='contacts'&&!p[2]&&method==='GET')return json(await listContacts(env,ctx,request));
  if(p[1]==='contacts'&&!p[2]&&method==='POST')return json(await createContact(env,ctx,request),201);
  if(p[1]==='contacts'&&p[2]&&method==='GET')return json(await getContact(env,ctx,p[2]));
  if(p[1]==='contacts'&&p[2]&&method==='PATCH')return json(await updateContact(env,ctx,request,p[2]));
  if(p[1]==='organizations'&&!p[2]&&method==='GET')return json(await listOrganizations(env,ctx,request));
  if(p[1]==='organizations'&&!p[2]&&method==='POST')return json(await createOrganization(env,ctx,request),201);
  if(p[1]==='organizations'&&p[2]&&method==='GET')return json(await getOrganization(env,ctx,p[2]));
  if(p[1]==='activities'&&!p[2]&&method==='GET')return json(await listActivities(env,ctx,request));
  if(p[1]==='activities'&&!p[2]&&method==='POST')return json(await createActivity(env,ctx,request),201);
  if(p[1]==='deals'&&!p[2]&&method==='GET')return json(await listDeals(env,ctx,request));
  if(p[1]==='deals'&&!p[2]&&method==='POST')return json(await createDeal(env,ctx,request),201);
  if(p[1]==='deals'&&p[2]&&method==='PATCH')return json(await updateDeal(env,ctx,request,p[2]));
  if(p[1]==='tasks'&&!p[2]&&method==='GET')return json(await listTasks(env,ctx,request));
  if(p[1]==='tasks'&&!p[2]&&method==='POST')return json(await createTask(env,ctx,request),201);
  if(p[1]==='tasks'&&p[2]&&method==='PATCH')return json(await updateTask(env,ctx,request,p[2]));
  if(p[1]==='follow-ups'&&!p[2]&&method==='GET')return json(await listFollowUps(env,ctx,request));
  if(p[1]==='follow-ups'&&!p[2]&&method==='POST')return json(await createFollowUp(env,ctx,request),201);
  if(p[1]==='follow-ups'&&p[2]&&method==='PATCH')return json(await updateFollowUp(env,ctx,request,p[2]));
  if(p[1]==='follow-ups'&&p[2]&&p[3]==='complete'&&method==='POST')return json(await completeFollowUp(env,ctx,request,p[2]));
  if(p[1]==='follow-ups'&&p[2]&&p[3]==='snooze'&&method==='POST')return json(await snoozeFollowUp(env,ctx,request,p[2]));
  if(p[1]==='saved-views'&&method==='GET')return json(await listSavedViews(env,ctx,request));
  if(p[1]==='saved-views'&&method==='POST')return json(await createSavedView(env,ctx,request),201);
  if(p[1]==='imports'&&p[2]==='contacts'&&method==='POST')return json(await importContacts(env,ctx,request),201);
  if(p[1]==='exports'&&p[2]==='contacts'&&method==='GET')return exportContacts(env,ctx);
  if(p[1]==='attachments'&&!p[2]&&method==='POST')return json(await uploadAttachment(env,ctx,request),201);
  if(p[1]==='attachments'&&p[2]&&method==='GET')return downloadAttachment(env,ctx,p[2]);
  if(p[1]==='email'&&p[2]==='senders'&&!p[3]&&method==='GET')return json(await listEmailSenders(env,ctx));
  if(p[1]==='email'&&p[2]==='senders'&&!p[3]&&method==='POST')return json(await createEmailSender(env,ctx,request),201);
  if(p[1]==='email'&&p[2]==='senders'&&p[3]&&method==='PATCH')return json(await updateEmailSender(env,ctx,request,p[3]));
  if(p[1]==='email'&&p[2]==='messages'&&method==='GET')return json(await listEmailMessages(env,ctx,request));
  if(p[1]==='email'&&p[2]==='send'&&method==='POST')return json(await sendCrmEmail(env,ctx,request),201);
  return error('API route not found',404);
}

export default {
  async fetch(request,env,executionContext){try{const url=new URL(request.url);if(url.pathname==='/health')return json({ok:true,service:'partnermarket-global-crm',version:'2.1.0',timestamp:nowIso()});if(url.pathname.startsWith('/api/'))return await handleApi(request,env);const response=await env.ASSETS.fetch(request);const headers=new Headers(response.headers);for(const [key,value] of Object.entries(SECURITY_HEADERS))headers.set(key,value);return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}catch(err){console.error(err);return error(err.message||'Unexpected server error',err.status||500);}},
  async queue(batch,env){for(const message of batch.messages){try{if(message.body?.type==='recalculate_contact')await recalculateContact(env,message.body.workspace_id,message.body.contact_id);message.ack();}catch(err){console.error('Queue processing failed',err);message.retry();}}},
  async scheduled(_event,env,ctx){ctx.waitUntil((async()=>{const rows=await env.DB.prepare("SELECT id,workspace_id FROM contacts WHERE status='active'").all();for(const row of rows.results||[])await recalculateContact(env,row.workspace_id,row.id);await env.DB.prepare("UPDATE follow_ups SET status='open',snoozed_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE status='snoozed' AND snoozed_until<=datetime('now')").run();})());},
};
