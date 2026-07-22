const OUTREACH_STATUSES = new Set([
  'not_contacted',
  'researching',
  'ready',
  'contacted',
  'replied',
  'qualified',
  'disqualified',
  'do_not_contact',
]);

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export async function getProspectingOverview(env, ctx) {
  const workspaceId = ctx.workspace.id;
  const [totals, statuses] = await Promise.all([
    env.DB.prepare(`SELECT
      COUNT(DISTINCT pc.id) campaigns,
      COUNT(pm.id) prospects,
      COUNT(DISTINCT pm.organization_id) accounts,
      COUNT(DISTINCT pm.contact_id) contacts,
      SUM(CASE WHEN pm.outreach_status='not_contacted' THEN 1 ELSE 0 END) not_contacted,
      SUM(CASE WHEN pm.outreach_status='ready' THEN 1 ELSE 0 END) ready,
      SUM(CASE WHEN pm.outreach_status='contacted' THEN 1 ELSE 0 END) contacted,
      SUM(CASE WHEN pm.outreach_status='replied' THEN 1 ELSE 0 END) replied,
      SUM(CASE WHEN pm.outreach_status='qualified' THEN 1 ELSE 0 END) qualified
      FROM prospect_campaigns pc
      LEFT JOIN prospect_campaign_members pm ON pm.campaign_id=pc.id
      WHERE pc.workspace_id=? AND pc.status!='archived'`).bind(workspaceId).first(),
    env.DB.prepare(`SELECT outreach_status status,COUNT(*) count
      FROM prospect_campaign_members WHERE workspace_id=?
      GROUP BY outreach_status ORDER BY count DESC`).bind(workspaceId).all(),
  ]);
  return { totals, statuses: statuses.results || [] };
}

export async function listProspectingCampaigns(env, ctx) {
  const rows = await env.DB.prepare(`SELECT pc.*,
    COUNT(pm.id) prospect_count,
    SUM(CASE WHEN pm.outreach_status='not_contacted' THEN 1 ELSE 0 END) not_contacted_count,
    SUM(CASE WHEN pm.outreach_status='ready' THEN 1 ELSE 0 END) ready_count,
    SUM(CASE WHEN pm.outreach_status='contacted' THEN 1 ELSE 0 END) contacted_count,
    SUM(CASE WHEN pm.outreach_status='replied' THEN 1 ELSE 0 END) replied_count,
    SUM(CASE WHEN pm.outreach_status='qualified' THEN 1 ELSE 0 END) qualified_count
    FROM prospect_campaigns pc
    LEFT JOIN prospect_campaign_members pm ON pm.campaign_id=pc.id
    WHERE pc.workspace_id=?
    GROUP BY pc.id ORDER BY CASE pc.status WHEN 'active' THEN 1 WHEN 'draft' THEN 2 WHEN 'paused' THEN 3 ELSE 4 END,pc.name`).bind(ctx.workspace.id).all();
  return rows.results || [];
}

export async function listProspects(env, ctx, request) {
  const url = new URL(request.url);
  const campaign = String(url.searchParams.get('campaign') || '').trim();
  const status = String(url.searchParams.get('status') || '').trim();
  const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
  const page = boundedInteger(url.searchParams.get('page'), 1, 1, 100000);
  const pageSize = boundedInteger(url.searchParams.get('pageSize'), 50, 1, 100);
  const conditions = ['pm.workspace_id=?'];
  const bindings = [ctx.workspace.id];
  if (campaign) { conditions.push('pm.campaign_id=?'); bindings.push(campaign); }
  if (status) {
    if (!OUTREACH_STATUSES.has(status)) throw new Error('Invalid outreach status');
    conditions.push('pm.outreach_status=?'); bindings.push(status);
  }
  if (query) {
    const match = `%${query}%`;
    conditions.push(`(lower(o.name) LIKE ? OR lower(COALESCE(o.country,'')) LIKE ? OR lower(COALESCE(o.domain,'')) LIKE ? OR lower(COALESCE(c.email,'')) LIKE ? OR lower(COALESCE(pm.prospect_type,'')) LIKE ? OR lower(COALESCE(pm.fit_angle,'')) LIKE ?)`);
    bindings.push(match, match, match, match, match, match);
  }
  const where = conditions.join(' AND ');
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) total
    FROM prospect_campaign_members pm
    JOIN organizations o ON o.id=pm.organization_id
    LEFT JOIN contacts c ON c.id=pm.contact_id
    WHERE ${where}`).bind(...bindings).first();
  const rows = await env.DB.prepare(`SELECT pm.*,pc.name campaign_name,pc.target_markets,pc.suggested_angle,
    o.name organization_name,o.country,o.website,o.domain,o.phone organization_phone,
    c.first_name,c.last_name,c.email,c.phone,c.job_title,c.consent_status,c.email_opt_out,c.status contact_status
    FROM prospect_campaign_members pm
    JOIN prospect_campaigns pc ON pc.id=pm.campaign_id
    JOIN organizations o ON o.id=pm.organization_id
    LEFT JOIN contacts c ON c.id=pm.contact_id
    WHERE ${where}
    ORDER BY pc.name,o.name,c.email LIMIT ? OFFSET ?`).bind(...bindings, pageSize, (page - 1) * pageSize).all();
  const total = Number(totalRow?.total || 0);
  return { items: rows.results || [], page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function updateProspectStatus(env, ctx, memberId, status) {
  if (!OUTREACH_STATUSES.has(status)) throw new Error('Invalid outreach status');
  const before = await env.DB.prepare('SELECT * FROM prospect_campaign_members WHERE id=? AND workspace_id=?').bind(memberId, ctx.workspace.id).first();
  if (!before) throw Object.assign(new Error('Prospect campaign member not found'), { status: 404 });
  const contactedAt = ['contacted','replied','qualified'].includes(status) ? new Date().toISOString() : before.last_contact_at;
  await env.DB.prepare(`UPDATE prospect_campaign_members SET outreach_status=?,last_contact_at=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND workspace_id=?`).bind(status, contactedAt, memberId, ctx.workspace.id).run();
  const record = await env.DB.prepare(`SELECT pm.*,pc.name campaign_name,o.name organization_name,c.email
    FROM prospect_campaign_members pm
    JOIN prospect_campaigns pc ON pc.id=pm.campaign_id
    JOIN organizations o ON o.id=pm.organization_id
    LEFT JOIN contacts c ON c.id=pm.contact_id
    WHERE pm.id=? AND pm.workspace_id=?`).bind(memberId, ctx.workspace.id).first();
  return { before, record };
}
