import { readFile, writeFile } from 'node:fs/promises';

async function replaceFile(path, transformations) {
  let source = await readFile(path, 'utf8');
  for (const [label, before, after] of transformations) {
    if (!source.includes(before)) throw new Error(`${label}: expected source was not found in ${path}`);
    source = source.replace(before, after);
  }
  await writeFile(path, source);
}

await replaceFile('src/email.js', [
  ['email imports', `import {
  isAllowedSender,
  normalizeEmailList,
  parseAllowedDomains,
  plainTextFromHtml,
  recipientCount,
  validateEmailAddress,
} from './lib/email.js';`, `import {
  attachmentMetadata,
  isAllowedSender,
  normalizeAttachments,
  normalizeClientRequestId,
  normalizeEmailList,
  parseAllowedDomains,
  plainTextFromHtml,
  recipientCount,
  validateEmailAddress,
} from './lib/email.js';`],
  ['message record attachments', `    bcc: parseJson(row.bcc_json, []),
  } : null;`, `    bcc: parseJson(row.bcc_json, []),
    attachments: parseJson(row.attachments_json, []),
  } : null;`],
  ['queued activity signature', `async function createQueuedEmailActivity(env, ctx, data, association, emailId, sender, recipients, createdAt) {
  const activityId = id();
  const body = text(data.text_body, plainTextFromHtml(data.html_body));
  const metadata = activityMetadata(emailId, sender, recipients, 'queued', { html_body: text(data.html_body) });`, `async function createQueuedEmailActivity(env, ctx, data, association, emailId, sender, recipients, createdAt, attachments, clientRequestId) {
  const activityId = id();
  const body = text(data.text_body, plainTextFromHtml(data.html_body));
  const metadata = activityMetadata(emailId, sender, recipients, 'queued', {
    html_body: text(data.html_body),
    attachments: attachmentMetadata(attachments),
    client_request_id: clientRequestId,
  });`],
  ['send data preparation', `  const data = await bodyJson(request);
  const recipients = {`, `  const data = await bodyJson(request);
  const clientRequestId = normalizeClientRequestId(request.headers.get('idempotency-key') || data.client_request_id || crypto.randomUUID());
  const existing = await env.DB.prepare('SELECT * FROM email_messages WHERE workspace_id=? AND client_request_id=? LIMIT 1').bind(ctx.workspace.id, clientRequestId).first();
  if (existing) {
    if (existing.status === 'failed') throw Object.assign(new Error('This send request already failed. Duplicate the draft before retrying so a new request ID is used.'), { status: 409, code: 'E_IDEMPOTENCY_FAILED' });
    return { ...messageRecord(existing), idempotent_replay: true };
  }
  const attachments = normalizeAttachments(data.attachments);
  const recipients = {`],
  ['email insert', `  await env.DB.prepare(\`INSERT INTO email_messages
    (id,workspace_id,sender_identity_id,contact_id,organization_id,deal_id,user_id,from_email,from_name,reply_to,to_json,cc_json,bcc_json,subject,text_body,html_body,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)\`).bind(
      emailId, ctx.workspace.id, sender.id, association.contact?.id || null, association.organization.id, association.deal?.id || null, ctx.user.id,
      sender.email_address, sender.display_name, sender.reply_to, JSON.stringify(recipients.to), JSON.stringify(recipients.cc), JSON.stringify(recipients.bcc),
      text(data.subject), text(data.text_body), text(data.html_body), 'queued', createdAt, createdAt
    ).run();`, `  await env.DB.prepare(\`INSERT INTO email_messages
    (id,workspace_id,sender_identity_id,contact_id,organization_id,deal_id,user_id,from_email,from_name,reply_to,to_json,cc_json,bcc_json,subject,text_body,html_body,status,client_request_id,attachments_json,recipient_count,delivery_attempts,last_attempt_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)\`).bind(
      emailId, ctx.workspace.id, sender.id, association.contact?.id || null, association.organization.id, association.deal?.id || null, ctx.user.id,
      sender.email_address, sender.display_name, sender.reply_to, JSON.stringify(recipients.to), JSON.stringify(recipients.cc), JSON.stringify(recipients.bcc),
      text(data.subject), text(data.text_body), text(data.html_body), 'queued', clientRequestId, JSON.stringify(attachmentMetadata(attachments)), recipientCount(recipients), 1, createdAt, createdAt, createdAt
    ).run();`],
  ['queued activity call', `    activityId = await createQueuedEmailActivity(env, ctx, data, association, emailId, sender, recipients, createdAt);`, `    activityId = await createQueuedEmailActivity(env, ctx, data, association, emailId, sender, recipients, createdAt, attachments, clientRequestId);`],
  ['service request headers', `      headers: { 'content-type': 'application/json' },`, `      headers: { 'content-type': 'application/json', 'x-request-id': clientRequestId },`],
  ['service request body', `        html: text(data.html_body),
      }),`, `        html: text(data.html_body),
        attachments,
        clientRequestId,
      }),`],
  ['sent metadata', `  const sentMetadata = activityMetadata(emailId, sender, recipients, 'sent', { provider_message_id: delivery.messageId, html_body: text(data.html_body) });`, `  const sentMetadata = activityMetadata(emailId, sender, recipients, 'sent', {
    provider_message_id: delivery.messageId,
    html_body: text(data.html_body),
    attachments: attachmentMetadata(attachments),
    client_request_id: clientRequestId,
  });`],
  ['safe response fields', `      subject: text(data.subject),
    }),`, `      subject: text(data.subject),
      attachments: attachmentMetadata(attachments),
      client_request_id: clientRequestId,
      recipient_count: recipientCount(recipients),
    }),`],
  ['response replay false', `    logging_warning: loggingWarning,
  };`, `    logging_warning: loggingWarning,
    idempotent_replay: false,
  };`],
]);

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
packageJson.version = '2.2.0';
packageJson.scripts.check = `${packageJson.scripts.check} && node --check scripts/preflight-production.mjs`;
packageJson.scripts['preflight:production'] = 'node scripts/preflight-production.mjs';
await writeFile('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
lock.version = '2.2.0';
if (lock.packages?.['']) lock.packages[''].version = '2.2.0';
await writeFile('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);

await replaceFile('src/worker.js', [
  ['worker version', `version:'2.1.0'`, `version:'2.2.0'`],
]);

await replaceFile('.github/workflows/deploy.yml', [
  ['npm ci', `      - name: Install dependencies
        run: npm install`, `      - name: Install locked dependencies
        run: npm ci`],
  ['production preflight', `      - name: Apply D1 migrations
        run: npm run db:migrate:remote`, `      - name: Production preflight
        run: npm run preflight:production
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          EMAIL_DOMAINS_ONBOARDED: \${{ vars.EMAIL_DOMAINS_ONBOARDED }}
      - name: Apply D1 migrations
        run: npm run db:migrate:remote`],
]);

console.log('Final email polish integration applied.');
