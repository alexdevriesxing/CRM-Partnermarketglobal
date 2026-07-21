function clean(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function number(value) {
  return Number(value || 0);
}

function daysWindow(request) {
  const raw = Number(new URL(request.url).searchParams.get('days') || 90);
  return Math.max(30, Math.min(365, Number.isFinite(raw) ? Math.trunc(raw) : 90));
}

function accountScope(url, alias = '') {
  const accountId = clean(url.searchParams.get('account'));
  const prefix = alias ? `${alias}.` : '';
  return {
    accountId,
    clause: accountId ? ` AND ${prefix}organization_id=?` : '',
    bindings: accountId ? [accountId] : [],
  };
}

function riskReasons(row) {
  const reasons = [];
  if (number(row.is_overdue)) reasons.push('Close date overdue');
  if (number(row.is_stale)) reasons.push('No update in 30+ days');
  if (number(row.missing_next_step)) reasons.push('Missing next step');
  if (number(row.missing_contact)) reasons.push('Missing primary contact');
  if (number(row.missing_account)) reasons.push('Missing CRM account');
  return reasons;
}

function qualitySummary(contacts, organizations, deals) {
  const contactIssues = ['missing_email','missing_phone','missing_account','missing_job_title','unknown_consent'].reduce((sum, key) => sum + number(contacts?.[key]), 0);
  const organizationIssues = ['missing_domain','missing_industry','missing_country','missing_owner'].reduce((sum, key) => sum + number(organizations?.[key]), 0);
  const dealIssues = ['missing_account','missing_contact','missing_next_step','missing_close_date'].reduce((sum, key) => sum + number(deals?.[key]), 0);
  const possible = number(contacts?.total) * 5 + number(organizations?.total) * 4 + number(deals?.total) * 4;
  const issues = contactIssues + organizationIssues + dealIssues;
  const score = possible ? Math.max(0, Math.round((1 - issues / possible) * 100)) : 100;
  return { score, issues, possible, contact_issues: contactIssues, organization_issues: organizationIssues, deal_issues: dealIssues };
}

export async function getCommercialIntelligence(env, ctx, request) {
  const url = new URL(request.url);
  const workspaceId = ctx.workspace.id;
  const days = daysWindow(request);
  const scope = accountScope(url, 'd');
  const organizationScope = accountScope(url, 'o');

  if (scope.accountId) {
    const account = await env.DB.prepare('SELECT id FROM organizations WHERE id=? AND workspace_id=?').bind(scope.accountId, workspaceId).first();
    if (!account) throw Object.assign(new Error('Account not found'), { status: 404 });
  }

  const modifier = `-${days} days`;
  const [forecast, forecastByMonth, riskDeals, riskAccounts, contactsQuality, organizationsQuality, dealsQuality, duplicateContacts, duplicateOrganizations] = await Promise.all([
    env.DB.prepare(`SELECT
      COUNT(*) open_deals,
      COALESCE(SUM(d.value),0) open_pipeline,
      COALESCE(SUM(d.value*d.probability/100.0),0) weighted_pipeline,
      SUM(CASE WHEN d.expected_close_date IS NOT NULL AND date(d.expected_close_date) BETWEEN date('now') AND date('now','+30 days') THEN 1 ELSE 0 END) due_30d_count,
      COALESCE(SUM(CASE WHEN d.expected_close_date IS NOT NULL AND date(d.expected_close_date) BETWEEN date('now') AND date('now','+30 days') THEN d.value ELSE 0 END),0) due_30d_value,
      SUM(CASE WHEN d.expected_close_date IS NOT NULL AND date(d.expected_close_date)<date('now') THEN 1 ELSE 0 END) overdue_count,
      COALESCE(SUM(CASE WHEN d.expected_close_date IS NOT NULL AND date(d.expected_close_date)<date('now') THEN d.value ELSE 0 END),0) overdue_value,
      SUM(CASE WHEN d.expected_close_date IS NULL OR trim(d.expected_close_date)='' THEN 1 ELSE 0 END) unscheduled_count,
      SUM(CASE WHEN d.next_step IS NULL OR trim(d.next_step)='' THEN 1 ELSE 0 END) missing_next_step_count,
      SUM(CASE WHEN d.updated_at<datetime('now','-30 days') THEN 1 ELSE 0 END) stale_count
      FROM deals d WHERE d.workspace_id=? AND d.stage NOT IN ('won','lost')${scope.clause}`).bind(workspaceId, ...scope.bindings).first(),
    env.DB.prepare(`WITH RECURSIVE months(month_start) AS (
      SELECT date('now','start of month')
      UNION ALL SELECT date(month_start,'+1 month') FROM months WHERE month_start<date('now','start of month','+5 months')
    )
    SELECT months.month_start month,COUNT(d.id) deal_count,COALESCE(SUM(d.value),0) pipeline,
      COALESCE(SUM(d.value*d.probability/100.0),0) weighted
      FROM months LEFT JOIN deals d ON d.workspace_id=? AND d.stage NOT IN ('won','lost')${scope.clause}
        AND date(d.expected_close_date,'start of month')=months.month_start
      GROUP BY months.month_start ORDER BY months.month_start`).bind(workspaceId, ...scope.bindings).all(),
    env.DB.prepare(`SELECT d.*,o.name organization_name,c.first_name||' '||c.last_name contact_name,u.name owner_name,
      CASE WHEN d.expected_close_date IS NOT NULL AND date(d.expected_close_date)<date('now') THEN 1 ELSE 0 END is_overdue,
      CASE WHEN d.updated_at<datetime('now','-30 days') THEN 1 ELSE 0 END is_stale,
      CASE WHEN d.next_step IS NULL OR trim(d.next_step)='' THEN 1 ELSE 0 END missing_next_step,
      CASE WHEN d.primary_contact_id IS NULL OR trim(d.primary_contact_id)='' THEN 1 ELSE 0 END missing_contact,
      CASE WHEN d.organization_id IS NULL OR trim(d.organization_id)='' THEN 1 ELSE 0 END missing_account,
      (CASE WHEN d.expected_close_date IS NOT NULL AND date(d.expected_close_date)<date('now') THEN 35 ELSE 0 END +
       CASE WHEN d.updated_at<datetime('now','-30 days') THEN 25 ELSE 0 END +
       CASE WHEN d.next_step IS NULL OR trim(d.next_step)='' THEN 20 ELSE 0 END +
       CASE WHEN d.primary_contact_id IS NULL OR trim(d.primary_contact_id)='' THEN 10 ELSE 0 END +
       CASE WHEN d.organization_id IS NULL OR trim(d.organization_id)='' THEN 10 ELSE 0 END) risk_score
      FROM deals d LEFT JOIN organizations o ON o.id=d.organization_id LEFT JOIN contacts c ON c.id=d.primary_contact_id LEFT JOIN users u ON u.id=d.owner_id
      WHERE d.workspace_id=? AND d.stage NOT IN ('won','lost')${scope.clause} AND (
        (d.expected_close_date IS NOT NULL AND date(d.expected_close_date)<date('now')) OR d.updated_at<datetime('now','-30 days') OR
        d.next_step IS NULL OR trim(d.next_step)='' OR d.primary_contact_id IS NULL OR trim(d.primary_contact_id)='' OR d.organization_id IS NULL OR trim(d.organization_id)='')
      ORDER BY risk_score DESC,d.value DESC LIMIT 60`).bind(workspaceId, ...scope.bindings).all(),
    env.DB.prepare(`SELECT o.*,u.name owner_name,
      (SELECT COUNT(*) FROM contacts c WHERE c.workspace_id=o.workspace_id AND c.organization_id=o.id) contact_count,
      (SELECT COALESCE(SUM(d.value),0) FROM deals d WHERE d.workspace_id=o.workspace_id AND d.organization_id=o.id AND d.stage NOT IN ('won','lost')) open_pipeline,
      (SELECT COUNT(*) FROM tasks t WHERE t.workspace_id=o.workspace_id AND t.organization_id=o.id AND t.status NOT IN ('completed','cancelled') AND t.due_at<datetime('now')) overdue_tasks,
      (SELECT COUNT(*) FROM follow_ups f WHERE f.workspace_id=o.workspace_id AND f.organization_id=o.id AND f.status IN ('open','snoozed') AND COALESCE(f.snoozed_until,f.due_at)<datetime('now')) overdue_follow_ups,
      (CASE WHEN o.relationship_score<35 THEN 35 WHEN o.relationship_score<55 THEN 20 ELSE 0 END +
       CASE WHEN o.last_contact_at IS NULL OR o.last_contact_at<datetime('now','-60 days') THEN 30 ELSE 0 END +
       CASE WHEN (SELECT COUNT(*) FROM tasks t WHERE t.workspace_id=o.workspace_id AND t.organization_id=o.id AND t.status NOT IN ('completed','cancelled') AND t.due_at<datetime('now'))>0 THEN 20 ELSE 0 END +
       CASE WHEN (SELECT COUNT(*) FROM follow_ups f WHERE f.workspace_id=o.workspace_id AND f.organization_id=o.id AND f.status IN ('open','snoozed') AND COALESCE(f.snoozed_until,f.due_at)<datetime('now'))>0 THEN 15 ELSE 0 END) risk_score
      FROM organizations o LEFT JOIN users u ON u.id=o.owner_id
      WHERE o.workspace_id=? AND o.status='active'${organizationScope.clause} AND (
        o.relationship_score<55 OR o.last_contact_at IS NULL OR o.last_contact_at<datetime('now','-60 days') OR
        EXISTS(SELECT 1 FROM tasks t WHERE t.workspace_id=o.workspace_id AND t.organization_id=o.id AND t.status NOT IN ('completed','cancelled') AND t.due_at<datetime('now')) OR
        EXISTS(SELECT 1 FROM follow_ups f WHERE f.workspace_id=o.workspace_id AND f.organization_id=o.id AND f.status IN ('open','snoozed') AND COALESCE(f.snoozed_until,f.due_at)<datetime('now')))
      ORDER BY risk_score DESC,open_pipeline DESC LIMIT 40`).bind(workspaceId, ...organizationScope.bindings).all(),
    env.DB.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN email IS NULL OR trim(email)='' THEN 1 ELSE 0 END) missing_email,
      SUM(CASE WHEN (phone IS NULL OR trim(phone)='') AND (mobile IS NULL OR trim(mobile)='') THEN 1 ELSE 0 END) missing_phone,
      SUM(CASE WHEN organization_id IS NULL OR trim(organization_id)='' THEN 1 ELSE 0 END) missing_account,
      SUM(CASE WHEN job_title IS NULL OR trim(job_title)='' THEN 1 ELSE 0 END) missing_job_title,
      SUM(CASE WHEN consent_status IS NULL OR trim(consent_status)='' OR consent_status='unknown' THEN 1 ELSE 0 END) unknown_consent
      FROM contacts WHERE workspace_id=?${scope.accountId ? ' AND organization_id=?' : ''} AND status='active'`).bind(workspaceId, ...scope.bindings).first(),
    env.DB.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN domain IS NULL OR trim(domain)='' THEN 1 ELSE 0 END) missing_domain,
      SUM(CASE WHEN industry IS NULL OR trim(industry)='' THEN 1 ELSE 0 END) missing_industry,
      SUM(CASE WHEN country IS NULL OR trim(country)='' THEN 1 ELSE 0 END) missing_country,
      SUM(CASE WHEN owner_id IS NULL OR trim(owner_id)='' THEN 1 ELSE 0 END) missing_owner
      FROM organizations o WHERE o.workspace_id=?${organizationScope.clause} AND o.status='active'`).bind(workspaceId, ...organizationScope.bindings).first(),
    env.DB.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN d.organization_id IS NULL OR trim(d.organization_id)='' THEN 1 ELSE 0 END) missing_account,
      SUM(CASE WHEN d.primary_contact_id IS NULL OR trim(d.primary_contact_id)='' THEN 1 ELSE 0 END) missing_contact,
      SUM(CASE WHEN d.next_step IS NULL OR trim(d.next_step)='' THEN 1 ELSE 0 END) missing_next_step,
      SUM(CASE WHEN d.expected_close_date IS NULL OR trim(d.expected_close_date)='' THEN 1 ELSE 0 END) missing_close_date
      FROM deals d WHERE d.workspace_id=? AND d.stage NOT IN ('won','lost')${scope.clause}`).bind(workspaceId, ...scope.bindings).first(),
    env.DB.prepare(`SELECT lower(trim(email)) match_value,COUNT(*) record_count,group_concat(id) record_ids,
      group_concat(trim(first_name||' '||last_name),' · ') labels
      FROM contacts WHERE workspace_id=? AND email IS NOT NULL AND trim(email)!=''${scope.accountId ? ' AND organization_id=?' : ''}
      GROUP BY lower(trim(email)) HAVING COUNT(*)>1 ORDER BY record_count DESC,match_value LIMIT 20`).bind(workspaceId, ...scope.bindings).all(),
    env.DB.prepare(`SELECT match_type,match_value,record_count,record_ids,labels FROM (
      SELECT 'name' match_type,lower(trim(name)) match_value,COUNT(*) record_count,group_concat(id) record_ids,group_concat(name,' · ') labels
      FROM organizations o WHERE o.workspace_id=?${organizationScope.clause} AND trim(o.name)!='' GROUP BY lower(trim(name)) HAVING COUNT(*)>1
      UNION ALL
      SELECT 'domain' match_type,lower(trim(domain)) match_value,COUNT(*) record_count,group_concat(id) record_ids,group_concat(name,' · ') labels
      FROM organizations o WHERE o.workspace_id=?${organizationScope.clause} AND domain IS NOT NULL AND trim(domain)!='' GROUP BY lower(trim(domain)) HAVING COUNT(*)>1
    ) ORDER BY record_count DESC,match_type,match_value LIMIT 30`).bind(workspaceId, ...organizationScope.bindings, workspaceId, ...organizationScope.bindings).all(),
  ]);

  const quality = qualitySummary(contactsQuality, organizationsQuality, dealsQuality);
  const riskyDeals = (riskDeals.results || []).map((row) => ({ ...row, risk_reasons: riskReasons(row) }));
  const duplicateGroups = number(duplicateContacts.results?.length) + number(duplicateOrganizations.results?.length);

  return {
    window_days: days,
    account_id: scope.accountId,
    generated_at: new Date().toISOString(),
    forecast: {
      ...forecast,
      open_deals: number(forecast?.open_deals),
      open_pipeline: number(forecast?.open_pipeline),
      weighted_pipeline: number(forecast?.weighted_pipeline),
      due_30d_count: number(forecast?.due_30d_count),
      due_30d_value: number(forecast?.due_30d_value),
      overdue_count: number(forecast?.overdue_count),
      overdue_value: number(forecast?.overdue_value),
      unscheduled_count: number(forecast?.unscheduled_count),
      missing_next_step_count: number(forecast?.missing_next_step_count),
      stale_count: number(forecast?.stale_count),
    },
    forecast_by_month: forecastByMonth.results || [],
    risk_deals: riskyDeals,
    risk_accounts: riskAccounts.results || [],
    data_quality: {
      ...quality,
      contacts: contactsQuality || {},
      organizations: organizationsQuality || {},
      deals: dealsQuality || {},
      duplicate_groups: duplicateGroups,
    },
    duplicates: {
      contacts: duplicateContacts.results || [],
      organizations: duplicateOrganizations.results || [],
    },
    summary: {
      urgent_deals: riskyDeals.filter((deal) => number(deal.risk_score) >= 50).length,
      at_risk_accounts: number(riskAccounts.results?.length),
      duplicate_groups: duplicateGroups,
      records_reviewed: number(contactsQuality?.total) + number(organizationsQuality?.total) + number(dealsQuality?.total),
      activity_window: modifier,
    },
  };
}
