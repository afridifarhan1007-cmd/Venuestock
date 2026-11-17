import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin } from './helpers.mjs';

let server;
let api;
let product;
let reseller;
let resellerToken;
let slug;
let storeId;
let importQty;
let orderNumber;
let orderToken;

const password = 'correcthorsebattery';

before(async () => {
  server = await startServer();
  api = server.api;
  const response = await api.get('/api/products');
  product = response.body.products.find((entry) => entry.stock >= 20);
  assert.ok(product, 'a product with enough stock');
});

after(async () => {
  await server.stop();
});

async function registerCustomer() {
  const email = `store${Date.now()}${Math.random().toString(16).slice(2, 6)}@example.com`;
  const mobile = `+1415555${String(Math.floor(Math.random() * 9000) + 1000)}`;
  api.clearSession();
  const response = await api.post(
    '/api/auth/register',
    { fullName: 'Mira Sen', email, mobile, password, confirmPassword: password },
    { guest: true }
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  api.useCustomerToken(response.body.token);
  return response.body;
}

test('store profile creation validates slugs, keeps the owner private and starts in draft', async () => {
  reseller = await registerCustomer();
  resellerToken = reseller.token;

  const empty = await api.post('/api/account/store', { name: '' });
  assert.equal(empty.status, 422);

  const reserved = await api.post('/api/account/store', { name: 'Shop', slug: 'shop' });
  assert.equal(reserved.status, 422);

  const created = await api.post('/api/account/store', {
    name: 'Mira Skin Studio',
    slug: 'mira-skin-studio',
    tagline: 'Barrier-first skincare',
    about: 'Small studio, carefully chosen formulas.',
    contactEmail: 'hello@miraskin.example'
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const record = created.body.store;
  storeId = record.id;
  slug = record.slug;
  assert.equal(slug, 'mira-skin-studio');
  assert.equal(record.status, 'draft');
  assert.equal(record.live, false);
  assert.equal(Object.hasOwn(record, 'customerId'), false, 'internal owner ids stay server-side');
  assert.equal(Object.hasOwn(record, 'reviewNote'), true, 'the owner may read their own review note');

  const read = await api.get('/api/account/store');
  assert.equal(read.status, 200);
  assert.equal(read.body.store.slug, slug);
  assert.equal(read.body.canReseller, true);

  // A second customer cannot take the same address and sees no store of their own.
  const other = await registerCustomer();
  assert.ok(other.customer.id);
  const clash = await api.post('/api/account/store', { name: 'Copy Cat', slug });
  assert.equal(clash.status, 409);
  const own = await api.get('/api/account/store');
  assert.equal(own.body.store, null);
  const hidden = await api.patch(`/api/account/store/items/${product.slug}`, { price: 90 });
  assert.equal(hidden.status, 404, 'inventories are isolated per customer');
  const publicLookup = await api.get(`/api/stores/${slug}`, { guest: true });
  assert.equal(publicLookup.status, 404, 'a draft store is not public');
});

test('editing a submitted store returns it to draft, and publishing needs approval', async () => {
  api.useCustomerToken(resellerToken);

  const submit = await api.post('/api/account/store/submit');
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  assert.equal(submit.body.store.status, 'pending');

  const edited = await api.post('/api/account/store', { name: 'Mira Skin Studio', slug, tagline: 'Updated line' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.store.status, 'draft', 'stale details are never approved unseen');

  const resubmitted = await api.post('/api/account/store/submit');
  assert.equal(resubmitted.body.store.status, 'pending');

  const floor = await api.post('/api/account/store/add', { slug: product.slug, qty: 2, price: 1 });
  assert.equal(floor.status, 422, 'the reseller price cannot undercut the catalogue');

  importQty = 3;
  const added = await api.post('/api/account/store/add', { slug: product.slug, qty: importQty, price: 59 });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const entry = added.body.inventory.find((row) => row.slug === product.slug);
  assert.ok(entry);
  assert.equal(entry.qty, importQty);
  assert.equal(entry.price, 59);
  assert.equal(entry.published, false);

  const stockAfterImport = (await api.get(`/api/products/${product.slug}`)).body.product.stock;
  assert.equal(stockAfterImport, product.stock - importQty, 'imported units are reserved from the catalogue');

  const blocked = await api.patch(`/api/account/store/items/${product.slug}`, { published: true });
  assert.equal(blocked.status, 409, 'a pending store cannot publish items');

  const page = await api.get(`/store/${slug}`, { guest: true });
  assert.equal(page.status, 404);
});

test('admin review requires an administrator and unlocks the public storefront', async () => {
  const anonymous = await api.get('/api/admin/stores', { guest: true });
  assert.equal(anonymous.status, 401);

  await adminLogin(api);
  const list = await api.get('/api/admin/stores');
  assert.equal(list.status, 200);
  const row = list.body.stores.find((entry) => entry.id === storeId);
  assert.ok(row);
  assert.equal(row.status, 'pending');
  assert.equal(row.owner.email, reseller.customer.email);
  assert.equal(row.itemCount, 1);
  assert.equal(row.publishedCount, 0);
  assert.equal(row.unitCount, importQty);

  const approved = await api.patch(`/api/admin/stores/${storeId}`, { action: 'approve', note: 'Looks good.' });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.store.status, 'approved');
  assert.equal(approved.body.store.live, true);

  api.useCustomerToken(resellerToken);
  const published = await api.patch(`/api/account/store/items/${product.slug}`, { published: true, price: 61 });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.item.price, 61);
  assert.equal(published.body.item.published, true);

  const publicStore = await api.get(`/api/stores/${slug}`, { guest: true });
  assert.equal(publicStore.status, 200);
  assert.equal(publicStore.body.store.slug, slug);
  assert.equal(publicStore.body.products.length, 1);
  assert.equal(publicStore.body.products[0].price, 61);
  assert.equal(Object.hasOwn(publicStore.body.products[0], 'baseCost'), false, 'cost is never public');
  assert.equal(Object.hasOwn(publicStore.body.products[0], 'unitCost'), false);

  const page = await api.get(`/store/${slug}`, { guest: true });
  assert.equal(page.status, 200);
  assert.match(page.body, /Mira Skin Studio/);
});

test('public store orders use server prices, COD, idempotency and reseller stock', async () => {
  const body = {
    customer: { firstName: 'Nora', lastName: 'Alvarez', email: 'store-buyer@example.com', phone: '+1 415 555 0132' },
    shipping: { address1: '1200 Harbor Ave', address2: '', city: 'Portland', state: 'OR', zip: '97202', country: 'US' },
    items: [{ slug: product.slug, qty: 2, price: 1 }],
    shippingMethod: 'standard',
    idempotencyKey: `store-order-${Date.now()}`
  };

  const beforeMain = (await api.get(`/api/products/${product.slug}`)).body.product.stock;
  const created = await api.post(`/api/stores/${slug}/orders`, body, { guest: true });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const order = created.body.order;
  orderNumber = order.number;
  orderToken = created.body.token;
  assert.equal(order.subtotal, 122, 'client-supplied prices are ignored');
  assert.equal(order.shippingCost, 8);
  assert.equal(order.total, 130);
  assert.equal(order.paymentMethod, 'Cash on delivery');
  assert.equal(order.paymentStatus, 'Payment on delivery');
  assert.equal(order.storeSlug, slug);
  assert.equal(order.items[0].price, 61);
  assert.equal(Object.hasOwn(order.items[0], 'unitCost'), false);
  assert.equal(typeof created.body.whatsapp, 'string');

  const afterMain = (await api.get(`/api/products/${product.slug}`)).body.product.stock;
  assert.equal(afterMain, beforeMain, 'a reseller sale never touches the main catalogue stock');

  api.useCustomerToken(resellerToken);
  const inventory = await api.get('/api/account/store');
  const entry = inventory.body.inventory.find((row) => row.slug === product.slug);
  assert.equal(entry.qty, importQty - 2);

  const replay = await api.post(`/api/stores/${slug}/orders`, body, { guest: true });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(replay.body.order.number, order.number);
  const afterReplay = (await api.get('/api/account/store')).body.inventory.find((row) => row.slug === product.slug);
  assert.equal(afterReplay.qty, importQty - 2, 'a replay must not deduct stock twice');

  const orders = await api.get('/api/account/store/orders');
  assert.equal(orders.status, 200);
  const mine = orders.body.orders.find((row) => row.number === order.number);
  assert.ok(mine);
  assert.equal(mine.storeId, storeId);
});

test('cancelling a store order restocks reseller inventory, not the catalogue', async () => {
  api.useCustomerToken(resellerToken);
  const beforeInventory = (await api.get('/api/account/store')).body.inventory.find((row) => row.slug === product.slug).qty;
  const beforeMain = (await api.get(`/api/products/${product.slug}`)).body.product.stock;

  const cancelled = await api.patch(`/api/admin/orders/${orderNumber}`, { status: 'Cancelled' });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.order.status, 'Cancelled');

  const afterInventory = (await api.get('/api/account/store')).body.inventory.find((row) => row.slug === product.slug).qty;
  assert.equal(afterInventory, beforeInventory + 2);
  const afterMain = (await api.get(`/api/products/${product.slug}`)).body.product.stock;
  assert.equal(afterMain, beforeMain, 'the main catalogue is not inflated by a store cancellation');
});

test('a rejected or suspended store disappears and cannot publish', async () => {
  const rejected = await api.patch(`/api/admin/stores/${storeId}`, { action: 'reject', note: 'Contact email bounced.' });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.store.status, 'rejected');
  assert.equal(rejected.body.store.reviewNote, 'Contact email bounced.');
  assert.equal(rejected.body.store.live, false);

  const hidden = await api.get(`/api/stores/${slug}`, { guest: true });
  assert.equal(hidden.status, 404);

  api.useCustomerToken(resellerToken);
  const publish = await api.patch(`/api/account/store/items/${product.slug}`, { published: true });
  assert.equal(publish.status, 409);

  const resubmit = await api.post('/api/account/store/submit');
  assert.equal(resubmit.status, 200);
  assert.equal(resubmit.body.store.status, 'pending');

  const approved = await api.patch(`/api/admin/stores/${storeId}`, { action: 'approve' });
  assert.equal(approved.status, 200);
  const suspended = await api.patch(`/api/admin/stores/${storeId}`, { action: 'suspend', note: 'Policy review.' });
  assert.equal(suspended.status, 200);
  assert.equal(suspended.body.store.status, 'suspended');

  api.useCustomerToken(resellerToken);
  const blocked = await api.post('/api/account/store/submit');
  assert.equal(blocked.status, 403, 'a suspended store cannot resubmit without contacting support');
});

test('removing a store item returns reserved units and the order stays readable by token', async () => {
  api.useCustomerToken(resellerToken);
  const beforeRemove = (await api.get(`/api/products/${product.slug}`)).body.product.stock;
  const inventory = (await api.get('/api/account/store')).body.inventory.find((row) => row.slug === product.slug);

  const removed = await api.del(`/api/account/store/items/${product.slug}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  const afterRemove = (await api.get(`/api/products/${product.slug}`)).body.product.stock;
  assert.equal(afterRemove, beforeRemove + inventory.qty);

  const empty = await api.get('/api/account/store');
  assert.equal(empty.body.inventory.length, 0);

  const read = await api.get(`/api/orders/${orderNumber}?token=${orderToken}`, { guest: true });
  assert.equal(read.status, 200);
  assert.equal(read.body.order.number, orderNumber);
});
