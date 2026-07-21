import { readFile, writeFile, unlink } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');
const write = (path, content) => writeFile(path, content.endsWith('\n') ? content : `${content}\n`);

function replaceOnce(content, search, replacement, label) {
  if (content.includes(replacement)) return content;
  if (!content.includes(search)) throw new Error(`Unable to patch ${label}: marker not found`);
  return content.replace(search, replacement);
}

const packagePath = 'package.json';
const pkg = JSON.parse(await read(packagePath));
pkg.version = '2.1.0';
pkg.description = 'Cloudflare-native multi-workspace relationship CRM with integrated business email';
pkg.scripts.check = 'node --check src/worker.js && node --check src/email.js && node --check src/email-worker.js && node --check src/lib/domain.js && node --check src/lib/email.js && node --check public/app.js && node --check public/email.js && node --check scripts/dev-server.mjs';
pkg.scripts['deploy:email'] = 'wrangler deploy --config wrangler.email.jsonc';
pkg.scripts['deploy:all'] = 'npm run deploy:email && npm run deploy';
await write(packagePath, JSON.stringify(pkg, null, 2));

const wranglerPath = 'wrangler.jsonc';
const wrangler = JSON.parse(await read(wranglerPath));
wrangler.vars.EMAIL_ALLOWED_DOMAINS = 'goldendragoncapital.co,devriessalesconsultancy.com,partnermarketglobal.com';
wrangler.services = [{ binding: 'EMAIL_SERVICE', service: 'partnermarket-global-email-worker' }];
await write(wranglerPath, JSON.stringify(wrangler, null, 2));

const workerPath = 'src/worker.js';
let worker = await read(workerPath);
worker = replaceOnce(
  worker,
  "} from './lib/domain.js';\n",
  "} from './lib/domain.js';\nimport { createEmailSender, listEmailMessages, listEmailSenders, sendCrmEmail, updateEmailSender } from './email.js';\n",
  workerPath,
);
const emailRoutes = `  if(p[1]==='email'&&p[2]==='senders'&&!p[3]&&method==='GET')return json(await listEmailSenders(env,ctx));
  if(p[1]==='email'&&p[2]==='senders'&&!p[3]&&method==='POST')return json(await createEmailSender(env,ctx,request),201);
  if(p[1]==='email'&&p[2]==='senders'&&p[3]&&method==='PATCH')return json(await updateEmailSender(env,ctx,request,p[3]));
  if(p[1]==='email'&&p[2]==='messages'&&method==='GET')return json(await listEmailMessages(env,ctx,request));
  if(p[1]==='email'&&p[2]==='send'&&method==='POST')return json(await sendCrmEmail(env,ctx,request),201);
`;
worker = replaceOnce(worker, "  return error('API route not found',404);", `${emailRoutes}  return error('API route not found',404);`, workerPath);
worker = worker.replace("version:'2.0.0'", "version:'2.1.0'");
await write(workerPath, worker);

const indexPath = 'public/index.html';
let index = await read(indexPath);
index = replaceOnce(index, '  <script src="/app.js" type="module"></script>', '  <script src="/app.js" type="module"></script>\n  <script src="/email.js" type="module"></script>', indexPath);
await write(indexPath, index);

const devPath = 'scripts/dev-server.mjs';
let dev = await read(devPath);
const mockData = `const emailSenders=[
  {id:'es-pmg',workspace_id:'ws-pmg',email_address:'info@partnermarketglobal.com',display_name:'PartnerMarket Global',reply_to:'info@partnermarketglobal.com',domain:'partnermarketglobal.com',is_default:1,is_active:1},
  {id:'es-pmg-gdc',workspace_id:'ws-pmg',email_address:'info@goldendragoncapital.co',display_name:'Golden Dragon Capital',reply_to:'info@goldendragoncapital.co',domain:'goldendragoncapital.co',is_default:0,is_active:1},
  {id:'es-pmg-dv',workspace_id:'ws-pmg',email_address:'info@devriessalesconsultancy.com',display_name:'De Vries Sales Consultancy',reply_to:'info@devriessalesconsultancy.com',domain:'devriessalesconsultancy.com',is_default:0,is_active:1},
  {id:'es-gdc',workspace_id:'ws-gdc',email_address:'info@goldendragoncapital.co',display_name:'Golden Dragon Capital',reply_to:'info@goldendragoncapital.co',domain:'goldendragoncapital.co',is_default:1,is_active:1},
  {id:'es-gdc-pmg',workspace_id:'ws-gdc',email_address:'info@partnermarketglobal.com',display_name:'PartnerMarket Global',reply_to:'info@partnermarketglobal.com',domain:'partnermarketglobal.com',is_default:0,is_active:1},
  {id:'es-gdc-dv',workspace_id:'ws-gdc',email_address:'info@devriessalesconsultancy.com',display_name:'De Vries Sales Consultancy',reply_to:'info@devriessalesconsultancy.com',domain:'devriessalesconsultancy.com',is_default:0,is_active:1},
];
const emailMessages=[];

`;
dev = replaceOnce(dev, 'function body(req){', `${mockData}function body(req){`, devPath);
const mockRoutes = `  if(p[1]==='email'&&p[2]==='senders'&&!p[3]&&method==='GET')return respond(res,200,visible(emailSenders,ws).filter(s=>s.is_active));
  if(p[1]==='email'&&p[2]==='senders'&&!p[3]&&method==='POST'){const d=await body(req);const sender={id:uid(),workspace_id:ws,is_default:0,is_active:1,domain:String(d.email_address||'').split('@').at(-1),...d};emailSenders.push(sender);return respond(res,201,sender);}
  if(p[1]==='email'&&p[2]==='senders'&&p[3]&&method==='PATCH'){const sender=emailSenders.find(s=>s.id===p[3]&&s.workspace_id===ws);if(!sender)return respond(res,404,{error:'Sender identity not found'});Object.assign(sender,await body(req));return respond(res,200,sender);}
  if(p[1]==='email'&&p[2]==='messages'&&method==='GET')return respond(res,200,visible(emailMessages,ws).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,Number(url.searchParams.get('limit')||100)));
  if(p[1]==='email'&&p[2]==='send'&&method==='POST'){const d=await body(req);const sender=emailSenders.find(s=>s.id===d.sender_identity_id&&s.workspace_id===ws);if(!sender)return respond(res,400,{error:'Select an active sender identity'});const c=contacts.find(x=>x.id===d.contact_id&&x.workspace_id===ws)||contacts.find(x=>x.workspace_id===ws&&x.email?.toLowerCase()===String(d.to||'').toLowerCase());const organizationId=d.organization_id||c?.organization_id;const o=organizations.find(x=>x.id===organizationId&&x.workspace_id===ws);if(!o)return respond(res,400,{error:'Select the account this email belongs to'});if(c&&(c.email_opt_out||c.status==='do_not_contact'||c.consent_status==='withdrawn'))return respond(res,409,{error:'This contact has opted out of email communication'});const sentAt=iso();const message={id:uid(),workspace_id:ws,sender_identity_id:sender.id,contact_id:c?.id||null,organization_id:o.id,deal_id:d.deal_id||null,user_id:'u1',from_email:sender.email_address,from_name:sender.display_name,reply_to:sender.reply_to,to:[String(d.to||'').trim()],cc:String(d.cc||'').split(/[;,]/).map(x=>x.trim()).filter(Boolean),bcc:String(d.bcc||'').split(/[;,]/).map(x=>x.trim()).filter(Boolean),subject:d.subject,text_body:d.text_body,html_body:d.html_body,status:'sent',provider_message_id:'mock-'+uid(),sent_at:sentAt,created_at:sentAt,organization_name:o.name,contact_name:c?c.first_name+' '+c.last_name:null};emailMessages.push(message);activities.push({id:uid(),workspace_id:ws,contact_id:c?.id||null,organization_id:o.id,deal_id:d.deal_id||null,user_id:'u1',user_name:'Alex de Vries',contact_name:message.contact_name,organization_name:o.name,type:'email',direction:'outbound',subject:d.subject,body:d.text_body,outcome:'Sent',occurred_at:sentAt,metadata:{email_message_id:message.id,from:sender.email_address,to:message.to}});o.last_contact_at=sentAt;if(c)c.last_contact_at=sentAt;if(d.follow_up_due_at)followUps.push({id:uid(),workspace_id:ws,contact_id:c?.id||null,organization_id:o.id,deal_id:d.deal_id||null,owner_id:'u1',owner_name:'Alex de Vries',contact_name:message.contact_name,organization_name:o.name,title:d.follow_up_title||'Follow up: '+d.subject,channel:'email',status:'open',priority:d.follow_up_priority||'medium',due_at:d.follow_up_due_at,cadence:'none'});return respond(res,201,message);}
`;
dev = replaceOnce(dev, "  if(p[1]==='analytics'){", `${mockRoutes}  if(p[1]==='analytics'){`, devPath);
await write(devPath, dev);

const readmePath = 'README.md';
let readme = await read(readmePath);
if (!readme.includes('## Integrated business email')) {
  readme += `\n## Integrated business email\n\nCRM users can compose email from approved identities on **goldendragoncapital.co**, **devriessalesconsultancy.com**, and **partnermarketglobal.com**. A private Cloudflare Email Worker performs delivery while the CRM Worker resolves the account/contact, applies consent rules, records provider status, and writes successful sends into the chronological contact log.\n\nDeploy the private worker before the CRM worker:\n\n\`\`\`bash\nnpm run db:migrate:remote\nnpm run deploy:email\nnpm run deploy\n\`\`\`\n\nSee [docs/EMAIL-SERVICE.md](docs/EMAIL-SERVICE.md) for domain onboarding, DNS authentication, deployment, and logging details.\n`;
}
await write(readmePath, readme);

for (const path of ['scripts/apply-email-composer.mjs', '.email-composer-trigger']) {
  try { await unlink(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
