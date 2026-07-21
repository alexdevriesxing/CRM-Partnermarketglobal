import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Email Center is a first-class CRM route', async () => {
  const [html, app, email] = await Promise.all([read('public/index.html'), read('public/app.js'), read('public/email.js')]);
  assert.match(html, /data-route="email"/);
  assert.match(app, /renderEmailCenter/);
  assert.match(email, /export \{ openEmailComposer, renderEmailCenter \}/);
});

test('Email Center exposes operational metrics and health', async () => {
  const [worker, backend, email] = await Promise.all([read('src/worker.js'), read('src/email.js'), read('public/email.js')]);
  assert.match(worker, /p\[2\]==='overview'/);
  assert.match(worker, /p\[2\]==='health'/);
  assert.match(backend, /getEmailOverview/);
  assert.match(backend, /getEmailHealth/);
  assert.match(email, /Delivery service/);
  assert.match(email, /Failure diagnostics/);
});

test('email history supports server-side search and filtering', async () => {
  const backend = await read('src/email.js');
  assert.match(backend, /url\.searchParams\.get\('q'\)/);
  assert.match(backend, /lower\(m\.subject\) LIKE/);
  assert.match(backend, /recipient_count/);
});

test('accessibility and reduced-motion support are present', async () => {
  const [html, styles, app] = await Promise.all([read('public/index.html'), read('public/styles.css'), read('public/app.js')]);
  assert.match(html, /class="skip-link"/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /focus-visible/);
  assert.match(app, /aria-current/);
});

test('release and mock server identify v2.3.0', async () => {
  const [pkg, worker, mock] = await Promise.all([read('package.json'), read('src/worker.js'), read('scripts/dev-server.mjs')]);
  assert.equal(JSON.parse(pkg).version, '2.3.0');
  assert.match(worker, /version:'2\.3\.0'/);
  assert.match(mock, /version:'2\.3\.0'/);
});
