import { readFile, writeFile } from 'node:fs/promises';

async function update(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  await writeFile(path, after);
}

await update('tests/intelligence.test.mjs', (content) => content
  .replace("commercial intelligence release reports v2.4.0", "commercial intelligence release reports v2.5.0")
  .replace("assert.equal(JSON.parse(pkg).version,'2.4.0')", "assert.equal(JSON.parse(pkg).version,'2.5.0')")
  .replace("assert.equal(JSON.parse(pkg).version, '2.4.0')", "assert.equal(JSON.parse(pkg).version, '2.5.0')")
  .replaceAll("/version:'2\\.4\\.0'/", "/version:'2\\.5\\.0'/"));

await update('scripts/dev-server.mjs', (content) => content
  .replace("const start=new Date(from+'T00:00:00Z'),end=new Date(to+'T23:59:59Z');\n    const days=Math.round((end-start)/864e5)+1;", "const start=new Date(from+'T00:00:00Z'),endDate=new Date(to+'T00:00:00Z'),end=new Date(to+'T23:59:59Z');\n    const days=Math.round((endDate-start)/864e5)+1;"));

await update('src/reporting.js', (content) => content
  .replace("if (granularity === 'week') return `date(${alias}.${field},'weekday 1','-7 days')`;", "if (granularity === 'week') return `date(${alias}.${field}, '-' || ((CAST(strftime('%w',${alias}.${field}) AS INTEGER)+6)%7) || ' days')`;")
  .replace("SUM(CASE WHEN ${dateCondition('t','created_at')} THEN 1 ELSE 0 END) created,", "SUM(CASE WHEN ${dateCondition('t','due_at')} THEN 1 ELSE 0 END) due,")
  .replace("SUM(CASE WHEN t.status='completed' AND ${dateCondition('t','completed_at')} THEN 1 ELSE 0 END) completed,", "SUM(CASE WHEN t.status='completed' AND ${dateCondition('t','due_at')} THEN 1 ELSE 0 END) completed,")
  .replace("SUM(CASE WHEN t.status='completed' AND ${dateCondition('t','completed_at')} AND t.due_at IS NOT NULL AND t.completed_at<=t.due_at THEN 1 ELSE 0 END) completed_on_time,", "SUM(CASE WHEN t.status='completed' AND ${dateCondition('t','due_at')} AND t.completed_at<=t.due_at THEN 1 ELSE 0 END) completed_on_time,")
  .replace("COALESCE(AVG(CASE WHEN t.status='completed' AND t.due_at IS NOT NULL THEN julianday(t.completed_at)-julianday(t.due_at) END),0) average_due_variance_days", "COALESCE(AVG(CASE WHEN t.status='completed' AND ${dateCondition('t','due_at')} THEN julianday(t.completed_at)-julianday(t.due_at) END),0) average_due_variance_days")
  .replace("FROM tasks t WHERE t.workspace_id=?${tasks.sql}`).bind(window.from, window.to, window.from, window.to, window.from, window.to, workspaceId, ...tasks.bindings).first(),", "FROM tasks t WHERE t.workspace_id=?${tasks.sql}`).bind(window.from, window.to, window.from, window.to, window.from, window.to, window.from, window.to, workspaceId, ...tasks.bindings).first(),")
  .replace("SUM(CASE WHEN ${dateCondition('f','created_at')} THEN 1 ELSE 0 END) created,", "SUM(CASE WHEN ${dateCondition('f','due_at')} THEN 1 ELSE 0 END) due,")
  .replace("SUM(CASE WHEN f.status='completed' AND ${dateCondition('f','completed_at')} THEN 1 ELSE 0 END) completed,", "SUM(CASE WHEN f.status='completed' AND ${dateCondition('f','due_at')} THEN 1 ELSE 0 END) completed,")
  .replace("SUM(CASE WHEN f.status='completed' AND ${dateCondition('f','completed_at')} AND f.completed_at<=f.due_at THEN 1 ELSE 0 END) completed_on_time,", "SUM(CASE WHEN f.status='completed' AND ${dateCondition('f','due_at')} AND f.completed_at<=f.due_at THEN 1 ELSE 0 END) completed_on_time,")
  .replace("COALESCE(AVG(CASE WHEN f.status='completed' THEN julianday(f.completed_at)-julianday(f.due_at) END),0) average_due_variance_days", "COALESCE(AVG(CASE WHEN f.status='completed' AND ${dateCondition('f','due_at')} THEN julianday(f.completed_at)-julianday(f.due_at) END),0) average_due_variance_days")
  .replace("FROM follow_ups f WHERE f.workspace_id=?${followUps.sql}`).bind(window.from, window.to, window.from, window.to, window.from, window.to, workspaceId, ...followUps.bindings).first(),", "FROM follow_ups f WHERE f.workspace_id=?${followUps.sql}`).bind(window.from, window.to, window.from, window.to, window.from, window.to, window.from, window.to, workspaceId, ...followUps.bindings).first(),")
  .replace("const concentrationBase = accountRows.reduce((sum, row) => sum + numeric(row.won_revenue), 0);", "const concentrationBase = totalWonRevenue;")
  .replace("completion_rate: completionRate(taskStats?.completed, taskStats?.created),", "completion_rate: completionRate(taskStats?.completed, taskStats?.due),")
  .replace("completion_rate: completionRate(followUpStats?.completed, followUpStats?.created),", "completion_rate: completionRate(followUpStats?.completed, followUpStats?.due),"));

await update('docs/ANALYTICS-REPORTING.md', (content) => {
  const marker = 'Task and follow-up on-time rates compare completion timestamps with due timestamps.';
  const replacement = 'Task and follow-up completion rates use items due during the selected period as the cohort. On-time rates compare completion timestamps with due timestamps, preventing completion percentages from exceeding 100% because of work created in another period.';
  return content.replace(marker, replacement);
});

await update('tests/reporting.test.mjs', (content) => {
  if (content.includes("due-period cohorts keep execution rates bounded")) return content;
  return `${content.trimEnd()}\n\ntest('due-period cohorts keep execution rates bounded and concentration honest', async () => {\n  const backend = await read('src/reporting.js');\n  assert.match(backend, /taskStats\\?\\.due/);\n  assert.match(backend, /followUpStats\\?\\.due/);\n  assert.match(backend, /const concentrationBase = totalWonRevenue/);\n  assert.match(backend, /CAST\\(strftime\\('%w'/);\n});\n`;
});

await update('tests/reporting-sql.test.mjs', (content) => content
  .replace("assert.equal(report.execution.email.delivery_rate, 100);", "assert.equal(report.execution.email.delivery_rate, 100);\n  assert.ok(report.execution.tasks.completion_rate <= 100);\n  assert.ok(report.execution.follow_ups.completion_rate <= 100);"));

console.log('Corrected release expectations, report dates, SLA cohorts, weekly buckets and concentration metrics.');
