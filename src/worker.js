import {
  STAGE_PROBABILITIES,
  clamp,
  normalizeTags,
  parseCsv,
  parseJson,
  safeSort,
  toIsoDate,
} from './lib/domain.js';

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

function error(message, status = 400, details = undefined) {
  return json({ error: message, ...(details ? { details } : {}) }, status);
}

async function bodyJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('Expected application/json');
  return request.json();
}

function routeParts(pathname) {
  return pathname.split('/').filter(Boolean).map(decodeURIComponent);
}

function nowIso() {
  return new Date().toISOString();
}

function recordToContact(row) {
  return row ? {
    ...row,
    tags: parseJson(row.tags_json, []),
    custom_fields: parseJson(row.custom_fields_json, {}),
    organization: row.organization_name || null,
  } : null;
}

function recordToOrganization(row) {
  return row ? {
    ...row,
    tags: parseJson(row.tags_json, []),
    custom_fields: parseJson(row.custom_fields_json, {}),
  } : null;
}

function recordToActivity(row) {
  return row ? { ...row, metadata: parseJson(row.metadata_json, {}) } : null;
}

function b64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
}

async function accessKeys(env) {
  const cacheKey = 'access:jwks:v1';
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
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64UrlDecode(segments[2]),
    new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
  );
  if (!valid) throw new Error('Invalid access token signature');
  const now = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://${String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.exp && payload.exp < now) throw new Error('Access token expired');
  if (payload.nbf && payload.nbf > now) throw new Error('Access token not active');
  if (payload.iss !== expectedIssuer) throw new Error('Invalid access token issuer');
  if (env.ACCESS_AUD && !audiences.includes(env.ACCESS_AUD)) throw new Error('Invalid access token audience');
  return payload;
}

async function currentUser(request, env) {
  const mode = String(env.AUTH_MODE || 'access').toLowerCase();
  let identity;
  if (mode === 'dev' || mode === 'disabled') {
    identity = {
      email: request.headers.get('x-dev-user-email') || 'alex@example.com',
      name: request.headers.get('x-dev-user-name') || 'Alex de Vries',
    };
  } else {
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) throw Object.assign(new Error('Authentication required'), { status: 401 });
    const payload = await verifyAccessJwt(token, env);
    identity = { email: payload.email, name: payload.name || payload.email?.split('@')[0] || 'CRM User' };
  }
  if (!identity.email) throw Object.assign(new Error('Authenticated identity has no email'), { status: 401 });
  const existing = await env.DB.prepare('SELECT * FROM users WHERE lower(email) = lower(?) LIMIT 1').bind(identity.email).first();
  if (existing) {
    if (!existing.is_active) throw Object.assign(new Error('Your CRM account is disabled'), { status: 403 });
    return existing;
  }
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)').bind(id, identity.email, identity.name, 'member').run();
  return { id, email: identity.email, name: identity.name, role: 'member', is_active: 1 };
}

function requireRole(user, roles) {
  if (!roles.includes(user.role)) throw Object.assign(new Error('Insufficient permissions'), { status: 403 });
}

async function audit(env, user, request, action, entityType, entityId, before = null, after = null) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  let ipHash = null;
  if (ip) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    ipHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }
  await env.DB.prepare(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, before_json, after_json, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    crypto.randomUUID(), user.id, action, entityType, entityId,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    ipHash,
  ).run();
}

function track(env, user, event, entityType = '', entityId = '') {
  try {
    env.USAGE_ANALYTICS?.writeDataPoint({
      indexes: [user?.id || 'anonymous'],
      blobs: [event, entityType, entityId, user?.role || 'unknown'],
      doubles: [1, Date.now()],
    });
  } catch {
    // Analytics must never block CRM operations.
  }
}

async function enqueue(env, message) {
  if (!env.ACTIVITY_QUEUE) return;
  try {
    await env.ACTIVITY_QUEUE.send(message, { contentType: 'json' });
  } catch (queueError) {
    console.warn('Queue send failed', queueError);
  }
}

async function dashboard(env) {
  const [counts, pipeline, stages, activityByDay, tasks, recent, health, sources] = await Promise.all([
    env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM contacts WHERE status='active') AS contacts,
      (SELECT COUNT(*) FROM organizations WHERE status='active') AS organizations,
      (SELECT COUNT(*) FROM tasks WHERE status NOT IN ('completed','cancelled') AND due_at < datetime('now')) AS overdue_tasks,
      (SELECT COUNT(*) FROM contacts WHERE next_follow_up_at BETWEEN datetime('now') AND datetime('now','+7 days')) AS follow_ups,
      (SELECT COUNT(*) FROM activities WHERE occurred_at >= datetime('now','-30 days')) AS activities_30d`).first(),
    env.DB.prepare(`SELECT
      COALESCE(SUM(CASE WHEN stage NOT IN ('lost') THEN value ELSE 0 END),0) AS total_value,
      COALESCE(SUM(CASE WHEN stage NOT IN ('won','lost') THEN value * probability / 100.0 ELSE 0 END),0) AS weighted_value,
      COALESCE(SUM(CASE WHEN stage='won' THEN value ELSE 0 END),0) AS won_value,
      SUM(CASE WHEN stage='won' THEN 1 ELSE 0 END) AS won_count,
      SUM(CASE WHEN stage='lost' THEN 1 ELSE 0 END) AS lost_count
      FROM deals`).first(),
    env.DB.prepare(`SELECT stage, COUNT(*) AS count, COALESCE(SUM(value),0) AS value FROM deals GROUP BY stage`).all(),
    env.DB.prepare(`WITH RECURSIVE days(day) AS (
      SELECT date('now','-13 days') UNION ALL SELECT date(day,'+1 day') FROM days WHERE day < date('now')
    ) SELECT days.day, COUNT(activities.id) AS count FROM days LEFT JOIN activities ON date(activities.occurred_at)=days.day GROUP BY days.day ORDER BY days.day`).all(),
    env.DB.prepare(`SELECT tasks.*, contacts.first_name || ' ' || contacts.last_name AS contact_name, organizations.name AS organization_name
      FROM tasks LEFT JOIN contacts ON contacts.id=tasks.contact_id LEFT JOIN organizations ON organizations.id=tasks.organization_id
      WHERE tasks.status NOT IN ('completed','cancelled') ORDER BY CASE tasks.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, tasks.due_at LIMIT 8`).all(),
    env.DB.prepare(`SELECT activities.*, contacts.first_name || ' ' || contacts.last_name AS contact_name, organizations.name AS organization_name, users.name AS user_name
      FROM activities LEFT JOIN contacts ON contacts.id=activities.contact_id LEFT JOIN organizations ON organizations.id=activities.organization_id LEFT JOIN users ON users.id=activities.user_id
      ORDER BY occurred_at DESC LIMIT 10`).all(),
    env.DB.prepare(`SELECT
      SUM(CASE WHEN relationship_score >= 80 THEN 1 ELSE 0 END) AS strong,
      SUM(CASE WHEN relationship_score BETWEEN 55 AND 79 THEN 1 ELSE 0 END) AS healthy,
      SUM(CASE WHEN relationship_score BETWEEN 35 AND 54 THEN 1 ELSE 0 END) AS needs_attention,
      SUM(CASE WHEN relationship_score < 35 THEN 1 ELSE 0 END) AS at_risk
      FROM contacts WHERE status='active'`).first(),
    env.DB.prepare(`SELECT COALESCE(NULLIF(source,''),'Unknown') AS source, COUNT(*) AS count FROM contacts GROUP BY source ORDER BY count DESC LIMIT 6`).all(),
  ]);
  const closed = Number(pipeline.won_count || 0) + Number(pipeline.lost_count || 0);
  return {
    counts,
    pipeline: { ...pipeline, win_rate: closed ? Math.round(Number(pipeline.won_count || 0) / closed * 100) : 0 },
    stages: stages.results,
    activity_by_day: activityByDay.results,
    tasks: tasks.results,
    recent_activities: recent.results.map(recordToActivity),
    health,
    sources: sources.results,
  };
}

async function listContacts(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const stage = url.searchParams.get('stage') || '';
  const owner = url.searchParams.get('owner') || '';
  const tag = (url.searchParams.get('tag') || '').trim().toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const pageSize = Math.round(clamp(url.searchParams.get('pageSize') || 25, 1, 100));
  const sort = safeSort(url.searchParams.get('sort'), ['name','organization','last_contact','score','follow_up','created'], 'last_contact');
  const order = url.searchParams.get('order') === 'asc' ? 'ASC' : 'DESC';
  const sortSql = {
    name: 'contacts.first_name', organization: 'organizations.name', last_contact: 'contacts.last_contact_at', score: 'contacts.relationship_score', follow_up: 'contacts.next_follow_up_at', created: 'contacts.created_at',
  }[sort];
  const conditions = ['1=1'];
  const bindings = [];
  if (q) {
    conditions.push(`(lower(contacts.first_name || ' ' || contacts.last_name) LIKE ? OR lower(contacts.email) LIKE ? OR lower(organizations.name) LIKE ? OR lower(contacts.job_title) LIKE ?)`);
    const match = `%${q.toLowerCase()}%`;
    bindings.push(match, match, match, match);
  }
  if (stage) { conditions.push('contacts.lifecycle_stage = ?'); bindings.push(stage); }
  if (owner) { conditions.push('contacts.owner_id = ?'); bindings.push(owner); }
  if (tag) { conditions.push('lower(contacts.tags_json) LIKE ?'); bindings.push(`%"${tag}"%`); }
  const where = conditions.join(' AND ');
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM contacts LEFT JOIN organizations ON organizations.id=contacts.organization_id WHERE ${where}`).bind(...bindings).first();
  const result = await env.DB.prepare(`SELECT contacts.*, organizations.name AS organization_name, users.name AS owner_name,
      (SELECT COUNT(*) FROM activities WHERE activities.contact_id=contacts.id) AS activity_count,
      (SELECT COALESCE(SUM(value),0) FROM deals WHERE deals.primary_contact_id=contacts.id AND deals.stage NOT IN ('won','lost')) AS open_deal_value
    FROM contacts
    LEFT JOIN organizations ON organizations.id=contacts.organization_id
    LEFT JOIN users ON users.id=contacts.owner_id
    WHERE ${where}
    ORDER BY ${sortSql} ${order} NULLS LAST
    LIMIT ? OFFSET ?`).bind(...bindings, pageSize, (page - 1) * pageSize).all();
  return { items: result.results.map(recordToContact), page, pageSize, total: Number(count.total || 0), pages: Math.max(1, Math.ceil(Number(count.total || 0) / pageSize)) };
}

async function getContact(env, id) {
  const contact = await env.DB.prepare(`SELECT contacts.*, organizations.name AS organization_name, users.name AS owner_name
    FROM contacts LEFT JOIN organizations ON organizations.id=contacts.organization_id LEFT JOIN users ON users.id=contacts.owner_id WHERE contacts.id=?`).bind(id).first();
  if (!contact) return null;
  const [activities, tasks, deals, attachments] = await Promise.all([
    env.DB.prepare(`SELECT activities.*, users.name AS user_name FROM activities LEFT JOIN users ON users.id=activities.user_id WHERE contact_id=? ORDER BY occurred_at DESC LIMIT 100`).bind(id).all(),
    env.DB.prepare(`SELECT * FROM tasks WHERE contact_id=? ORDER BY status, due_at`).bind(id).all(),
    env.DB.prepare(`SELECT * FROM deals WHERE primary_contact_id=? ORDER BY updated_at DESC`).bind(id).all(),
    env.DB.prepare(`SELECT id, activity_id, file_name, mime_type, size_bytes, created_at FROM attachments WHERE contact_id=? ORDER BY created_at DESC`).bind(id).all(),
  ]);
  return { ...recordToContact(contact), activities: activities.results.map(recordToActivity), tasks: tasks.results, deals: deals.results, attachments: attachments.results };
}

async function createContact(request, env, user) {
  const input = await bodyJson(request);
  if (!String(input.first_name || '').trim()) return error('First name is required');
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const contact = {
    id,
    organization_id: input.organization_id || null,
    first_name: String(input.first_name).trim(),
    last_name: String(input.last_name || '').trim(),
    job_title: input.job_title || null,
    email: input.email ? String(input.email).trim().toLowerCase() : null,
    phone: input.phone || null,
    mobile: input.mobile || null,
    linkedin_url: input.linkedin_url || null,
    preferred_channel: input.preferred_channel || 'email',
    lifecycle_stage: input.lifecycle_stage || 'lead',
    status: input.status || 'active',
    owner_id: input.owner_id || user.id,
    relationship_score: Math.round(clamp(input.relationship_score ?? 50, 0, 100)),
    source: input.source || null,
    timezone: input.timezone || null,
    birthday: input.birthday || null,
    last_contact_at: toIsoDate(input.last_contact_at),
    next_follow_up_at: toIsoDate(input.next_follow_up_at),
    notes: input.notes || null,
    tags_json: JSON.stringify(normalizeTags(input.tags)),
    custom_fields_json: JSON.stringify(input.custom_fields || {}),
    created_at: timestamp,
    updated_at: timestamp,
  };
  await env.DB.prepare(`INSERT INTO contacts (id, organization_id, first_name, last_name, job_title, email, phone, mobile, linkedin_url, preferred_channel, lifecycle_stage, status, owner_id, relationship_score, source, timezone, birthday, last_contact_at, next_follow_up_at, notes, tags_json, custom_fields_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...Object.values(contact)).run();
  await audit(env, user, request, 'create', 'contact', id, null, contact);
  await enqueue(env, { type: 'contact.created', entityId: id, userId: user.id, at: timestamp });
  track(env, user, 'create', 'contact', id);
  return json(await getContact(env, id), 201);
}

async function updateContact(request, env, user, id) {
  const before = await env.DB.prepare('SELECT * FROM contacts WHERE id=?').bind(id).first();
  if (!before) return error('Contact not found', 404);
  const input = await bodyJson(request);
  const allowed = ['organization_id','first_name','last_name','job_title','email','phone','mobile','linkedin_url','preferred_channel','lifecycle_stage','status','owner_id','relationship_score','source','timezone','birthday','last_contact_at','next_follow_up_at','notes'];
  const updates = [];
  const bindings = [];
  for (const field of allowed) {
    if (Object.hasOwn(input, field)) {
      updates.push(`${field}=?`);
      let value = input[field];
      if (field === 'email' && value) value = String(value).trim().toLowerCase();
      if (field === 'relationship_score') value = Math.round(clamp(value, 0, 100));
      if (['last_contact_at','next_follow_up_at'].includes(field)) value = toIsoDate(value);
      bindings.push(value === '' ? null : value);
    }
  }
  if (Object.hasOwn(input, 'tags')) { updates.push('tags_json=?'); bindings.push(JSON.stringify(normalizeTags(input.tags))); }
  if (Object.hasOwn(input, 'custom_fields')) { updates.push('custom_fields_json=?'); bindings.push(JSON.stringify(input.custom_fields || {})); }
  if (!updates.length) return error('No fields to update');
  updates.push('updated_at=?'); bindings.push(nowIso(), id);
  await env.DB.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id=?`).bind(...bindings).run();
  const after = await env.DB.prepare('SELECT * FROM contacts WHERE id=?').bind(id).first();
  await audit(env, user, request, 'update', 'contact', id, before, after);
  await enqueue(env, { type: 'contact.updated', entityId: id, userId: user.id, at: nowIso() });
  track(env, user, 'update', 'contact', id);
  return json(await getContact(env, id));
}

async function deleteContact(request, env, user, id) {
  requireRole(user, ['admin','manager']);
  const before = await env.DB.prepare('SELECT * FROM contacts WHERE id=?').bind(id).first();
  if (!before) return error('Contact not found', 404);
  await env.DB.prepare('DELETE FROM contacts WHERE id=?').bind(id).run();
  await audit(env, user, request, 'delete', 'contact', id, before, null);
  track(env, user, 'delete', 'contact', id);
  return json({ ok: true });
}

async function createActivity(request, env, user, contactId = null) {
  const input = await bodyJson(request);
  if (!input.subject) return error('Activity subject is required');
  const id = crypto.randomUUID();
  const occurredAt = toIsoDate(input.occurred_at, nowIso());
  const activity = {
    id,
    contact_id: contactId || input.contact_id || null,
    organization_id: input.organization_id || null,
    user_id: user.id,
    type: input.type || 'note',
    direction: input.direction || 'internal',
    subject: String(input.subject).trim(),
    body: input.body || null,
    outcome: input.outcome || null,
    occurred_at: occurredAt,
    duration_minutes: input.duration_minutes ? Number(input.duration_minutes) : null,
    metadata_json: JSON.stringify(input.metadata || {}),
  };
  await env.DB.prepare(`INSERT INTO activities (id, contact_id, organization_id, user_id, type, direction, subject, body, outcome, occurred_at, duration_minutes, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...Object.values(activity)).run();
  if (activity.contact_id) {
    await env.DB.prepare(`UPDATE contacts SET last_contact_at = CASE WHEN last_contact_at IS NULL OR last_contact_at < ? THEN ? ELSE last_contact_at END,
      next_follow_up_at = COALESCE(?, next_follow_up_at), updated_at=? WHERE id=?`).bind(occurredAt, occurredAt, toIsoDate(input.next_follow_up_at), nowIso(), activity.contact_id).run();
  }
  if (activity.organization_id) {
    await env.DB.prepare(`UPDATE organizations SET last_contact_at = CASE WHEN last_contact_at IS NULL OR last_contact_at < ? THEN ? ELSE last_contact_at END,
      next_follow_up_at = COALESCE(?, next_follow_up_at), updated_at=? WHERE id=?`).bind(occurredAt, occurredAt, toIsoDate(input.next_follow_up_at), nowIso(), activity.organization_id).run();
  }
  await audit(env, user, request, 'create', 'activity', id, null, activity);
  await enqueue(env, { type: 'activity.created', entityId: id, contactId: activity.contact_id, userId: user.id, at: nowIso() });
  track(env, user, 'create', 'activity', id);
  return json(recordToActivity(activity), 201);
}

async function listOrganizations(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const type = url.searchParams.get('type') || '';
  const conditions = ['1=1'];
  const bindings = [];
  if (q) { conditions.push('(lower(organizations.name) LIKE ? OR lower(domain) LIKE ? OR lower(industry) LIKE ?)'); bindings.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (type) { conditions.push('type=?'); bindings.push(type); }
  const result = await env.DB.prepare(`SELECT organizations.*, users.name AS owner_name,
      (SELECT COUNT(*) FROM contacts WHERE contacts.organization_id=organizations.id) AS contact_count,
      (SELECT COALESCE(SUM(value),0) FROM deals WHERE deals.organization_id=organizations.id AND stage NOT IN ('lost')) AS pipeline_value
    FROM organizations LEFT JOIN users ON users.id=organizations.owner_id WHERE ${conditions.join(' AND ')} ORDER BY organizations.name LIMIT 250`).bind(...bindings).all();
  return result.results.map(recordToOrganization);
}

async function createOrganization(request, env, user) {
  const input = await bodyJson(request);
  if (!String(input.name || '').trim()) return error('Organization name is required');
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const values = [
    id, String(input.name).trim(), input.domain || null, input.industry || null, input.type || 'prospect', input.status || 'active', input.country || null, input.city || null,
    input.website || null, input.linkedin_url || null, input.phone || null, input.description || null, input.owner_id || user.id, Number(input.annual_value || 0),
    Math.round(clamp(input.relationship_score ?? 50, 0, 100)), toIsoDate(input.last_contact_at), toIsoDate(input.next_follow_up_at), JSON.stringify(normalizeTags(input.tags)), JSON.stringify(input.custom_fields || {}), timestamp, timestamp,
  ];
  await env.DB.prepare(`INSERT INTO organizations (id,name,domain,industry,type,status,country,city,website,linkedin_url,phone,description,owner_id,annual_value,relationship_score,last_contact_at,next_follow_up_at,tags_json,custom_fields_json,created_at,updated_at)
    VALUES (${values.map(() => '?').join(',')})`).bind(...values).run();
  const after = await env.DB.prepare('SELECT * FROM organizations WHERE id=?').bind(id).first();
  await audit(env, user, request, 'create', 'organization', id, null, after);
  track(env, user, 'create', 'organization', id);
  return json(recordToOrganization(after), 201);
}

async function updateOrganization(request, env, user, id) {
  const before = await env.DB.prepare('SELECT * FROM organizations WHERE id=?').bind(id).first();
  if (!before) return error('Organization not found', 404);
  const input = await bodyJson(request);
  const allowed = ['name','domain','industry','type','status','country','city','website','linkedin_url','phone','description','owner_id','annual_value','relationship_score','last_contact_at','next_follow_up_at'];
  const updates = []; const bindings = [];
  for (const field of allowed) if (Object.hasOwn(input, field)) {
    updates.push(`${field}=?`);
    let value = input[field];
    if (field === 'relationship_score') value = Math.round(clamp(value, 0, 100));
    if (['last_contact_at','next_follow_up_at'].includes(field)) value = toIsoDate(value);
    bindings.push(value === '' ? null : value);
  }
  if (Object.hasOwn(input, 'tags')) { updates.push('tags_json=?'); bindings.push(JSON.stringify(normalizeTags(input.tags))); }
  if (!updates.length) return error('No fields to update');
  updates.push('updated_at=?'); bindings.push(nowIso(), id);
  await env.DB.prepare(`UPDATE organizations SET ${updates.join(',')} WHERE id=?`).bind(...bindings).run();
  const after = await env.DB.prepare('SELECT * FROM organizations WHERE id=?').bind(id).first();
  await audit(env, user, request, 'update', 'organization', id, before, after);
  track(env, user, 'update', 'organization', id);
  return json(recordToOrganization(after));
}

async function listDeals(request, env) {
  const url = new URL(request.url);
  const stage = url.searchParams.get('stage') || '';
  const condition = stage ? 'WHERE deals.stage=?' : '';
  const statement = env.DB.prepare(`SELECT deals.*, organizations.name AS organization_name, contacts.first_name || ' ' || contacts.last_name AS contact_name, users.name AS owner_name
    FROM deals LEFT JOIN organizations ON organizations.id=deals.organization_id LEFT JOIN contacts ON contacts.id=deals.primary_contact_id LEFT JOIN users ON users.id=deals.owner_id ${condition}
    ORDER BY CASE deals.stage WHEN 'negotiation' THEN 1 WHEN 'proposal' THEN 2 WHEN 'qualified' THEN 3 WHEN 'lead' THEN 4 WHEN 'won' THEN 5 ELSE 6 END, expected_close_date`);
  const result = stage ? await statement.bind(stage).all() : await statement.all();
  return result.results;
}

async function createDeal(request, env, user) {
  const input = await bodyJson(request);
  if (!String(input.name || '').trim()) return error('Deal name is required');
  const id = crypto.randomUUID(); const timestamp = nowIso(); const stage = input.stage || 'lead';
  const values = [id, String(input.name).trim(), input.organization_id || null, input.primary_contact_id || null, input.owner_id || user.id, stage, Number(input.value || 0), input.currency || 'EUR', Math.round(clamp(input.probability ?? STAGE_PROBABILITIES[stage] ?? 10, 0, 100)), input.expected_close_date || null, input.closed_at || null, input.loss_reason || null, input.description || null, timestamp, timestamp];
  await env.DB.prepare(`INSERT INTO deals (id,name,organization_id,primary_contact_id,owner_id,stage,value,currency,probability,expected_close_date,closed_at,loss_reason,description,created_at,updated_at) VALUES (${values.map(() => '?').join(',')})`).bind(...values).run();
  const after = await env.DB.prepare('SELECT * FROM deals WHERE id=?').bind(id).first();
  await audit(env, user, request, 'create', 'deal', id, null, after); track(env, user, 'create', 'deal', id);
  return json(after, 201);
}

async function updateDeal(request, env, user, id) {
  const before = await env.DB.prepare('SELECT * FROM deals WHERE id=?').bind(id).first();
  if (!before) return error('Deal not found', 404);
  const input = await bodyJson(request); const allowed = ['name','organization_id','primary_contact_id','owner_id','stage','value','currency','probability','expected_close_date','closed_at','loss_reason','description'];
  const updates = []; const bindings = [];
  for (const field of allowed) if (Object.hasOwn(input, field)) { updates.push(`${field}=?`); bindings.push(field === 'probability' ? Math.round(clamp(input[field],0,100)) : input[field] === '' ? null : input[field]); }
  if (input.stage && !Object.hasOwn(input, 'probability')) { updates.push('probability=?'); bindings.push(STAGE_PROBABILITIES[input.stage] ?? before.probability); }
  if (['won','lost'].includes(input.stage) && !Object.hasOwn(input,'closed_at')) { updates.push('closed_at=?'); bindings.push(nowIso()); }
  updates.push('updated_at=?'); bindings.push(nowIso(), id);
  await env.DB.prepare(`UPDATE deals SET ${updates.join(',')} WHERE id=?`).bind(...bindings).run();
  const after = await env.DB.prepare('SELECT * FROM deals WHERE id=?').bind(id).first();
  await audit(env,user,request,'update','deal',id,before,after); track(env,user,'update','deal',id);
  return json(after);
}

async function listTasks(request, env) {
  const url = new URL(request.url); const status = url.searchParams.get('status') || '';
  const condition = status ? 'WHERE tasks.status=?' : '';
  const statement = env.DB.prepare(`SELECT tasks.*, contacts.first_name || ' ' || contacts.last_name AS contact_name, organizations.name AS organization_name, deals.name AS deal_name, users.name AS assignee_name
    FROM tasks LEFT JOIN contacts ON contacts.id=tasks.contact_id LEFT JOIN organizations ON organizations.id=tasks.organization_id LEFT JOIN deals ON deals.id=tasks.deal_id LEFT JOIN users ON users.id=tasks.assignee_id ${condition}
    ORDER BY CASE tasks.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, due_at`);
  const result = status ? await statement.bind(status).all() : await statement.all();
  return result.results;
}

async function createTask(request, env, user) {
  const input = await bodyJson(request); if (!String(input.title || '').trim()) return error('Task title is required');
  const id=crypto.randomUUID(); const timestamp=nowIso();
  const values=[id,String(input.title).trim(),input.description||null,input.contact_id||null,input.organization_id||null,input.deal_id||null,input.assignee_id||user.id,input.priority||'medium',input.status||'open',toIsoDate(input.due_at),input.completed_at||null,timestamp,timestamp];
  await env.DB.prepare(`INSERT INTO tasks (id,title,description,contact_id,organization_id,deal_id,assignee_id,priority,status,due_at,completed_at,created_at,updated_at) VALUES (${values.map(()=>'?').join(',')})`).bind(...values).run();
  const after=await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first(); await audit(env,user,request,'create','task',id,null,after); track(env,user,'create','task',id); return json(after,201);
}

async function updateTask(request, env, user, id) {
  const before=await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first(); if(!before)return error('Task not found',404);
  const input=await bodyJson(request); const allowed=['title','description','contact_id','organization_id','deal_id','assignee_id','priority','status','due_at','completed_at']; const updates=[]; const bindings=[];
  for(const field of allowed) if(Object.hasOwn(input,field)){updates.push(`${field}=?`); let value=input[field]; if(field==='due_at')value=toIsoDate(value); bindings.push(value===''?null:value);}
  if(input.status==='completed'&&!Object.hasOwn(input,'completed_at')){updates.push('completed_at=?');bindings.push(nowIso());}
  updates.push('updated_at=?');bindings.push(nowIso(),id); await env.DB.prepare(`UPDATE tasks SET ${updates.join(',')} WHERE id=?`).bind(...bindings).run();
  const after=await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first(); await audit(env,user,request,'update','task',id,before,after); track(env,user,'update','task',id); return json(after);
}

async function searchAll(request, env) {
  const q=(new URL(request.url).searchParams.get('q')||'').trim().toLowerCase(); if(q.length<2)return {contacts:[],organizations:[],deals:[]}; const match=`%${q}%`;
  const [contacts,organizations,deals]=await Promise.all([
    env.DB.prepare(`SELECT id, first_name || ' ' || last_name AS name, email, job_title AS subtitle, 'contact' AS type FROM contacts WHERE lower(first_name || ' ' || last_name) LIKE ? OR lower(email) LIKE ? LIMIT 8`).bind(match,match).all(),
    env.DB.prepare(`SELECT id, name, industry AS subtitle, domain, 'organization' AS type FROM organizations WHERE lower(name) LIKE ? OR lower(domain) LIKE ? LIMIT 8`).bind(match,match).all(),
    env.DB.prepare(`SELECT id, name, stage AS subtitle, value, currency, 'deal' AS type FROM deals WHERE lower(name) LIKE ? LIMIT 8`).bind(match).all(),
  ]); return {contacts:contacts.results,organizations:organizations.results,deals:deals.results};
}

async function importContacts(request, env, user) {
  requireRole(user,['admin','manager','member']); const input=await bodyJson(request); const rows=parseCsv(input.csv||''); if(!rows.length)return error('CSV has no data rows');
  if(rows.length>5000)return error('A single import is limited to 5,000 rows');
  let success=0; const errors=[];
  for(let index=0;index<rows.length;index+=1){const row=rows[index]; try{
    const firstName=row.first_name||row.firstname||row.name?.split(' ')[0]; const lastName=row.last_name||row.lastname||row.name?.split(' ').slice(1).join(' ')||''; if(!firstName)throw new Error('Missing first_name');
    let organizationId=null; const organizationName=row.organization||row.company||row.organization_name;
    if(organizationName){const existing=await env.DB.prepare('SELECT id FROM organizations WHERE lower(name)=lower(?) LIMIT 1').bind(organizationName).first(); organizationId=existing?.id||crypto.randomUUID(); if(!existing)await env.DB.prepare('INSERT INTO organizations (id,name,owner_id) VALUES (?,?,?)').bind(organizationId,organizationName,user.id).run();}
    const id=crypto.randomUUID(); await env.DB.prepare(`INSERT INTO contacts (id,organization_id,first_name,last_name,job_title,email,phone,lifecycle_stage,owner_id,relationship_score,source,tags_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,organizationId,firstName,lastName,row.job_title||row.title||null,row.email?row.email.toLowerCase():null,row.phone||row.mobile||null,row.lifecycle_stage||row.stage||'lead',user.id,Number(row.relationship_score||50),row.source||'CSV import',JSON.stringify(normalizeTags((row.tags||'').split(/[;,]/)))).run(); success+=1;
  }catch(importError){errors.push({row:index+2,message:importError.message});}}
  const importId=crypto.randomUUID(); await env.DB.prepare(`INSERT INTO imports (id,user_id,file_name,entity_type,row_count,success_count,failure_count,errors_json) VALUES (?,?,?,?,?,?,?,?)`).bind(importId,user.id,input.file_name||'contacts.csv','contacts',rows.length,success,errors.length,JSON.stringify(errors.slice(0,100))).run();
  await audit(env,user,request,'import','contacts',importId,null,{rows:rows.length,success,failures:errors.length}); track(env,user,'import','contacts',importId); return json({id:importId,rows:rows.length,success,failures:errors.length,errors:errors.slice(0,100)},201);
}

async function uploadAttachment(request, env, user) {
  if(!env.ATTACHMENTS)return error('R2 attachment binding is not configured',503); const form=await request.formData(); const file=form.get('file'); if(!(file instanceof File))return error('A file field is required'); if(file.size>25*1024*1024)return error('File exceeds 25 MB limit',413);
  const id=crypto.randomUUID(); const safeName=file.name.replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-180); const key=`${new Date().toISOString().slice(0,10)}/${id}-${safeName}`;
  await env.ATTACHMENTS.put(key,file.stream(),{httpMetadata:{contentType:file.type||'application/octet-stream'},customMetadata:{uploadedBy:user.id,originalName:file.name}});
  await env.DB.prepare(`INSERT INTO attachments (id,activity_id,contact_id,organization_id,uploaded_by,r2_key,file_name,mime_type,size_bytes) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id,form.get('activity_id')||null,form.get('contact_id')||null,form.get('organization_id')||null,user.id,key,file.name,file.type||'application/octet-stream',file.size).run();
  await audit(env,user,request,'upload','attachment',id,null,{file_name:file.name,size_bytes:file.size}); track(env,user,'upload','attachment',id); return json({id,file_name:file.name,mime_type:file.type,size_bytes:file.size},201);
}

async function downloadAttachment(env, id) {
  const attachment=await env.DB.prepare('SELECT * FROM attachments WHERE id=?').bind(id).first(); if(!attachment)return error('Attachment not found',404); const object=await env.ATTACHMENTS.get(attachment.r2_key); if(!object)return error('Attachment object not found',404);
  const headers=new Headers(SECURITY_HEADERS); object.writeHttpMetadata(headers); headers.set('content-disposition',`attachment; filename="${attachment.file_name.replaceAll('"','')}"`); headers.set('etag',object.httpEtag); return new Response(object.body,{headers});
}

async function analytics(request, env) {
  const url=new URL(request.url); const days=Math.round(clamp(url.searchParams.get('days')||30,7,365));
  const [activityTypes,ownerPerformance,monthly,conversion]=await Promise.all([
    env.DB.prepare(`SELECT type, COUNT(*) AS count FROM activities WHERE occurred_at>=datetime('now',?) GROUP BY type ORDER BY count DESC`).bind(`-${days} days`).all(),
    env.DB.prepare(`SELECT users.id,users.name,COUNT(DISTINCT activities.id) AS activities,COUNT(DISTINCT contacts.id) AS contacts,COALESCE(SUM(CASE WHEN deals.stage='won' THEN deals.value ELSE 0 END),0) AS won_value FROM users LEFT JOIN activities ON activities.user_id=users.id AND activities.occurred_at>=datetime('now',?) LEFT JOIN contacts ON contacts.owner_id=users.id LEFT JOIN deals ON deals.owner_id=users.id GROUP BY users.id,users.name ORDER BY won_value DESC`).bind(`-${days} days`).all(),
    env.DB.prepare(`SELECT strftime('%Y-%m',occurred_at) AS month,COUNT(*) AS activities,COUNT(DISTINCT contact_id) AS engaged_contacts FROM activities WHERE occurred_at>=datetime('now','-12 months') GROUP BY month ORDER BY month`).all(),
    env.DB.prepare(`SELECT lifecycle_stage,COUNT(*) AS count FROM contacts GROUP BY lifecycle_stage`).all(),
  ]); return {days,activity_types:activityTypes.results,owner_performance:ownerPerformance.results,monthly:monthly.results,conversion:conversion.results};
}

async function handleApi(request, env, user) {
  const url=new URL(request.url); const parts=routeParts(url.pathname); const method=request.method.toUpperCase();
  if(parts[1]==='me'&&method==='GET')return json({user,app_name:env.APP_NAME||'PartnerMarket Global CRM',environment:env.ENVIRONMENT||'production'});
  if(parts[1]==='dashboard'&&method==='GET')return json(await dashboard(env));
  if(parts[1]==='analytics'&&method==='GET')return json(await analytics(request,env));
  if(parts[1]==='search'&&method==='GET')return json(await searchAll(request,env));
  if(parts[1]==='contacts'){
    if(parts.length===2&&method==='GET')return json(await listContacts(request,env));
    if(parts.length===2&&method==='POST')return createContact(request,env,user);
    if(parts.length===3&&method==='GET'){const contact=await getContact(env,parts[2]);return contact?json(contact):error('Contact not found',404);}
    if(parts.length===3&&method==='PATCH')return updateContact(request,env,user,parts[2]);
    if(parts.length===3&&method==='DELETE')return deleteContact(request,env,user,parts[2]);
    if(parts.length===4&&parts[3]==='activities'&&method==='GET'){const result=await env.DB.prepare('SELECT * FROM activities WHERE contact_id=? ORDER BY occurred_at DESC LIMIT 200').bind(parts[2]).all();return json(result.results.map(recordToActivity));}
    if(parts.length===4&&parts[3]==='activities'&&method==='POST')return createActivity(request,env,user,parts[2]);
  }
  if(parts[1]==='activities'&&parts.length===2&&method==='POST')return createActivity(request,env,user);
  if(parts[1]==='organizations'){
    if(parts.length===2&&method==='GET')return json(await listOrganizations(request,env));
    if(parts.length===2&&method==='POST')return createOrganization(request,env,user);
    if(parts.length===3&&method==='PATCH')return updateOrganization(request,env,user,parts[2]);
  }
  if(parts[1]==='deals'){
    if(parts.length===2&&method==='GET')return json(await listDeals(request,env));
    if(parts.length===2&&method==='POST')return createDeal(request,env,user);
    if(parts.length===3&&method==='PATCH')return updateDeal(request,env,user,parts[2]);
  }
  if(parts[1]==='tasks'){
    if(parts.length===2&&method==='GET')return json(await listTasks(request,env));
    if(parts.length===2&&method==='POST')return createTask(request,env,user);
    if(parts.length===3&&method==='PATCH')return updateTask(request,env,user,parts[2]);
  }
  if(parts[1]==='import'&&parts[2]==='contacts'&&method==='POST')return importContacts(request,env,user);
  if(parts[1]==='attachments'&&parts.length===2&&method==='POST')return uploadAttachment(request,env,user);
  if(parts[1]==='attachments'&&parts.length===3&&method==='GET')return downloadAttachment(env,parts[2]);
  if(parts[1]==='users'&&method==='GET'){requireRole(user,['admin','manager']);const result=await env.DB.prepare('SELECT id,email,name,role,is_active,created_at FROM users ORDER BY name').all();return json(result.results);}
  return error('API route not found',404);
}

async function recomputeRelationshipScores(env) {
  await env.DB.prepare(`UPDATE contacts SET relationship_score = MAX(0, MIN(100,
    40 +
    CASE WHEN last_contact_at IS NULL THEN -15 WHEN last_contact_at>=datetime('now','-7 days') THEN 25 WHEN last_contact_at>=datetime('now','-21 days') THEN 15 WHEN last_contact_at>=datetime('now','-45 days') THEN 5 WHEN last_contact_at<datetime('now','-90 days') THEN -15 ELSE -5 END +
    MIN(15,(SELECT COUNT(*)*2 FROM activities WHERE activities.contact_id=contacts.id AND occurred_at>=datetime('now','-180 days'))) -
    MIN(20,(SELECT COUNT(*)*6 FROM tasks WHERE tasks.contact_id=contacts.id AND status NOT IN ('completed','cancelled') AND due_at<datetime('now'))) +
    CASE WHEN EXISTS(SELECT 1 FROM deals WHERE deals.primary_contact_id=contacts.id AND stage NOT IN ('won','lost')) THEN 10 ELSE 0 END
  )), updated_at=datetime('now')`).run();
}

async function handleQueue(batch, env) {
  for(const message of batch.messages){try{
    const event=message.body; if(event?.contactId) await env.CACHE?.delete(`contact:${event.contactId}`); await env.CACHE?.delete('dashboard:v1'); message.ack();
  }catch(queueError){console.error('Queue message failed',queueError);message.retry();}}
}

export default {
  async fetch(request, env, ctx) {
    const url=new URL(request.url);
    if(url.pathname==='/health')return json({ok:true,service:env.APP_NAME||'PartnerMarket Global CRM',timestamp:nowIso()});
    if(url.pathname.startsWith('/api/')){
      try{
        const user=await currentUser(request,env); const response=await handleApi(request,env,user); return response;
      }catch(requestError){console.error(requestError);return error(requestError.message||'Internal server error',requestError.status||500);}
    }
    const response=await env.ASSETS.fetch(request); const headers=new Headers(response.headers); for(const [key,value] of Object.entries(SECURITY_HEADERS))headers.set(key,value); return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  },
  async queue(batch, env) { await handleQueue(batch,env); },
  async scheduled(_controller, env, ctx) { ctx.waitUntil(recomputeRelationshipScores(env)); },
};
