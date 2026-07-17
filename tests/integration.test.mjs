import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDevServer, createStore } from '../scripts/dev-server.mjs';

async function withServer(run) {
  const store = createStore();
  const server = createDevServer({ store });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`, store);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json();
  return { response, body };
}

test('mock API returns identity and dashboard analytics', async () => {
  await withServer(async (base) => {
    const me = await jsonFetch(`${base}/api/me`);
    assert.equal(me.response.status, 200);
    assert.equal(me.body.user.role, 'admin');

    const dashboard = await jsonFetch(`${base}/api/dashboard`);
    assert.equal(dashboard.response.status, 200);
    assert.ok(dashboard.body.counts.contacts >= 6);
    assert.equal(dashboard.body.activity_by_day.length, 14);
    assert.ok(dashboard.body.pipeline.total_value > 0);
  });
});

test('contact creation and interaction logging update relationship history', async () => {
  await withServer(async (base) => {
    const created = await jsonFetch(`${base}/api/contacts`, {
      method: 'POST',
      body: {
        first_name: 'Elena',
        last_name: 'Rossi',
        email: 'elena@example.com',
        lifecycle_stage: 'qualified',
        tags: ['priority'],
      },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.first_name, 'Elena');

    const activity = await jsonFetch(`${base}/api/contacts/${created.body.id}/activities`, {
      method: 'POST',
      body: {
        type: 'call',
        direction: 'outbound',
        subject: 'Qualification call',
        outcome: 'Proposal requested',
      },
    });
    assert.equal(activity.response.status, 201);

    const detail = await jsonFetch(`${base}/api/contacts/${created.body.id}`);
    assert.equal(detail.body.activities.length, 1);
    assert.equal(detail.body.activities[0].subject, 'Qualification call');
  });
});

test('deal stage and task status can be updated', async () => {
  await withServer(async (base, store) => {
    const dealId = store.deals.find((deal) => deal.stage === 'proposal').id;
    const updatedDeal = await jsonFetch(`${base}/api/deals/${dealId}`, {
      method: 'PATCH',
      body: { stage: 'negotiation' },
    });
    assert.equal(updatedDeal.response.status, 200);
    assert.equal(updatedDeal.body.stage, 'negotiation');
    assert.equal(updatedDeal.body.probability, 75);

    const taskId = store.tasks[0].id;
    const updatedTask = await jsonFetch(`${base}/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: { status: 'completed' },
    });
    assert.equal(updatedTask.body.status, 'completed');
    assert.ok(updatedTask.body.completed_at);
  });
});

test('CSV import creates contacts and organizations', async () => {
  await withServer(async (base, store) => {
    const result = await jsonFetch(`${base}/api/import/contacts`, {
      method: 'POST',
      body: {
        file_name: 'contacts.csv',
        csv: 'first_name,last_name,email,organization,tags\nNadia,Khan,nadia@example.com,New Horizon,"investor,asia"',
      },
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.success, 1);
    assert.ok(store.contacts.some((contact) => contact.email === 'nadia@example.com'));
    assert.ok(store.organizations.some((organization) => organization.name === 'New Horizon'));
  });
});

test('SPA files and health endpoint are served', async () => {
  await withServer(async (base) => {
    const html = await fetch(`${base}/contacts`);
    assert.equal(html.status, 200);
    const text = await html.text();
    assert.match(text, /PartnerMarket Global CRM/);

    const health = await jsonFetch(`${base}/health`);
    assert.equal(health.body.ok, true);
  });
});
