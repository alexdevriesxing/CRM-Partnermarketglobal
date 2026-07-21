function numeric(value) {
  return Number(value || 0);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function reportWindow(request) {
  const url = new URL(request.url);
  const customFrom = validDate(url.searchParams.get('from'));
  const customTo = validDate(url.searchParams.get('to'));
  const requestedDays = Math.max(7, Math.min(730, Math.trunc(Number(url.searchParams.get('days') || 90) || 90)));
  const toDate = customTo || new Date(`${isoDate(new Date())}T00:00:00.000Z`);
  const fromDate = customFrom || addDays(toDate, -(requestedDays - 1));
  if (fromDate > toDate) throw Object.assign(new Error('Report start date must be on or before the end date'), { status: 400 });
  const days = Math.round((toDate - fromDate) / 86400000) + 1;
  if (days > 730) throw Object.assign(new Error('Report range may not exceed 730 days'), { status: 400 });
  const previousTo = addDays(fromDate, -1);
  const previousFrom = addDays(previousTo, -(days - 1));
  return {
    from: isoDate(fromDate),
    to: isoDate(toDate),
    previous_from: isoDate(previousFrom),
    previous_to: isoDate(previousTo),
    days,
    granularity: days > 180 ? 'month' : days > 45 ? 'week' : 'day',
  };
}

function scope(url) {
  return {
    account: String(url.searchParams.get('account') || '').trim() || null,
    owner: String(url.searchParams.get('owner') || '').trim() || null,
  };
}

function scoped(alias, filters, ownerColumn = 'owner_id') {
  const clauses = [];
  const bindings = [];
  if (filters.account) { clauses.push(`${alias}.organization_id=?`); bindings.push(filters.account); }
  if (filters.owner) { clauses.push(`${alias}.${ownerColumn}=?`); bindings.push(filters.owner); }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', bindings };
}

function dateCondition(alias, field) {
  return `${alias}.${field}>=? AND ${alias}.${field}<date(?,'+1 day')`;
}

function percentChange(current, previous) {
  const now = numeric(current);
  const before = numeric(previous);
  if (!before) return now ? 100 : 0;
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
}

function completionRate(completed, total) {
  const denominator = numeric(total);
  return denominator ? Math.round(numeric(completed) / denominator * 1000) / 10 : 0;
}

function deliveryRate(success, failed) {
  const total = numeric(success) + numeric(failed);
  return total ? Math.round(numeric(success) / total * 1000) / 10 : 0;
}

async function validateFilters(env, workspaceId, filters) {
  if (filters.account) {
    const account = await env.DB.prepare('SELECT id FROM organizations WHERE id=? AND workspace_id=?').bind(filters.account, workspaceId).first();
    if (!account) throw Object.assign(new Error('Account not found'), { status: 404 });
  }
  if (filters.owner) {
    const owner = await env.DB.prepare(`SELECT u.id FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=? AND u.id=? AND u.is_active=1`).bind(workspaceId, filters.owner).first();
    if (!owner) throw Object.assign(new Error('Report owner is not a member of this workspace'), { status: 404 });
  }
}

function trendBucket(granularity, alias, field) {
  if (granularity === 'month') return `date(${alias}.${field},'start of month')`;
  if (granularity === 'week') return `date(${alias}.${field}, '-' || ((CAST(strftime('%w',${alias}.${field}) AS INTEGER)+6)%7) || ' days')`;
  return `date(${alias}.${field})`;
}

export async function getDetailedAnalytics(env, ctx, request) {
  const url = new URL(request.url);
  const workspaceId = ctx.workspace.id;
  const window = reportWindow(request);
  const filters = scope(url);
  await validateFilters(env, workspaceId, filters);

  const deals = scoped('d', filters);
  const activities = scoped('a', filters, 'user_id');
  const tasks = scoped('t', filters, 'assignee_id');
  const followUps = scoped('f', filters);
  const emails = scoped('m', filters, 'user_id');
  const contacts = scoped('c', filters);
  const activityBucket = trendBucket(window.granularity, 'a', 'occurred_at');
  const revenueBucket = trendBucket(window.granularity === 'day' ? 'week' : window.granularity, 'd', 'closed_at');

  const [
    closedCurrent, closedPrevious, openPipeline, activityCurrent, activityPrevious,
    taskStats, followUpStats, emailStats, revenueTrend, activityTrend,
    activityMix, funnel, team, sources, accounts, losses, health, lifecycle,
  ] = await Promise.all([
    env.DB.prepare(`SELECT
      SUM(CASE WHEN d.stage='won' THEN 1 ELSE 0 END) won_count,
      SUM(CASE WHEN d.stage='lost' THEN 1 ELSE 0 END) lost_count,
      COALESCE(SUM(CASE WHEN d.stage='won' THEN d.value ELSE 0 END),0) won_revenue,
      COALESCE(AVG(CASE WHEN d.stage='won' THEN d.value END),0) average_won_deal,
      COALESCE(AVG(CASE WHEN d.stage='won' AND d.closed_at IS NOT NULL THEN julianday(d.closed_at)-julianday(d.created_at) END),0) average_sales_cycle_days,
      SUM(CASE WHEN d.stage='won' AND d.expected_close_date IS NOT NULL AND abs(julianday(d.closed_at)-julianday(d.expected_close_date))<=7 THEN 1 ELSE 0 END) close_date_accurate,
      SUM(CASE WHEN d.stage='won' AND d.expected_close_date IS NOT NULL THEN 1 ELSE 0 END) close_date_measured
      FROM deals d WHERE d.workspace_id=? AND ${dateCondition('d','closed_at')}${deals.sql}`).bind(workspaceId, window.from, window.to, ...deals.bindings).first(),
    env.DB.prepare(`SELECT
      SUM(CASE WHEN d.stage='won' THEN 1 ELSE 0 END) won_count,
      SUM(CASE WHEN d.stage='lost' THEN 1 ELSE 0 END) lost_count,
      COALESCE(SUM(CASE WHEN d.stage='won' THEN d.value ELSE 0 END),0) won_revenue
      FROM deals d WHERE d.workspace_id=? AND ${dateCondition('d','closed_at')}${deals.sql}`).bind(workspaceId, window.previous_from, window.previous_to, ...deals.bindings).first(),
    env.DB.prepare(`SELECT COUNT(*) open_deals,COALESCE(SUM(d.value),0) open_pipeline,
      COALESCE(SUM(d.value*d.probability/100.0),0) weighted_pipeline,
      SUM(CASE WHEN d.expected_close_date IS NOT NULL THEN 1 ELSE 0 END) scheduled_deals,
      SUM(CASE WHEN d.next_step IS NOT NULL AND trim(d.next_step)!='' THEN 1 ELSE 0 END) deals_with_next_step
      FROM deals d WHERE d.workspace_id=? AND d.stage NOT IN ('won','lost')${deals.sql}`).bind(workspaceId, ...deals.bindings).first(),
    env.DB.prepare(`SELECT COUNT(*) activities,COUNT(DISTINCT a.organization_id) active_accounts,
      COUNT(DISTINCT a.contact_id) active_contacts,COALESCE(SUM(a.duration_minutes),0) duration_minutes,
      SUM(CASE WHEN a.direction='outbound' THEN 1 ELSE 0 END) outbound,
      SUM(CASE WHEN a.direction='inbound' THEN 1 ELSE 0 END) inbound
      FROM activities a WHERE a.workspace_id=? AND ${dateCondition('a','occurred_at')}${activities.sql}`).bind(workspaceId, window.from, window.to, ...activities.bindings).first(),
    env.DB.prepare(`SELECT COUNT(*) activities,COUNT(DISTINCT a.organization_id) active_accounts
      FROM activities a WHERE a.workspace_id=? AND ${dateCondition('a','occurred_at')}${activities.sql}`).bind(workspaceId, window.previous_from, window.previous_to, ...activities.bindings).first(),
    env.DB.prepare(`SELECT
      SUM(CASE WHEN ${dateCondition('t','due_at')} THEN 1 ELSE 0 END) due,
      SUM(CASE WHEN t.status='completed' AND ${dateCondition('t','due_at')} THEN 1 ELSE 0 END) completed,
      SUM(CASE WHEN t.status='completed' AND ${dateCondition('t','due_at')} AND t.completed_at<=t.due_at THEN 1 ELSE 0 END) completed_on_time,
      SUM(CASE WHEN t.status NOT IN ('completed','cancelled') AND t.due_at<datetime('now') THEN 1 ELSE 0 END) overdue,
      COALESCE(AVG(CASE WHEN t.status='completed' AND ${dateCondition('t','due_at')} THEN julianday(t.completed_at)-julianday(t.due_at) END),0) average_due_variance_days
      FROM tasks t WHERE t.workspace_id=?${tasks.sql}`).bind(window.from, window.to, window.from, window.to, window.from, window.to, window.from, window.to, workspaceId, ...tasks.bindings).first(),
    env.DB.prepare(`SELECT
      SUM(CASE WHEN ${dateCondition('f','due_at')} THEN 1 ELSE 0 END) due,
      SUM(CASE WHEN f.status='completed' AND ${dateCondition('f','due_at')} THEN 1 ELSE 0 END) completed,
      SUM(CASE WHEN f.status='completed' AND ${dateCondition('f','due_at')} AND f.completed_at<=f.due_at THEN 1 ELSE 0 END) completed_on_time,
      SUM(CASE WHEN f.status IN ('open','snoozed') AND COALESCE(f.snoozed_until,f.due_at)<datetime('now') THEN 1 ELSE 0 END) overdue,
      COALESCE(AVG(CASE WHEN f.status='completed' AND ${dateCondition('f','due_at')} THEN julianday(f.completed_at)-julianday(f.due_at) END),0) average_due_variance_days
      FROM follow_ups f WHERE f.workspace_id=?${followUps.sql}`).bind(window.from, window.to, window.from, window.to, window.from, window.to, window.from, window.to, workspaceId, ...followUps.bindings).first(),
    env.DB.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN m.status IN ('sent','delivered') THEN 1 ELSE 0 END) successful,
      SUM(CASE WHEN m.status IN ('failed','bounced','suppressed') THEN 1 ELSE 0 END) failed,
      SUM(CASE WHEN m.status='queued' THEN 1 ELSE 0 END) queued,
      COALESCE(SUM(m.recipient_count),0) recipients,
      COALESCE(AVG(m.delivery_attempts),0) average_attempts
      FROM email_messages m WHERE m.workspace_id=? AND ${dateCondition('m','created_at')}${emails.sql}`).bind(workspaceId, window.from, window.to, ...emails.bindings).first(),
    env.DB.prepare(`SELECT ${revenueBucket} period,COUNT(*) won_count,COALESCE(SUM(d.value),0) won_revenue,
      COALESCE(AVG(d.value),0) average_deal
      FROM deals d WHERE d.workspace_id=? AND d.stage='won' AND ${dateCondition('d','closed_at')}${deals.sql}
      GROUP BY period ORDER BY period`).bind(workspaceId, window.from, window.to, ...deals.bindings).all(),
    env.DB.prepare(`SELECT ${activityBucket} period,COUNT(*) activities,COUNT(DISTINCT a.organization_id) accounts,
      COUNT(DISTINCT a.contact_id) contacts
      FROM activities a WHERE a.workspace_id=? AND ${dateCondition('a','occurred_at')}${activities.sql}
      GROUP BY period ORDER BY period`).bind(workspaceId, window.from, window.to, ...activities.bindings).all(),
    env.DB.prepare(`SELECT a.type,COUNT(*) count,COALESCE(SUM(a.duration_minutes),0) duration_minutes
      FROM activities a WHERE a.workspace_id=? AND ${dateCondition('a','occurred_at')}${activities.sql}
      GROUP BY a.type ORDER BY count DESC`).bind(workspaceId, window.from, window.to, ...activities.bindings).all(),
    env.DB.prepare(`SELECT d.stage,COUNT(*) count,COALESCE(SUM(d.value),0) value,
      COALESCE(SUM(d.value*d.probability/100.0),0) weighted
      FROM deals d WHERE d.workspace_id=?${deals.sql} GROUP BY d.stage`).bind(workspaceId, ...deals.bindings).all(),
    env.DB.prepare(`SELECT u.id,u.name,
      (SELECT COUNT(*) FROM activities a WHERE a.workspace_id=? AND a.user_id=u.id AND ${dateCondition('a','occurred_at')}${filters.account ? ' AND a.organization_id=?' : ''}) activities,
      (SELECT COALESCE(SUM(d.value),0) FROM deals d WHERE d.workspace_id=? AND d.owner_id=u.id AND d.stage='won' AND ${dateCondition('d','closed_at')}${filters.account ? ' AND d.organization_id=?' : ''}) won_revenue,
      (SELECT COUNT(*) FROM deals d WHERE d.workspace_id=? AND d.owner_id=u.id AND d.stage='won' AND ${dateCondition('d','closed_at')}${filters.account ? ' AND d.organization_id=?' : ''}) won_deals,
      (SELECT COALESCE(SUM(d.value*d.probability/100.0),0) FROM deals d WHERE d.workspace_id=? AND d.owner_id=u.id AND d.stage NOT IN ('won','lost')${filters.account ? ' AND d.organization_id=?' : ''}) weighted_pipeline,
      (SELECT COUNT(*) FROM follow_ups f WHERE f.workspace_id=? AND f.owner_id=u.id AND f.status='completed' AND ${dateCondition('f','completed_at')}${filters.account ? ' AND f.organization_id=?' : ''}) follow_ups_completed,
      (SELECT COUNT(*) FROM tasks t WHERE t.workspace_id=? AND t.assignee_id=u.id AND t.status NOT IN ('completed','cancelled') AND t.due_at<datetime('now')${filters.account ? ' AND t.organization_id=?' : ''}) overdue_tasks
      FROM workspace_members wm JOIN users u ON u.id=wm.user_id
      WHERE wm.workspace_id=? AND u.is_active=1${filters.owner ? ' AND u.id=?' : ''}
      ORDER BY won_revenue DESC,activities DESC`).bind(
        workspaceId, window.from, window.to, ...(filters.account ? [filters.account] : []),
        workspaceId, window.from, window.to, ...(filters.account ? [filters.account] : []),
        workspaceId, window.from, window.to, ...(filters.account ? [filters.account] : []),
        workspaceId, ...(filters.account ? [filters.account] : []),
        workspaceId, window.from, window.to, ...(filters.account ? [filters.account] : []),
        workspaceId, ...(filters.account ? [filters.account] : []),
        workspaceId, ...(filters.owner ? [filters.owner] : []),
      ).all(),
    env.DB.prepare(`SELECT COALESCE(NULLIF(trim(d.source),''),'Unknown') source,COUNT(*) opportunities,
      COALESCE(SUM(d.value),0) opportunity_value,
      SUM(CASE WHEN d.stage='won' THEN 1 ELSE 0 END) won_count,
      SUM(CASE WHEN d.stage='lost' THEN 1 ELSE 0 END) lost_count,
      COALESCE(SUM(CASE WHEN d.stage='won' THEN d.value ELSE 0 END),0) won_revenue
      FROM deals d WHERE d.workspace_id=? AND ${dateCondition('d','created_at')}${deals.sql}
      GROUP BY source ORDER BY won_revenue DESC,opportunity_value DESC LIMIT 15`).bind(workspaceId, window.from, window.to, ...deals.bindings).all(),
    env.DB.prepare(`SELECT o.id,o.name,o.account_tier,o.relationship_score,
      (SELECT COUNT(*) FROM activities a WHERE a.workspace_id=o.workspace_id AND a.organization_id=o.id AND ${dateCondition('a','occurred_at')}${filters.owner ? ' AND a.user_id=?' : ''}) activities,
      (SELECT COALESCE(SUM(d.value),0) FROM deals d WHERE d.workspace_id=o.workspace_id AND d.organization_id=o.id AND d.stage='won' AND ${dateCondition('d','closed_at')}${filters.owner ? ' AND d.owner_id=?' : ''}) won_revenue,
      (SELECT COALESCE(SUM(d.value),0) FROM deals d WHERE d.workspace_id=o.workspace_id AND d.organization_id=o.id AND d.stage NOT IN ('won','lost')${filters.owner ? ' AND d.owner_id=?' : ''}) open_pipeline,
      (SELECT COALESCE(SUM(d.value*d.probability/100.0),0) FROM deals d WHERE d.workspace_id=o.workspace_id AND d.organization_id=o.id AND d.stage NOT IN ('won','lost')${filters.owner ? ' AND d.owner_id=?' : ''}) weighted_pipeline,
      (SELECT COUNT(*) FROM contacts c WHERE c.workspace_id=o.workspace_id AND c.organization_id=o.id AND c.status='active'${filters.owner ? ' AND c.owner_id=?' : ''}) contacts
      FROM organizations o WHERE o.workspace_id=? AND o.status='active'${filters.account ? ' AND o.id=?' : ''}
      ORDER BY won_revenue DESC,open_pipeline DESC,activities DESC LIMIT 25`).bind(
        window.from, window.to, ...(filters.owner ? [filters.owner] : []),
        window.from, window.to, ...(filters.owner ? [filters.owner] : []),
        ...(filters.owner ? [filters.owner] : []),
        ...(filters.owner ? [filters.owner] : []),
        ...(filters.owner ? [filters.owner] : []),
        workspaceId, ...(filters.account ? [filters.account] : []),
      ).all(),
    env.DB.prepare(`SELECT COALESCE(NULLIF(trim(d.loss_reason),''),NULLIF(trim(d.close_reason),''),'Unspecified') reason,
      COUNT(*) count,COALESCE(SUM(d.value),0) lost_value
      FROM deals d WHERE d.workspace_id=? AND d.stage='lost' AND ${dateCondition('d','closed_at')}${deals.sql}
      GROUP BY reason ORDER BY lost_value DESC,count DESC LIMIT 12`).bind(workspaceId, window.from, window.to, ...deals.bindings).all(),
    env.DB.prepare(`SELECT
      SUM(CASE WHEN c.relationship_score>=80 THEN 1 ELSE 0 END) strong,
      SUM(CASE WHEN c.relationship_score BETWEEN 55 AND 79 THEN 1 ELSE 0 END) healthy,
      SUM(CASE WHEN c.relationship_score BETWEEN 35 AND 54 THEN 1 ELSE 0 END) attention,
      SUM(CASE WHEN c.relationship_score<35 THEN 1 ELSE 0 END) at_risk,
      COALESCE(AVG(c.relationship_score),0) average_score
      FROM contacts c WHERE c.workspace_id=? AND c.status='active'${contacts.sql}`).bind(workspaceId, ...contacts.bindings).first(),
    env.DB.prepare(`SELECT c.lifecycle_stage,COUNT(*) count FROM contacts c
      WHERE c.workspace_id=? AND c.status='active'${contacts.sql} GROUP BY c.lifecycle_stage ORDER BY count DESC`).bind(workspaceId, ...contacts.bindings).all(),
  ]);

  const closedTotal = numeric(closedCurrent?.won_count) + numeric(closedCurrent?.lost_count);
  const previousClosedTotal = numeric(closedPrevious?.won_count) + numeric(closedPrevious?.lost_count);
  const closeMeasured = numeric(closedCurrent?.close_date_measured);
  const totalWonRevenue = numeric(closedCurrent?.won_revenue);
  const accountRows = accounts.results || [];
  const concentrationBase = totalWonRevenue;
  const accountPerformance = accountRows.map((row) => ({
    ...row,
    revenue_share: concentrationBase ? Math.round(numeric(row.won_revenue) / concentrationBase * 1000) / 10 : 0,
  }));
  const sourcePerformance = (sources.results || []).map((row) => ({
    ...row,
    win_rate: completionRate(row.won_count, numeric(row.won_count) + numeric(row.lost_count)),
  }));

  return {
    generated_at: new Date().toISOString(),
    report: {
      ...window,
      account_id: filters.account,
      owner_id: filters.owner,
      currency: ctx.workspace.currency || 'EUR',
      workspace_name: ctx.workspace.name,
    },
    executive: {
      won_revenue: totalWonRevenue,
      won_revenue_change: percentChange(totalWonRevenue, closedPrevious?.won_revenue),
      won_deals: numeric(closedCurrent?.won_count),
      win_rate: completionRate(closedCurrent?.won_count, closedTotal),
      previous_win_rate: completionRate(closedPrevious?.won_count, previousClosedTotal),
      average_won_deal: numeric(closedCurrent?.average_won_deal),
      average_sales_cycle_days: Math.round(numeric(closedCurrent?.average_sales_cycle_days) * 10) / 10,
      close_date_accuracy: closeMeasured ? Math.round(numeric(closedCurrent?.close_date_accurate) / closeMeasured * 1000) / 10 : 0,
      open_pipeline: numeric(openPipeline?.open_pipeline),
      weighted_pipeline: numeric(openPipeline?.weighted_pipeline),
      open_deals: numeric(openPipeline?.open_deals),
      forecast_coverage: completionRate(openPipeline?.scheduled_deals, openPipeline?.open_deals),
      next_step_coverage: completionRate(openPipeline?.deals_with_next_step, openPipeline?.open_deals),
      activities: numeric(activityCurrent?.activities),
      activity_change: percentChange(activityCurrent?.activities, activityPrevious?.activities),
      active_accounts: numeric(activityCurrent?.active_accounts),
      active_contacts: numeric(activityCurrent?.active_contacts),
      engagement_minutes: numeric(activityCurrent?.duration_minutes),
    },
    execution: {
      tasks: {
        ...taskStats,
        completion_rate: completionRate(taskStats?.completed, taskStats?.due),
        on_time_rate: completionRate(taskStats?.completed_on_time, taskStats?.completed),
      },
      follow_ups: {
        ...followUpStats,
        completion_rate: completionRate(followUpStats?.completed, followUpStats?.due),
        on_time_rate: completionRate(followUpStats?.completed_on_time, followUpStats?.completed),
      },
      email: {
        ...emailStats,
        delivery_rate: deliveryRate(emailStats?.successful, emailStats?.failed),
      },
    },
    trends: {
      revenue: revenueTrend.results || [],
      activity: activityTrend.results || [],
      granularity: window.granularity,
    },
    activity_mix: activityMix.results || [],
    funnel: funnel.results || [],
    team_performance: team.results || [],
    source_performance: sourcePerformance,
    account_performance: accountPerformance,
    loss_reasons: losses.results || [],
    relationship_health: health || {},
    lifecycle: lifecycle.results || [],
    comparison: {
      previous_won_revenue: numeric(closedPrevious?.won_revenue),
      previous_won_deals: numeric(closedPrevious?.won_count),
      previous_activities: numeric(activityPrevious?.activities),
      previous_active_accounts: numeric(activityPrevious?.active_accounts),
    },
  };
}
