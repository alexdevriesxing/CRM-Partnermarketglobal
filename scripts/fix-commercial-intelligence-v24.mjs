import { readFile, writeFile } from 'node:fs/promises';

async function update(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  await writeFile(path, after);
}

await update('tests/email-center.test.mjs', (content) => content
  .replace("test('release and mock server identify v2.3.0'", "test('release and mock server identify v2.4.0'")
  .replace("assert.equal(JSON.parse(pkg).version, '2.3.0')", "assert.equal(JSON.parse(pkg).version, '2.4.0')")
  .replace(/version:'2\\\.3\\\.0'/g, "version:'2\\.4\\.0'"));

await update('src/intelligence.js', (content) => {
  let result = content
    .replace("const raw = Number(new URL(request.url).searchParams.get('days') || 90);", "const raw = Number(new URL(request.url).searchParams.get('days') || 30);")
    .replace("return Math.max(30, Math.min(365, Number.isFinite(raw) ? Math.trunc(raw) : 90));", "return Math.max(30, Math.min(180, Number.isFinite(raw) ? Math.trunc(raw) : 30));")
    .replace('function riskReasons(row) {', 'function riskReasons(row, staleDays) {')
    .replace("if (number(row.is_stale)) reasons.push('No update in 30+ days');", "if (number(row.is_stale)) reasons.push(`No update in ${staleDays}+ days`);")
    .replace("  const modifier = `-${days} days`;", "  const modifier = `-${days} days`;\n  const accountInactivityDays = Math.min(365, days * 2);\n  const accountModifier = `-${accountInactivityDays} days`;")
    .replaceAll("datetime('now','-30 days')", "datetime('now','${modifier}')")
    .replaceAll("datetime('now','-60 days')", "datetime('now','${accountModifier}')")
    .replace('riskReasons(row) }));', 'riskReasons(row, days) }));')
    .replace("    window_days: days,\n    account_id: scope.accountId,", "    window_days: days,\n    stale_after_days: days,\n    account_inactive_after_days: accountInactivityDays,\n    account_id: scope.accountId,");
  return result;
});

await update('public/intelligence.js', (content) => content
  .replace("days: '90'", "days: '30'")
  .replace('<option value="30" ${data.window_days===30?\'selected\':\'\'}>30-day activity</option><option value="90" ${data.window_days===90?\'selected\':\'\'}>90-day activity</option><option value="180" ${data.window_days===180?\'selected\':\'\'}>180-day activity</option><option value="365" ${data.window_days===365?\'selected\':\'\'}>365-day activity</option>', '<option value="30" ${data.window_days===30?\'selected\':\'\'}>30-day risk window</option><option value="60" ${data.window_days===60?\'selected\':\'\'}>60-day risk window</option><option value="90" ${data.window_days===90?\'selected\':\'\'}>90-day risk window</option><option value="180" ${data.window_days===180?\'selected\':\'\'}>180-day risk window</option>')
  .replace('No update in 30+ days</small>', 'No update in ${data.stale_after_days || 30}+ days</small>')
  .replace("  root.innerHTML = `\n", "  const navigationRiskBadge = document.querySelector('#intelligenceRiskCount');\n  if (navigationRiskBadge) navigationRiskBadge.textContent = Number(data.summary?.urgent_deals || 0) || '';\n\n  root.innerHTML = `\n"));

await update('scripts/dev-server.mjs', (content) => {
  const start = content.indexOf("  if(p[1]==='intelligence'){");
  const end = content.indexOf("  if(p[1]==='analytics'){", start);
  if (start < 0 || end < 0) return content;
  let block = content.slice(start, end);
  block = block
    .replace("const account=url.searchParams.get('account');const cs=", "const staleDays=Math.max(30,Math.min(180,Number(url.searchParams.get('days')||30)));const account=url.searchParams.get('account');const cs=")
    .replaceAll('now-30*864e5', 'now-staleDays*864e5')
    .replaceAll('now-60*864e5', 'now-staleDays*2*864e5')
    .replace("window_days:Number(url.searchParams.get('days')||90),account_id", "window_days:staleDays,stale_after_days:staleDays,account_inactive_after_days:Math.min(365,staleDays*2),account_id");
  return `${content.slice(0, start)}${block}${content.slice(end)}`;
});

await update('tests/mock-server.test.mjs', (content) => content
  .replace('assert.equal(all.window_days,90)', 'assert.equal(all.window_days,30)')
  .replace("assert.equal(focused.account_id,'o1');", "assert.equal(focused.account_id,'o1');assert.equal(focused.stale_after_days,30);"));

await update('tests/intelligence.test.mjs', (content) => {
  if (content.includes("test('risk window drives stale thresholds")) return content;
  return `${content.trimEnd()}\n\ntest('risk window drives stale thresholds and sidebar attention', async () => {\n  const [backend, ui] = await Promise.all([read('src/intelligence.js'), read('public/intelligence.js')]);\n  assert.match(backend, /stale_after_days: days/);\n  assert.match(backend, /account_inactive_after_days: accountInactivityDays/);\n  assert.match(backend, /datetime\\('now','\\$\\{modifier\\}'\\)/);\n  assert.match(ui, /60-day risk window/);\n  assert.match(ui, /intelligenceRiskCount/);\n});\n`;
});

await update('docs/COMMERCIAL-INTELLIGENCE.md', (content) => content
  .replace('- `days`: activity window between 30 and 365 days.', '- `days`: inactivity risk threshold between 30 and 180 days. Account inactivity uses twice the selected threshold, capped at 365 days.')
  .replace('opportunities with no update for at least 30 days;', 'opportunities with no update within the selected 30, 60, 90 or 180-day risk window;'));

console.log('Updated release expectations and operational risk-window behavior.');
