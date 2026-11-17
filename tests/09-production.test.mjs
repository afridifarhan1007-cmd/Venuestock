// Production guarantees: the health probe reflects real storage, uploaded
// media survives a restart on the mounted volume, and HTTPS/proxy handling is
// correct behind a load balancer such as Railway.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, adminLogin, pngBase64 } from './helpers.mjs';

let server;
let api;

before(async () => {
  server = await startServer({ prefix: 'velune-prod' });
  api = server.api;
});

after(async () => {
  await server.stop();
});

test('health check verifies the database and persistent directories', async () => {
  const { status, body, headers } = await api.get('/api/health', { guest: true });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.checks.database, 'ok');
  assert.equal(body.checks.uploads, 'ok');
  assert.equal(body.checks.privateFiles, 'ok');
  assert.ok(body.products >= 200, 'health should report the catalogue size');
  assert.match(headers.get('cache-control') || '', /no-store/);
});

test('the storefront homepage is served at / with its assets', async () => {
  const home = await api.get('/', { guest: true });
  assert.equal(home.status, 200, 'GET / must render views/home.html, not a 404');
  assert.match(String(home.body), /<title>VELUNE/);
  assert.match(String(home.body), /\/css\/styles\.css/);
  for (const asset of ['/css/styles.css', '/js/home.js', '/favicon.ico', '/favicon.svg']) {
    assert.equal((await api.get(asset, { guest: true })).status, 200, `${asset} should be served`);
  }
});

test('uploaded product images live on the uploads volume and survive a restart', async () => {
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'velune-volume-'));
  const env = {
    DATA_DIR: path.join(shared, 'data'),
    UPLOADS_DIR: path.join(shared, 'uploads'),
    STORE_DB_PATH: path.join(shared, 'volume.db')
  };
  let first;
  let second;
  try {
    first = await startServer({ prefix: 'velune-volume', env });
    await adminLogin(first.api);
    const uploaded = await first.api.post('/api/admin/uploads', { mime: 'image/png', data: pngBase64() });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    const url = uploaded.body.path;
    const stored = path.join(env.UPLOADS_DIR, path.basename(url));
    assert.ok(fs.existsSync(stored), 'the upload must be written to UPLOADS_DIR, not public/');
    assert.equal((await first.api.get(url, { guest: true })).status, 200);

    await first.stop({ keepData: true });
    first = null;

    second = await startServer({ prefix: 'velune-volume', env });
    const served = await second.api.get(url, { guest: true });
    assert.equal(served.status, 200, 'a restart must keep serving volume-backed uploads');
    assert.match(served.headers.get('content-type') || '', /image\/png/);
  } finally {
    if (first) await first.stop().catch(() => {});
    if (second) await second.stop().catch(() => {});
    fs.rmSync(shared, { recursive: true, force: true });
  }
});

test('behind HTTPS the site sends HSTS and secure session cookies', async () => {
  const page = await api.get('/', { guest: true, headers: { 'x-forwarded-proto': 'https' } });
  assert.match(page.headers.get('strict-transport-security') || '', /max-age=31536000/);

  const registered = await api.post(
    '/api/auth/register',
    {
      fullName: 'Https Tester',
      firstName: 'Https',
      lastName: 'Tester',
      email: `secure${Date.now()}@example.com`,
      mobile: `9${Date.now().toString().slice(-9)}`,
      password: 'correcthorsebattery',
      confirmPassword: 'correcthorsebattery'
    },
    { guest: true, headers: { 'x-forwarded-proto': 'https' } }
  );
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const cookies = registered.headers.getSetCookie();
  const session = cookies.find((line) => line.startsWith('velune_session='));
  assert.ok(session, 'registration should set a session cookie');
  assert.match(session, /; Secure\b/);
  assert.match(session, /HttpOnly/);
  assert.match(session, /SameSite=Lax/);
});

test('with TRUST_PROXY the rate limiter uses the forwarded client address', async () => {
  const proxied = await startServer({
    prefix: 'velune-proxy',
    env: { TRUST_PROXY: 'true', RATE_LIMIT_DISABLED: 'false' }
  });
  try {
    const send = (ip) =>
      proxied.api.post('/api/newsletter', { email: `list-${Date.now()}-${Math.random()}@example.com` }, {
        guest: true,
        headers: { 'x-forwarded-for': ip }
      });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      assert.ok((await send('198.51.100.10')).status < 400, 'requests under the limit are served');
    }
    // Each distinct client address keeps its own bucket, so a shared proxy IP
    // must not cause every visitor to be throttled together.
    assert.ok((await send('198.51.100.11')).status < 400);
    const limited = await send('198.51.100.10');
    assert.equal(limited.status, 429, 'the ninth request from the same client is throttled');
  } finally {
    await proxied.stop();
  }
});
