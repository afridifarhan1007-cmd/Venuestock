import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, adminLogin } from './helpers.mjs';

let server;
let api;
let mock;
let mockUrl;
let channelId;
let importedSlug;
let orderNumber;
const requests = [];
const mockState = {
  products: [
    { id: 'sup_1', sku: 'OAT-CLEANSER', name: 'Oat Milk Cleanser', description: '<p>A gentle daily cleanser for reactive skin.</p>', price: 64, cost: 30, stock: 12, image: 'https://cdn.example.com/oat.jpg', category: 'Skincare' },
    { id: 'sup_2', sku: 'TINT-04', name: 'Cushion Lip Tint 04', description: '<p>A sheer rose tint with a soft satin finish.</p>', short: 'Sheer rose satin', price: 38, cost: 18, stock: 7, image: 'https://cdn.example.com/tint.jpg', category: 'Makeup' }
  ]
};

before(async () => {
  mock = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://local');
    requests.push({ method: req.method, path: url.pathname, body: raw ? JSON.parse(raw) : null, auth: req.headers.authorization || '' });
    const json = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (url.pathname !== '/unauthorized' && req.headers.authorization !== 'Token sup-secret-key') {
      return json(401, { message: 'Invalid supplier token.' });
    }
    if (url.pathname === '/products' && req.method === 'GET') return json(200, { products: mockState.products });
    if (url.pathname === '/products' && req.method === 'POST') return json(200, { id: 'sup_export_1', sku: raw ? JSON.parse(raw).sku : '' });
    if (url.pathname === '/inventory' && req.method === 'POST') return json(200, { ok: true });
    if (url.pathname === '/orders' && req.method === 'POST') return json(200, { id: 'sup_order_1', number: 'SP-100', status: 'accepted' });
    if (url.pathname === '/unauthorized') return json(401, { message: 'Invalid supplier token.' });
    return json(404, { message: 'Not found.' });
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  mockUrl = `http://127.0.0.1:${mock.address().port}`;

  server = await startServer();
  api = server.api;
});

after(async () => {
  await server?.stop();
  await new Promise((resolve) => mock?.close(resolve));
});

test('channels are administrator-only and credentials are validated and sealed', async () => {
  assert.equal((await api.get('/api/admin/integrations', { guest: true })).status, 401);

  await adminLogin(api);

  const badProvider = await api.post('/api/admin/integrations', { provider: 'nope', name: 'Nope' });
  assert.equal(badProvider.status, 422);

  const badShop = await api.post('/api/admin/integrations', {
    provider: 'shopify', name: 'Bad shop', config: { shop: 'not-a-shop', accessToken: 'shpat_secret' }
  });
  assert.equal(badShop.status, 422);

  const missingSecret = await api.post('/api/admin/integrations', {
    provider: 'supplier', name: 'Missing key', config: { baseUrl: mockUrl }
  });
  assert.equal(missingSecret.status, 422);

  const created = await api.post('/api/admin/integrations', {
    provider: 'supplier',
    name: 'Test supplier',
    config: { baseUrl: mockUrl, apiKey: 'sup-secret-key', authPrefix: 'Token ' }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  channelId = created.body.integration.id;
  assert.match(channelId, /^int_[a-f0-9]{16}$/);
  assert.equal(created.body.integration.ready, true);
  assert.equal(created.body.integration.secrets.apiKey, true);
  assert.equal(Object.hasOwn(created.body.integration.config, 'apiKey'), false, 'the key is never returned');
  assert.doesNotMatch(JSON.stringify(created.body), /sup-secret-key/);

  // The SQLite payload must hold ciphertext, not the token.
  const row = integrationRow(channelId);
  assert.doesNotMatch(row, /sup-secret-key/);
  assert.match(row, /v1\./);

  const list = await api.get('/api/admin/integrations');
  assert.equal(list.status, 200);
  assert.ok(list.body.integrations.some((entry) => entry.id === channelId));
  assert.ok(list.body.providers.some((entry) => entry.key === 'shopify'));
  assert.ok(list.body.providers.some((entry) => entry.key === 'woocommerce'));
  assert.doesNotMatch(JSON.stringify(list.body), /sup-secret-key/);
});

test('connection testing calls the provider and records failures in the job log', async () => {
  const tested = await api.post(`/api/admin/integrations/${channelId}/test`);
  assert.equal(tested.status, 200, JSON.stringify(tested.body));
  assert.match(tested.body.message, /Supplier API responded/);
  assert.equal(tested.body.integration.lastTestStatus, 'success');
  assert.equal(requests.some((entry) => entry.method === 'GET' && entry.path === '/products'), true);
  const probe = requests.find((entry) => entry.method === 'GET' && entry.path === '/products');
  assert.equal(probe.auth, 'Token sup-secret-key', 'the auth prefix keeps its trailing space');

  const failing = await api.post('/api/admin/integrations', {
    provider: 'supplier',
    name: 'Broken supplier',
    config: { baseUrl: mockUrl, apiKey: 'other-secret', productsPath: '/unauthorized' }
  });
  assert.equal(failing.status, 201);
  const failed = await api.post(`/api/admin/integrations/${failing.body.integration.id}/test`);
  assert.equal(failed.status, 409, JSON.stringify(failed.body));
  assert.match(failed.body.error, /rejected the request \(401\)/);
  assert.doesNotMatch(JSON.stringify(failed.body), /other-secret/);

  const jobs = await api.get(`/api/admin/integrations/${failing.body.integration.id}/jobs`);
  assert.equal(jobs.status, 200);
  assert.equal(jobs.body.jobs[0].status, 'error');
  assert.equal(jobs.body.integration.lastTestStatus, 'error');

  await api.del(`/api/admin/integrations/${failing.body.integration.id}`);
});

test('import creates local products, links them and refreshes price and stock', async () => {
  const first = await api.post(`/api/admin/integrations/${channelId}/import-products`, { limit: 10 });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.detail.created, 2);
  assert.equal(first.body.detail.updated, 0);
  assert.equal(first.body.integration.linkCount, 2);

  const products = (await api.get('/api/admin/products')).body.products;
  const cleanser = products.find((entry) => entry.name === 'Oat Milk Cleanser');
  assert.ok(cleanser);
  importedSlug = cleanser.slug;
  assert.equal(cleanser.price, 64);
  assert.equal(cleanser.baseCost, 30);
  assert.equal(cleanser.stock, 12);
  assert.equal(cleanser.category, 'skincare', 'the category hint maps onto a local category');

  const catalog = await api.get('/api/admin/integrations/catalog');
  const linked = catalog.body.products.find((entry) => entry.slug === importedSlug);
  assert.equal(linked.links[0].externalId, 'sup_1');

  mockState.products[0].price = 66;
  mockState.products[0].stock = 9;
  const second = await api.post(`/api/admin/integrations/${channelId}/import-products`, { limit: 10 });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.detail.created, 0);
  assert.equal(second.body.detail.updated, 2);
  const refreshed = (await api.get('/api/admin/products')).body.products.find((entry) => entry.slug === importedSlug);
  assert.equal(refreshed.price, 66);
  assert.equal(refreshed.stock, 9);
});

test('export, stock sync and order push reach the provider and persist links', async () => {
  const exported = await api.post(`/api/admin/integrations/${channelId}/export-products`, { slugs: [importedSlug] });
  assert.equal(exported.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.detail.exported[0], importedSlug);
  const exportCall = requests.findLast((entry) => entry.method === 'POST' && entry.path === '/products' && entry.body?.external_id === 'sup_1');
  assert.ok(exportCall, 'the product was posted to the supplier');
  assert.equal(exportCall.body.external_id, 'sup_1');

  const synced = await api.post(`/api/admin/integrations/${channelId}/sync-inventory`, { slugs: [importedSlug] });
  assert.equal(synced.status, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.detail.synced.length, 1);
  const stockCall = requests.findLast((entry) => entry.method === 'POST' && entry.path === '/inventory');
  assert.equal(stockCall.body.sku, 'OAT-CLEANSER');
  assert.equal(stockCall.body.quantity, 9);
  assert.equal(stockCall.body.price, 66);

  const order = await api.post('/api/orders', {
    customer: { firstName: 'Nora', lastName: 'Alvarez', email: 'integration-buyer@example.com', phone: '+1 415 555 0132' },
    shipping: { address1: '1200 Harbor Ave', address2: '', city: 'Portland', state: 'OR', zip: '97202', country: 'US' },
    items: [{ slug: importedSlug, qty: 1 }],
    shippingMethod: 'standard'
  });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  orderNumber = order.body.order.number;

  const pushed = await api.post(`/api/admin/integrations/${channelId}/push-orders`, { numbers: [orderNumber] });
  assert.equal(pushed.status, 200, JSON.stringify(pushed.body));
  assert.equal(pushed.body.detail.pushed[0].externalId, 'sup_order_1');
  const orderCall = requests.findLast((entry) => entry.method === 'POST' && entry.path === '/orders');
  assert.equal(orderCall.body.reference, orderNumber);
  assert.equal(orderCall.body.items[0].sku, 'OAT-CLEANSER');

  const replay = await api.post(`/api/admin/integrations/${channelId}/push-orders`, { numbers: [orderNumber] });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.detail.pushed[0].duplicate, true);
  const orderCalls = requests.filter((entry) => entry.method === 'POST' && entry.path === '/orders');
  assert.equal(orderCalls.length, 1, 'a replay must not create a second remote order');

  const jobs = await api.get(`/api/admin/integrations/${channelId}/jobs`);
  const types = jobs.body.jobs.map((job) => job.type);
  for (const type of ['test', 'import-products', 'export-products', 'sync-inventory', 'push-orders']) {
    assert.ok(types.includes(type), `expected a ${type} job`);
  }
  assert.ok(jobs.body.jobs.every((job) => job.status === 'success'));
});

test('employees cannot reach channel configuration and deletion cleans links', async () => {
  await adminLogin(api);
  const created = await api.post('/api/admin/staff', {
    name: 'Support Agent',
    username: `agent${Date.now()}`,
    password: 'a-long-agent-password',
    permissions: { reports: true }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const login = await api.post('/api/admin/login', { username: created.body.staff.username, password: 'a-long-agent-password' }, { guest: true });
  assert.equal(login.status, 200);
  api.useAdminToken(login.body.token);
  assert.equal((await api.get('/api/admin/integrations')).status, 403);
  assert.equal((await api.post(`/api/admin/integrations/${channelId}/test`)).status, 403);

  await adminLogin(api);
  const removed = await api.del(`/api/admin/integrations/${channelId}`);
  assert.equal(removed.status, 200);
  const list = await api.get('/api/admin/integrations');
  assert.equal(list.body.integrations.some((entry) => entry.id === channelId), false);
  const catalog = await api.get('/api/admin/integrations/catalog');
  const product = catalog.body.products.find((entry) => entry.slug === importedSlug);
  assert.equal(product.links.length, 0, 'links are removed with the channel');
});

function integrationRow(id) {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(server.dbPath(), { readOnly: true });
  try {
    return db.prepare('SELECT payload FROM integrations WHERE id = ?').get(id)?.payload || '';
  } finally {
    db.close();
  }
}
