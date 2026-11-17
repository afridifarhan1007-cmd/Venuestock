import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, pngBase64 } from './helpers.mjs';

let server;
let api;

const products = {
  name: 'Admin Created Serum',
  category: 'skincare',
  stock: 7,
  image: '/images/catalog/silk-milk-cleanser.svg',
  short: 'Created from the admin test suite.',
  description: 'A serum created through the admin API to verify product management.',
  details: ['Fragrance free', '30 ml'],
  specs: [{ k: 'Size', v: '30 ml' }],
  variants: [{ name: 'Size', options: ['30 ml', '50 ml'] }]
};

before(async () => {
  server = await startServer();
  api = server.api;
});

after(async () => {
  await server.stop();
});

test('admin endpoints reject unauthenticated callers and bad credentials', async () => {
  assert.equal((await api.get('/api/admin/products', { guest: true })).status, 401);
  assert.equal((await api.get('/api/admin/overview', { guest: true })).status, 401);
  assert.equal((await api.post('/api/admin/login', { username: 'admin', password: 'nope' }, { guest: true })).status, 401);
  const login = await adminLogin(api);
  assert.equal(login.user.role, 'admin');
  assert.ok(login.token);
  const session = await api.get('/api/admin/session');
  assert.equal(session.status, 200);
  assert.equal(session.body.user.username, 'admin');
});

test('admin can create, edit and delete a product with defaults and variants', async () => {
  await adminLogin(api);
  const created = await api.post('/api/admin/products', products);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const product = created.body.product;
  assert.equal(product.price, 52);
  assert.equal(product.baseCost, 46);
  assert.equal(product.profit, 6);
  assert.equal(product.stock, 7);
  assert.deepEqual(product.variants, [{ name: 'Size', options: ['30 ml', '50 ml'] }]);
  assert.deepEqual(product.specs, [{ k: 'Size', v: '30 ml' }]);

  const edited = await api.patch(`/api/admin/products/${product.slug}`, {
    ...product,
    name: 'Admin Edited Serum',
    stock: 11,
    badge: 'New'
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.product.name, 'Admin Edited Serum');
  assert.equal(edited.body.product.stock, 11);
  assert.equal(edited.body.product.badge, 'New');
  assert.equal(edited.body.product.slug, product.slug, 'editing never renames the URL');

  const publicRead = await api.get(`/api/products/${product.slug}`);
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.body.product.name, 'Admin Edited Serum');
  assert.equal(publicRead.body.product.stock, 11);

  const removed = await api.del(`/api/admin/products/${product.slug}`);
  assert.equal(removed.status, 200);
  assert.equal((await api.get(`/api/products/${product.slug}`)).status, 404);
});

test('image upload validates content and publishes under /images/uploads', async () => {
  await adminLogin(api);
  const valid = await api.post('/api/admin/uploads', { mime: 'image/png', data: pngBase64() });
  assert.equal(valid.status, 201, JSON.stringify(valid.body));
  assert.match(valid.body.path, /^\/images\/uploads\/[a-z0-9-]+\.png$/);
  const asset = await api.get(valid.body.path);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') || '', /image\/png/);

  const mismatch = await api.post('/api/admin/uploads', { mime: 'image/png', data: Buffer.from('not an image at all').toString('base64') });
  assert.equal(mismatch.status, 422);

  // Browsers on Android can report the wrong MIME (or none), so the byte
  // signature decides the stored type rather than the client's label.
  const wrongMime = await api.post('/api/admin/uploads', { mime: 'image/gif', data: pngBase64() });
  assert.equal(wrongMime.status, 201, 'valid PNG bytes must be accepted even with a wrong declared MIME');
  assert.match(wrongMime.body.path, /\.png$/);

  const unsupported = await api.post('/api/admin/uploads', {
    mime: 'image/png',
    data: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(200)]).toString('base64')
  });
  assert.equal(unsupported.status, 422);
});

test('categories can be managed but in-use categories are protected', async () => {
  await adminLogin(api);
  const created = await api.post('/api/admin/categories', { name: 'Body Care', line: 'Lotions and oils.' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.category.slug, 'body-care');

  const renamed = await api.patch('/api/admin/categories/body-care', { name: 'Body & Bath' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.category.name, 'Body & Bath');

  const product = await api.post('/api/admin/products', {
    ...products,
    name: 'Body Butter',
    category: 'body-care'
  });
  assert.equal(product.status, 201);
  assert.equal((await api.del('/api/admin/categories/body-care')).status, 409, 'a category with products cannot be deleted');

  assert.equal((await api.del(`/api/admin/products/${product.body.product.slug}`)).status, 200);
  assert.equal((await api.del('/api/admin/categories/body-care')).status, 200);
  assert.equal((await api.del('/api/admin/categories/skincare')).status, 409, 'core categories stay when in use');
});

test('employee permissions are scoped server-side', async () => {
  await adminLogin(api);
  const created = await api.post('/api/admin/staff', {
    name: 'Ira Desk',
    username: `ira${Date.now()}`,
    password: 'employee-password',
    permissions: { chat: true, tickets: true, products: true, reports: false, customers: false, verification: false, upload: false, moderate: false },
    chatScope: 'all'
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const employee = created.body.staff;
  assert.equal(employee.permissions.products, true);
  assert.equal(employee.permissions.reports, false);

  api.useAdminToken(null);
  const login = await api.post('/api/admin/login', { username: employee.username, password: 'employee-password' }, { guest: true });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'employee');
  api.useAdminToken(login.body.token);

  assert.equal((await api.get('/api/admin/products')).status, 200);
  assert.equal((await api.get('/api/admin/reports/profit?range=30')).status, 403);
  assert.equal((await api.get('/api/admin/staff')).status, 403, 'employees cannot list staff');
  assert.equal((await api.get('/api/admin/verification')).status, 403);
  assert.equal((await api.patch('/api/admin/verification/cust_0000000000000000', { status: 'approved' })).status, 403);

  // Disabling the employee invalidates the existing token immediately.
  api.useAdminToken(null);
  const admin = await adminLogin(api);
  assert.equal(admin.user.role, 'admin');
  await api.patch(`/api/admin/staff/${employee.id}`, { active: false });
  api.useAdminToken(login.body.token);
  assert.equal((await api.get('/api/admin/session')).status, 401);
});

test('settings changes reach the storefront and are escaped', async () => {
  await adminLogin(api);
  const current = await api.get('/api/admin/settings');
  assert.equal(current.status, 200);
  const update = await api.patch('/api/admin/settings', {
    ...current.body.settings,
    announcement: '<b>Holiday shipping</b>',
    supportEmail: 'care@example.com'
  });
  assert.equal(update.status, 200, JSON.stringify(update.body));
  const home = await api.get('/');
  assert.match(home.body, /&lt;b&gt;Holiday shipping&lt;\/b&gt;/);
  assert.doesNotMatch(home.body, /<b>Holiday shipping<\/b>/);

  // An invalid support email or a javascript: channel is refused.
  assert.equal((await api.patch('/api/admin/settings', { ...current.body.settings, supportEmail: 'not-an-email' })).status, 422);
  assert.equal((await api.patch('/api/admin/settings', { ...current.body.settings, whatsapp: '12' })).status, 422);
  assert.equal(current.body.settings.adminPasswordHash, undefined, 'password hashes never leave the server');
});
