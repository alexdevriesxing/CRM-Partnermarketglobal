import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseCsv, normalizeTags, clamp, STAGE_PROBABILITIES } from '../src/lib/domain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

function ago(days) { return new Date(Date.now() - days * 86_400_000).toISOString(); }
function ahead(days) { return new Date(Date.now() + days * 86_400_000).toISOString(); }
function uid(prefix) { return `${prefix}_${crypto.randomUUID()}`; }

export function createStore() {
  const users = [
    { id: 'usr_alex', email: 'alex@example.com', name: 'Alex de Vries', role: 'admin', is_active: 1 },
    { id: 'usr_team', email: 'team@example.com', name: 'Partner Team', role: 'manager', is_active: 1 },
  ];
  const organizations = [
    { id: 'org_northstar', name: 'Northstar Consumer Partners', domain: 'northstar.example', industry: 'FMCG Investment', type: 'investor', status: 'active', country: 'Netherlands', city: 'Amsterdam', owner_id: 'usr_alex', annual_value: 180000, relationship_score: 86, last_contact_at: ago(2), next_follow_up_at: ahead(2), tags: ['priority','consumer','europe'] },
    { id: 'org_javafoods', name: 'Java Foods Distribution', domain: 'javafoods.example', industry: 'Food Distribution', type: 'partner', status: 'active', country: 'Indonesia', city: 'Jakarta', owner_id: 'usr_alex', annual_value: 95000, relationship_score: 73, last_contact_at: ago(8), next_follow_up_at: ahead(1), tags: ['indonesia','distribution'] },
    { id: 'org_sakura', name: 'Sakura Retail Systems', domain: 'sakura.example', industry: 'Retail Technology', type: 'prospect', status: 'active', country: 'Singapore', city: 'Singapore', owner_id: 'usr_team', annual_value: 60000, relationship_score: 62, last_contact_at: ago(14), next_follow_up_at: ago(1), tags: ['saas','retail-tech'] },
    { id: 'org_alpine', name: 'Alpine Private Brands', domain: 'alpine.example', industry: 'Private Label', type: 'client', status: 'active', country: 'Germany', city: 'Hamburg', owner_id: 'usr_alex', annual_value: 125000, relationship_score: 91, last_contact_at: ago(1), next_follow_up_at: ahead(7), tags: ['client','private-label'] },
    { id: 'org_bluewave', name: 'BlueWave Market Access', domain: 'bluewave.example', industry: 'Market Expansion', type: 'prospect', status: 'active', country: 'United Kingdom', city: 'London', owner_id: 'usr_team', annual_value: 48000, relationship_score: 57, last_contact_at: ago(31), next_follow_up_at: ahead(3), tags: ['uk','advisory'] },
    { id: 'org_orient', name: 'Orient Growth Capital', domain: 'orient.example', industry: 'Private Equity', type: 'investor', status: 'active', country: 'Singapore', city: 'Singapore', owner_id: 'usr_alex', annual_value: 220000, relationship_score: 79, last_contact_at: ago(6), next_follow_up_at: ahead(5), tags: ['investor','asia'] },
  ];
  const contacts = [
    { id: 'ct_maya', organization_id: 'org_northstar', first_name: 'Maya', last_name: 'Van den Berg', job_title: 'Investment Director', email: 'maya@northstar.example', phone: '+31 20 555 0142', preferred_channel: 'email', lifecycle_stage: 'opportunity', status: 'active', owner_id: 'usr_alex', relationship_score: 88, source: 'Referral', timezone: 'Europe/Amsterdam', last_contact_at: ago(2), next_follow_up_at: ahead(2), notes: 'Interested in consumer growth opportunities across Southeast Asia.', tags: ['decision-maker','warm'] },
    { id: 'ct_ardi', organization_id: 'org_javafoods', first_name: 'Ardi', last_name: 'Pratama', job_title: 'Commercial Director', email: 'ardi@javafoods.example', phone: '+62 21 555 0188', preferred_channel: 'whatsapp', lifecycle_stage: 'partner', status: 'active', owner_id: 'usr_alex', relationship_score: 76, source: 'Conference', timezone: 'Asia/Jakarta', last_contact_at: ago(8), next_follow_up_at: ahead(1), notes: 'Discuss national distribution and channel expansion.', tags: ['distribution','indonesia'] },
    { id: 'ct_lina', organization_id: 'org_sakura', first_name: 'Lina', last_name: 'Tan', job_title: 'Founder', email: 'lina@sakura.example', phone: '+65 6555 0199', preferred_channel: 'linkedin', lifecycle_stage: 'qualified', status: 'active', owner_id: 'usr_team', relationship_score: 64, source: 'LinkedIn', timezone: 'Asia/Singapore', last_contact_at: ago(14), next_follow_up_at: ago(1), notes: 'Requested CRM and automation proposal.', tags: ['founder','saas'] },
    { id: 'ct_jonas', organization_id: 'org_alpine', first_name: 'Jonas', last_name: 'Weber', job_title: 'Managing Partner', email: 'jonas@alpine.example', phone: '+49 40 555 0111', preferred_channel: 'meeting', lifecycle_stage: 'customer', status: 'active', owner_id: 'usr_alex', relationship_score: 94, source: 'Existing network', timezone: 'Europe/Berlin', last_contact_at: ago(1), next_follow_up_at: ahead(7), notes: 'Active advisory client.', tags: ['client','priority'] },
    { id: 'ct_sophie', organization_id: 'org_bluewave', first_name: 'Sophie', last_name: 'Grant', job_title: 'Managing Director', email: 'sophie@bluewave.example', phone: '+44 20 5555 0177', preferred_channel: 'email', lifecycle_stage: 'lead', status: 'active', owner_id: 'usr_team', relationship_score: 53, source: 'Website', timezone: 'Europe/London', last_contact_at: ago(31), next_follow_up_at: ahead(3), notes: '', tags: ['uk'] },
    { id: 'ct_kenji', organization_id: 'org_orient', first_name: 'Kenji', last_name: 'Watanabe', job_title: 'Partner', email: 'kenji@orient.example', phone: '+65 6555 0133', preferred_channel: 'meeting', lifecycle_stage: 'opportunity', status: 'active', owner_id: 'usr_alex', relationship_score: 81, source: 'Introduction', timezone: 'Asia/Singapore', last_contact_at: ago(6), next_follow_up_at: ahead(5), notes: 'Consumer platform co-investment discussions.', tags: ['investor','asia'] },
  ];
  const activities = [
    { id: 'act_1', contact_id: 'ct_maya', organization_id: 'org_northstar', user_id: 'usr_alex', type: 'meeting', direction: 'outbound', subject: 'Investment thesis workshop', body: 'Reviewed target categories, ticket size and regional priorities.', outcome: 'Positive; requested shortlist', occurred_at: ago(2), duration_minutes: 55 },
    { id: 'act_2', contact_id: 'ct_ardi', organization_id: 'org_javafoods', user_id: 'usr_alex', type: 'whatsapp', direction: 'outbound', subject: 'Distribution follow-up', body: 'Shared rollout assumptions and requested volume forecast.', outcome: 'Awaiting data', occurred_at: ago(8) },
    { id: 'act_3', contact_id: 'ct_lina', organization_id: 'org_sakura', user_id: 'usr_team', type: 'call', direction: 'outbound', subject: 'CRM discovery call', body: 'Mapped lead management and reporting gaps.', outcome: 'Proposal requested', occurred_at: ago(14), duration_minutes: 40 },
    { id: 'act_4', contact_id: 'ct_jonas', organization_id: 'org_alpine', user_id: 'usr_alex', type: 'email', direction: 'inbound', subject: 'Expansion approval', body: 'Client approved phase two market introductions.', outcome: 'Won', occurred_at: ago(1) },
    { id: 'act_5', contact_id: 'ct_maya', organization_id: 'org_northstar', user_id: 'usr_alex', type: 'email', direction: 'outbound', subject: 'Shortlist preview', body: 'Sent preview of three relevant consumer platforms.', outcome: 'Opened', occurred_at: ago(4) },
    { id: 'act_6', contact_id: 'ct_jonas', organization_id: 'org_alpine', user_id: 'usr_alex', type: 'meeting', direction: 'outbound', subject: 'Quarterly review', body: 'Reviewed pipeline, retailer feedback and next milestones.', outcome: 'Renewal likely', occurred_at: ago(20), duration_minutes: 60 },
    { id: 'act_7', contact_id: 'ct_kenji', organization_id: 'org_orient', user_id: 'usr_alex', type: 'meeting', direction: 'outbound', subject: 'Co-investment opportunity review', body: 'Shared two consumer opportunities.', outcome: 'Investment committee review', occurred_at: ago(6), duration_minutes: 45 },
  ];
  const deals = [
    { id: 'deal_northstar', name: 'SEA Consumer Growth Mandate', organization_id: 'org_northstar', primary_contact_id: 'ct_maya', owner_id: 'usr_alex', stage: 'negotiation', value: 85000, currency: 'EUR', probability: 75, expected_close_date: ahead(24).slice(0,10), description: 'Investor sourcing and transaction advisory mandate.' },
    { id: 'deal_java', name: 'Indonesia Distribution Partnership', organization_id: 'org_javafoods', primary_contact_id: 'ct_ardi', owner_id: 'usr_alex', stage: 'proposal', value: 42000, currency: 'EUR', probability: 55, expected_close_date: ahead(40).slice(0,10), description: 'Partner onboarding and commercial rollout.' },
    { id: 'deal_sakura', name: 'CRM Transformation Project', organization_id: 'org_sakura', primary_contact_id: 'ct_lina', owner_id: 'usr_team', stage: 'qualified', value: 28000, currency: 'EUR', probability: 35, expected_close_date: ahead(52).slice(0,10), description: 'CRM implementation and automation.' },
    { id: 'deal_alpine', name: 'Private Label Expansion', organization_id: 'org_alpine', primary_contact_id: 'ct_jonas', owner_id: 'usr_alex', stage: 'won', value: 65000, currency: 'EUR', probability: 100, expected_close_date: ago(10).slice(0,10), description: 'Market entry and retailer introductions.' },
    { id: 'deal_bluewave', name: 'UK Market Access Retainer', organization_id: 'org_bluewave', primary_contact_id: 'ct_sophie', owner_id: 'usr_team', stage: 'lead', value: 24000, currency: 'EUR', probability: 15, expected_close_date: ahead(68).slice(0,10), description: 'Market access strategy and partner outreach.' },
    { id: 'deal_orient', name: 'Consumer Platform Co-investment', organization_id: 'org_orient', primary_contact_id: 'ct_kenji', owner_id: 'usr_alex', stage: 'proposal', value: 110000, currency: 'EUR', probability: 50, expected_close_date: ahead(35).slice(0,10), description: 'Transaction support for consumer platform acquisition.' },
  ];
  const tasks = [
    { id: 'task_1', title: 'Send investment shortlist', description: 'Send full vetted shortlist and teaser notes.', contact_id: 'ct_maya', organization_id: 'org_northstar', deal_id: 'deal_northstar', assignee_id: 'usr_alex', priority: 'high', status: 'open', due_at: ahead(2) },
    { id: 'task_2', title: 'Chase volume forecast', description: 'Request SKU and monthly volume assumptions.', contact_id: 'ct_ardi', organization_id: 'org_javafoods', deal_id: 'deal_java', assignee_id: 'usr_alex', priority: 'urgent', status: 'open', due_at: ahead(1) },
    { id: 'task_3', title: 'Send CRM proposal', description: 'Complete implementation scope and pricing.', contact_id: 'ct_lina', organization_id: 'org_sakura', deal_id: 'deal_sakura', assignee_id: 'usr_team', priority: 'high', status: 'in_progress', due_at: ago(1) },
    { id: 'task_4', title: 'Schedule quarterly review', description: 'Book next review meeting.', contact_id: 'ct_jonas', organization_id: 'org_alpine', deal_id: 'deal_alpine', assignee_id: 'usr_alex', priority: 'medium', status: 'open', due_at: ahead(7) },
    { id: 'task_5', title: 'Prepare co-investment memo', description: 'Summarize opportunity and deal structure.', contact_id: 'ct_kenji', organization_id: 'org_orient', deal_id: 'deal_orient', assignee_id: 'usr_alex', priority: 'high', status: 'open', due_at: ahead(5) },
  ];
  return { users, organizations, contacts, activities, deals, tasks };
}

function enrichedContact(store, contact) {
  const org = store.organizations.find((item) => item.id === contact.organization_id);
  const owner = store.users.find((item) => item.id === contact.owner_id);
  return { ...contact, organization: org?.name || null, organization_name: org?.name || null, owner_name: owner?.name || null, activity_count: store.activities.filter((item) => item.contact_id === contact.id).length, open_deal_value: store.deals.filter((item) => item.primary_contact_id === contact.id && !['won','lost'].includes(item.stage)).reduce((sum, item) => sum + item.value, 0) };
}

function enrichActivity(store, activity) {
  const contact = store.contacts.find((item) => item.id === activity.contact_id);
  const org = store.organizations.find((item) => item.id === activity.organization_id);
  const user = store.users.find((item) => item.id === activity.user_id);
  return { ...activity, contact_name: contact ? `${contact.first_name} ${contact.last_name}` : null, organization_name: org?.name || null, user_name: user?.name || null };
}

function enrichDeal(store, deal) {
  const contact = store.contacts.find((item) => item.id === deal.primary_contact_id);
  const org = store.organizations.find((item) => item.id === deal.organization_id);
  const owner = store.users.find((item) => item.id === deal.owner_id);
  return { ...deal, contact_name: contact ? `${contact.first_name} ${contact.last_name}` : null, organization_name: org?.name || null, owner_name: owner?.name || null };
}

function enrichTask(store, task) {
  const contact = store.contacts.find((item) => item.id === task.contact_id);
  const org = store.organizations.find((item) => item.id === task.organization_id);
  const deal = store.deals.find((item) => item.id === task.deal_id);
  const owner = store.users.find((item) => item.id === task.assignee_id);
  return { ...task, contact_name: contact ? `${contact.first_name} ${contact.last_name}` : null, organization_name: org?.name || null, deal_name: deal?.name || null, assignee_name: owner?.name || null };
}

function dashboard(store) {
  const stages = Object.values(store.deals.reduce((acc, deal) => {
    acc[deal.stage] ||= { stage: deal.stage, count: 0, value: 0 };
    acc[deal.stage].count += 1; acc[deal.stage].value += Number(deal.value || 0); return acc;
  }, {}));
  const won = store.deals.filter((deal) => deal.stage === 'won');
  const lost = store.deals.filter((deal) => deal.stage === 'lost');
  const closed = won.length + lost.length;
  const activityByDay = Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(Date.now() - (13 - offset) * 86_400_000).toISOString().slice(0,10);
    return { day: date, count: store.activities.filter((activity) => activity.occurred_at.slice(0,10) === date).length };
  });
  return {
    counts: {
      contacts: store.contacts.filter((item) => item.status === 'active').length,
      organizations: store.organizations.filter((item) => item.status === 'active').length,
      overdue_tasks: store.tasks.filter((item) => !['completed','cancelled'].includes(item.status) && item.due_at && new Date(item.due_at) < new Date()).length,
      follow_ups: store.contacts.filter((item) => item.next_follow_up_at && new Date(item.next_follow_up_at) >= new Date() && new Date(item.next_follow_up_at) <= new Date(Date.now() + 7 * 86_400_000)).length,
      activities_30d: store.activities.filter((item) => new Date(item.occurred_at) >= new Date(Date.now() - 30 * 86_400_000)).length,
    },
    pipeline: {
      total_value: store.deals.filter((deal) => deal.stage !== 'lost').reduce((sum, deal) => sum + deal.value, 0),
      weighted_value: store.deals.filter((deal) => !['won','lost'].includes(deal.stage)).reduce((sum, deal) => sum + deal.value * deal.probability / 100, 0),
      won_value: won.reduce((sum, deal) => sum + deal.value, 0),
      won_count: won.length,
      lost_count: lost.length,
      win_rate: closed ? Math.round(won.length / closed * 100) : 0,
    },
    stages,
    activity_by_day: activityByDay,
    tasks: store.tasks.filter((item) => !['completed','cancelled'].includes(item.status)).sort((a,b) => new Date(a.due_at) - new Date(b.due_at)).slice(0,8).map((item) => enrichTask(store,item)),
    recent_activities: [...store.activities].sort((a,b) => new Date(b.occurred_at)-new Date(a.occurred_at)).slice(0,10).map((item) => enrichActivity(store,item)),
    health: {
      strong: store.contacts.filter((item) => item.relationship_score >= 80).length,
      healthy: store.contacts.filter((item) => item.relationship_score >=55 && item.relationship_score < 80).length,
      needs_attention: store.contacts.filter((item) => item.relationship_score >=35 && item.relationship_score <55).length,
      at_risk: store.contacts.filter((item) => item.relationship_score <35).length,
    },
    sources: [],
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!relative) relative = 'index.html';
  let file = path.resolve(publicDir, relative);
  if (!file.startsWith(publicDir)) return sendJson(res, { error: 'Forbidden' }, 403);
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(publicDir, 'index.html');
  }
  try {
    const content = await readFile(file);
    const ext = path.extname(file);
    const type = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.csv':'text/csv; charset=utf-8','.svg':'image/svg+xml' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=60' });
    res.end(content);
  } catch (error) {
    sendJson(res, { error: error.message }, 404);
  }
}

async function handleApi(req, res, store) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  const method = req.method;
  if (url.pathname === '/health') return sendJson(res, { ok: true, service: 'PartnerMarket Global CRM Mock', timestamp: new Date().toISOString() });
  if (parts[1] === 'me' && method === 'GET') return sendJson(res, { user: store.users[0], app_name: 'PartnerMarket Global CRM', environment: 'mock' });
  if (parts[1] === 'dashboard' && method === 'GET') return sendJson(res, dashboard(store));
  if (parts[1] === 'contacts') {
    if (parts.length === 2 && method === 'GET') {
      let items = store.contacts.map((item) => enrichedContact(store,item));
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const stage = url.searchParams.get('stage') || '';
      if (q) items = items.filter((item) => `${item.first_name} ${item.last_name} ${item.email} ${item.job_title} ${item.organization}`.toLowerCase().includes(q));
      if (stage) items = items.filter((item) => item.lifecycle_stage === stage);
      const sort = url.searchParams.get('sort') || 'last_contact';
      items.sort((a,b) => {
        if (sort === 'name') return a.first_name.localeCompare(b.first_name);
        if (sort === 'organization') return String(a.organization).localeCompare(String(b.organization));
        if (sort === 'score') return b.relationship_score - a.relationship_score;
        if (sort === 'follow_up') return new Date(a.next_follow_up_at || 0) - new Date(b.next_follow_up_at || 0);
        return new Date(b.last_contact_at || 0) - new Date(a.last_contact_at || 0);
      });
      const page = Math.max(1, Number(url.searchParams.get('page') || 1)); const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || 25))); const total = items.length;
      return sendJson(res, { items: items.slice((page-1)*pageSize,page*pageSize), page, pageSize, total, pages: Math.max(1, Math.ceil(total/pageSize)) });
    }
    if (parts.length === 2 && method === 'POST') {
      const input = await readBody(req); if (!input.first_name) return sendJson(res,{error:'First name is required'},400);
      if (input.email && store.contacts.some((item) => item.email?.toLowerCase() === input.email.toLowerCase())) return sendJson(res,{error:'Email already exists'},409);
      const contact = { id: uid('ct'), status:'active', owner_id:'usr_alex', relationship_score:50, preferred_channel:'email', lifecycle_stage:'lead', tags:[], ...input, created_at:new Date().toISOString(), updated_at:new Date().toISOString() };
      store.contacts.push(contact); return sendJson(res,enrichedContact(store,contact),201);
    }
    const contact = store.contacts.find((item) => item.id === parts[2]);
    if (!contact) return sendJson(res,{error:'Contact not found'},404);
    if (parts.length === 3 && method === 'GET') return sendJson(res,{...enrichedContact(store,contact), activities:store.activities.filter((item)=>item.contact_id===contact.id).sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at)).map((item)=>enrichActivity(store,item)), tasks:store.tasks.filter((item)=>item.contact_id===contact.id).map((item)=>enrichTask(store,item)), deals:store.deals.filter((item)=>item.primary_contact_id===contact.id).map((item)=>enrichDeal(store,item)), attachments:[]});
    if (parts.length === 3 && method === 'PATCH') { Object.assign(contact,await readBody(req),{updated_at:new Date().toISOString()}); return sendJson(res,enrichedContact(store,contact)); }
    if (parts.length === 4 && parts[3] === 'activities' && method === 'POST') {
      const input = await readBody(req); const activity = { id:uid('act'), contact_id:contact.id, organization_id:contact.organization_id, user_id:'usr_alex', type:'note', direction:'internal', occurred_at:new Date().toISOString(), ...input };
      store.activities.push(activity); contact.last_contact_at=activity.occurred_at; if(input.next_follow_up_at)contact.next_follow_up_at=input.next_follow_up_at; return sendJson(res,enrichActivity(store,activity),201);
    }
  }
  if (parts[1] === 'activities' && method === 'POST') { const input=await readBody(req); const activity={id:uid('act'),user_id:'usr_alex',type:'note',direction:'internal',occurred_at:new Date().toISOString(),...input};store.activities.push(activity);return sendJson(res,enrichActivity(store,activity),201); }
  if (parts[1] === 'organizations') {
    if (parts.length === 2 && method === 'GET') {
      let items=store.organizations; const q=(url.searchParams.get('q')||'').toLowerCase();const type=url.searchParams.get('type')||'';if(q)items=items.filter((item)=>`${item.name} ${item.domain} ${item.industry}`.toLowerCase().includes(q));if(type)items=items.filter((item)=>item.type===type);
      return sendJson(res,items.map((org)=>({...org,contact_count:store.contacts.filter((item)=>item.organization_id===org.id).length,pipeline_value:store.deals.filter((item)=>item.organization_id===org.id&&item.stage!=='lost').reduce((sum,item)=>sum+item.value,0),owner_name:store.users.find((item)=>item.id===org.owner_id)?.name})));
    }
    if (parts.length === 2 && method === 'POST') { const input=await readBody(req);if(!input.name)return sendJson(res,{error:'Organization name is required'},400);const org={id:uid('org'),type:'prospect',status:'active',owner_id:'usr_alex',relationship_score:50,tags:[],annual_value:0,...input};store.organizations.push(org);return sendJson(res,org,201); }
  }
  if (parts[1] === 'deals') {
    if (parts.length === 2 && method === 'GET') return sendJson(res,store.deals.map((item)=>enrichDeal(store,item)));
    if (parts.length === 2 && method === 'POST') { const input=await readBody(req);if(!input.name)return sendJson(res,{error:'Deal name is required'},400);const deal={id:uid('deal'),owner_id:'usr_alex',stage:'lead',value:0,currency:'EUR',probability:STAGE_PROBABILITIES[input.stage||'lead'],...input};store.deals.push(deal);return sendJson(res,enrichDeal(store,deal),201); }
    const deal=store.deals.find((item)=>item.id===parts[2]);if(!deal)return sendJson(res,{error:'Deal not found'},404);if(method==='PATCH'){const input=await readBody(req);Object.assign(deal,input);if(input.stage&&!Object.hasOwn(input,'probability'))deal.probability=STAGE_PROBABILITIES[input.stage]??deal.probability;return sendJson(res,enrichDeal(store,deal));}
  }
  if (parts[1] === 'tasks') {
    if (parts.length === 2 && method === 'GET') { const status=url.searchParams.get('status');const items=status?store.tasks.filter((item)=>item.status===status):store.tasks;return sendJson(res,items.map((item)=>enrichTask(store,item))); }
    if (parts.length === 2 && method === 'POST') { const input=await readBody(req);if(!input.title)return sendJson(res,{error:'Task title is required'},400);const task={id:uid('task'),assignee_id:'usr_alex',priority:'medium',status:'open',...input};store.tasks.push(task);return sendJson(res,enrichTask(store,task),201); }
    const task=store.tasks.find((item)=>item.id===parts[2]);if(!task)return sendJson(res,{error:'Task not found'},404);if(method==='PATCH'){Object.assign(task,await readBody(req));if(task.status==='completed'&&!task.completed_at)task.completed_at=new Date().toISOString();return sendJson(res,enrichTask(store,task));}
  }
  if (parts[1] === 'search') {
    const q=(url.searchParams.get('q')||'').toLowerCase();
    return sendJson(res,{contacts:store.contacts.filter((item)=>`${item.first_name} ${item.last_name} ${item.email}`.toLowerCase().includes(q)).slice(0,8).map((item)=>({id:item.id,name:`${item.first_name} ${item.last_name}`,email:item.email,subtitle:item.job_title,type:'contact'})),organizations:store.organizations.filter((item)=>`${item.name} ${item.domain}`.toLowerCase().includes(q)).slice(0,8).map((item)=>({id:item.id,name:item.name,subtitle:item.industry,type:'organization'})),deals:store.deals.filter((item)=>item.name.toLowerCase().includes(q)).slice(0,8).map((item)=>({id:item.id,name:item.name,subtitle:item.stage,type:'deal'}))});
  }
  if (parts[1] === 'analytics') {
    const days=Math.round(clamp(url.searchParams.get('days')||30,7,365));const cutoff=Date.now()-days*86_400_000;const recent=store.activities.filter((item)=>new Date(item.occurred_at).getTime()>=cutoff);const activity_types=Object.values(recent.reduce((acc,item)=>{acc[item.type]||={type:item.type,count:0};acc[item.type].count+=1;return acc;},{}));const conversion=Object.values(store.contacts.reduce((acc,item)=>{acc[item.lifecycle_stage]||={lifecycle_stage:item.lifecycle_stage,count:0};acc[item.lifecycle_stage].count+=1;return acc;},{}));const owner_performance=store.users.map((user)=>({id:user.id,name:user.name,activities:recent.filter((item)=>item.user_id===user.id).length,contacts:store.contacts.filter((item)=>item.owner_id===user.id).length,won_value:store.deals.filter((item)=>item.owner_id===user.id&&item.stage==='won').reduce((sum,item)=>sum+item.value,0)}));const monthly=[...Array(6)].map((_,i)=>{const date=new Date();date.setMonth(date.getMonth()-(5-i));const month=date.toISOString().slice(0,7);const activities=store.activities.filter((item)=>item.occurred_at.slice(0,7)===month);return{month,activities:activities.length,engaged_contacts:new Set(activities.map((item)=>item.contact_id).filter(Boolean)).size};});return sendJson(res,{days,activity_types,owner_performance,monthly,conversion});
  }
  if (parts[1] === 'import' && parts[2] === 'contacts' && method === 'POST') {
    const input=await readBody(req);const rows=parseCsv(input.csv||'');let success=0;const errors=[];rows.forEach((row,index)=>{try{const first_name=row.first_name||row.firstname||row.name?.split(' ')[0];if(!first_name)throw new Error('Missing first_name');let organization_id=null;const orgName=row.organization||row.company;if(orgName){let org=store.organizations.find((item)=>item.name.toLowerCase()===orgName.toLowerCase());if(!org){org={id:uid('org'),name:orgName,type:'prospect',status:'active',owner_id:'usr_alex',relationship_score:50,tags:[]};store.organizations.push(org);}organization_id=org.id;}const contact={id:uid('ct'),organization_id,first_name,last_name:row.last_name||'',job_title:row.job_title||row.title||'',email:row.email||'',phone:row.phone||'',lifecycle_stage:row.lifecycle_stage||'lead',status:'active',owner_id:'usr_alex',relationship_score:Number(row.relationship_score||50),source:row.source||'CSV import',tags:normalizeTags((row.tags||'').split(/[;,]/))};store.contacts.push(contact);success+=1;}catch(error){errors.push({row:index+2,message:error.message});}});return sendJson(res,{id:uid('import'),rows:rows.length,success,failures:errors.length,errors},201);
  }
  sendJson(res,{error:'API route not found'},404);
}

export function createDevServer({ store = createStore() } = {}) {
  return http.createServer(async (req,res) => {
    try {
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname.startsWith('/api/')||pathname==='/health')await handleApi(req,res,store);else await serveStatic(req,res);
    } catch (error) {
      console.error(error); sendJson(res,{error:error.message},500);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT||8787);const server=createDevServer();server.listen(port,'127.0.0.1',()=>console.log(`PartnerMarket Global CRM mock server: http://127.0.0.1:${port}`));
}
