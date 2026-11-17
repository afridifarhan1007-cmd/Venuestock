import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin } from './helpers.mjs';

let server;
let api;
let product;

before(async () => {
  server = await startServer({ env: { RATE_LIMIT_DISABLED: 'false' } });
  api = server.api;
  const response = await api.get('/api/products');
  product = response.body.products.find((entry) => entry.stock >= 10);
  assert.ok(product, 'a product with enough stock');
});

after(async () => {
  await server.stop();
});

const address = () => ({
  customer: { firstName: 'Nora', lastName: 'Alvarez', email: `buyer${Date.now()}${Math.random().toString(16).slice(2, 6)}@example.com`, phone: '+1 415 555 0132' },
  shipping: { address1: '1200 Harbor Ave', address2: '', city: 'Portland', state: 'OR', zip: '97202', country: 'US' }
});

const orderBody = (overrides = {}) => ({
  ...address(),
  items: [{ slug: product.slug, qty: 2 }],
  shippingMethod: 'standard',
  ...overrides
});

test('orders are priced on the server, decrement stock and replay idempotently', async () => {
  const beforeStock = product.stock;
  const key = `order-${Date.now()}`;
  const created = await api.post('/api/orders', orderBody({ idempotencyKey: key }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const order = created.body.order;
  assert.match(order.number, /^VLN-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(order.subtotal, 104);
  assert.equal(order.shippingCost, 8);
  assert.equal(order.total, 112);
  assert.equal(order.items[0].price, 52);
  assert.equal(Object.hasOwn(order.items[0], 'unitCost'), false, 'cost is admin-only');
  assert.ok(created.body.token);

  const afterProduct = (await api.get(`/api/products/${product.slug}`)).body.product;
  assert.equal(afterProduct.stock, beforeStock - 2);

  const replay = await api.post('/api/orders', orderBody({ idempotencyKey: key, customer: order.customer }));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(replay.body.order.number, order.number);
  const stockAfterReplay = (await api.get(`/api/products/${product.slug}`)).body.product.stock;
  assert.equal(stockAfterReplay, beforeStock - 2, 'a replay must not deduct stock twice');

  const read = await api.get(`/api/orders/${order.number}?token=${created.body.token}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.order.number, order.number);

  const badToken = await api.get(`/api/orders/${order.number}?token=wrong`);
  assert.equal(badToken.status, 404);

  const lookup = await api.post('/api/orders/lookup', { number: order.number, email: order.customer.email });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.order.number, order.number);

  const wrongEmail = await api.post('/api/orders/lookup', { number: order.number, email: 'intruder@example.com' });
  assert.equal(wrongEmail.status, 404);
});

test('promo codes, free shipping and totals are recalculated server-side', async () => {
  const discounted = await api.post('/api/orders', orderBody({ promoCode: 'WELCOME10' }));
  assert.equal(discounted.status, 201, JSON.stringify(discounted.body));
  assert.equal(discounted.body.order.discount, 10.4);
  assert.equal(discounted.body.order.total, 101.6);

  const freeShipping = await api.post('/api/orders', orderBody({ items: [{ slug: product.slug, qty: 3 }] }));
  assert.equal(freeShipping.status, 201);
  assert.equal(freeShipping.body.order.subtotal, 156);
  assert.equal(freeShipping.body.order.shippingCost, 0);
  assert.equal(freeShipping.body.order.total, 156);

  const invalid = await api.post('/api/orders', orderBody({ promoCode: 'NOTREAL' }));
  assert.equal(invalid.status, 422);

  const tooMany = await api.post('/api/orders', orderBody({ items: [{ slug: product.slug, qty: 99 }] }));
  assert.equal(tooMany.status, 422);

  const badState = await api.post('/api/orders', orderBody({
    shipping: { address1: '1 Main St', city: 'Portland', state: 'ZZ', zip: '97202', country: 'US' }
  }));
  assert.equal(badState.status, 422);

  const badCountry = await api.post('/api/orders', orderBody({
    shipping: { address1: '1 Main St', city: 'London', state: 'London', zip: 'SW1A 1AA', country: 'GB' }
  }));
  assert.equal(badCountry.status, 422);

  const priceOverride = await api.post('/api/orders', orderBody({ items: [{ slug: product.slug, qty: 1, price: 1 }] }));
  assert.equal(priceOverride.status, 201);
  assert.equal(priceOverride.body.order.total, 60, 'client-supplied prices are ignored');
});

test('India delivery validates the PIN, state and mobile number', async () => {
  const base = {
    customer: { firstName: 'Rhea', lastName: 'Kapoor', email: `rhea${Date.now()}@example.com`, phone: '98765 43210' },
    shipping: { address1: '14 Linking Road', city: 'Mumbai', state: 'Maharashtra', zip: '400012', country: 'IN' },
    items: [{ slug: product.slug, qty: 1 }],
    shippingMethod: 'standard'
  };
  const created = await api.post('/api/orders', base);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.order.shipping.country, 'IN');

  assert.equal((await api.post('/api/orders', { ...base, shipping: { ...base.shipping, zip: '123' } })).status, 422);
  assert.equal((await api.post('/api/orders', { ...base, shipping: { ...base.shipping, state: 'Narnia' } })).status, 422);
  assert.equal((await api.post('/api/orders', { ...base, customer: { ...base.customer, phone: '+1 415 555 0132' } })).status, 422);
});

test('admin order updates restock on cancellation and report accurate profit', async () => {
  await adminLogin(api);
  const key = `profit-${Date.now()}`;
  const created = await api.post('/api/orders', orderBody({ promoCode: 'WELCOME10', idempotencyKey: key }));
  assert.equal(created.status, 201);
  const order = created.body.order;
  const beforeCancel = (await api.get(`/api/admin/products`)).body.products.find((entry) => entry.slug === product.slug).stock;

  const list = await api.get('/api/admin/orders');
  assert.equal(list.status, 200);
  const adminRow = list.body.orders.find((entry) => entry.number === order.number);
  assert.equal(adminRow.grossProfit, 1.6, '2 × $6 margin minus the $10.40 WELCOME10 discount');
  assert.equal(adminRow.costTotal, 92);

  const packed = await api.patch(`/api/admin/orders/${order.number}`, { status: 'Packed', trackingNumber: 'TRK-123' });
  assert.equal(packed.status, 200);
  assert.equal(packed.body.order.status, 'Packed');
  assert.equal(packed.body.order.trackingNumber, 'TRK-123');

  const cancelled = await api.patch(`/api/admin/orders/${order.number}`, { status: 'Cancelled' });
  assert.equal(cancelled.status, 200);
  const afterCancel = (await api.get('/api/admin/products')).body.products.find((entry) => entry.slug === product.slug).stock;
  assert.equal(afterCancel, beforeCancel + 2, 'cancelling returns the units');

  const report = await api.get('/api/admin/reports/profit?range=all');
  assert.equal(report.status, 200);
  assert.ok(report.body.totals.revenue >= 0);
  assert.equal(report.body.totals.discountsGiven >= 10.4, true);
  const reportProduct = report.body.products.find((entry) => entry.slug === product.slug);
  assert.ok(reportProduct);
  assert.equal(reportProduct.currentBaseCost, 46);
  assert.equal(reportProduct.currentProfit, 6);
});

test('cross-origin state changes are refused', async () => {
  const response = await api.post('/api/orders', orderBody(), { origin: 'https://evil.example' });
  assert.equal(response.status, 403);
});

test('order creation is rate limited', async () => {
  let limited = false;
  for (let index = 0; index < 25; index += 1) {
    const response = await api.post('/api/orders', orderBody({ items: [{ slug: product.slug, qty: 1 }] }));
    if (response.status === 429) {
      limited = true;
      break;
    }
  }
  assert.equal(limited, true, 'the per-IP order limiter must engage');
});
