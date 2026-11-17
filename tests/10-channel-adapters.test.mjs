// Shopify and WooCommerce adapters, exercised against mock providers.
// The adapters call global fetch, so the test swaps in a recording mock and
// asserts the exact endpoints, auth headers and payloads each provider needs.
import test, { after, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'velune-channels-'));
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.STORE_DB_PATH = path.join(tempDir, 'channels.db');
process.env.INTEGRATIONS_SECRET = 'channel-test-secret';

const { ADAPTERS, IntegrationError, normalizeConfig } = await import('../integrations.js');
const { sqlite } = await import('../store.js');
const realFetch = globalThis.fetch;
let calls = [];
let routes = new Map();

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function routeKey(method, url) {
  return `${method} ${url}`;
}

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({
      method,
      url: String(url),
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : null
    });
    const handler = routes.get(routeKey(method, String(url)));
    if (!handler) return json({ message: `Unexpected call: ${method} ${url}` }, 404);
    return handler();
  };
});

afterEach(() => {
  calls = [];
  routes = new Map();
});

after(() => {
  globalThis.fetch = realFetch;
  try { sqlite.close(); } catch { /* already closed */ }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const shopifyConfig = normalizeConfig('shopify', { shop: 'velune-test.myshopify.com', accessToken: 'shpat_shopify_secret', apiVersion: '2024-10' });
const wooConfig = normalizeConfig('woocommerce', { siteUrl: 'https://woo.example.com', consumerKey: 'ck_test', consumerSecret: 'cs_test' });
const product = {
  slug: 'silk-milk-cleanser',
  name: 'Silk Milk Cleanser',
  description: 'A gentle daily cleanser.',
  short: 'Gentle cleanser',
  category: 'skincare',
  image: 'https://cdn.example.com/cleanser.jpg'
};
const order = {
  number: 'VLN-9001',
  createdAt: '2026-11-03T10:00:00.000Z',
  currency: 'USD',
  total: 112,
  paymentMethod: 'Cash on delivery',
  shippingMethod: 'standard',
  shippingCost: 8,
  customer: { firstName: 'Nora', lastName: 'Alvarez', email: 'nora@example.com', phone: '+1 415 555 0132' },
  shipping: { address1: '1200 Harbor Ave', city: 'Portland', state: 'OR', zip: '97202', country: 'US' },
  items: [{ slug: 'silk-milk-cleanser', name: 'Silk Milk Cleanser', qty: 2, price: 52 }]
};

test('Shopify connection test and import use the Admin API with a token header', async () => {
  const base = `https://${shopifyConfig.shop}/admin/api/2024-10`;
  routes.set(routeKey('GET', `${base}/shop.json`), () => json({ shop: { name: 'VELUNE Test', domain: shopifyConfig.shop, currency: 'USD' } }));
  routes.set(routeKey('GET', `${base}/products.json?limit=250&status=active`), () => json({
    products: [{
      id: 11,
      title: 'Oat Milk Cleanser',
      body_html: '<p>Gentle <b>daily</b> cleanser</p>',
      product_type: 'Skincare',
      status: 'active',
      variants: [
        { id: 21, sku: 'OAT-1', price: '64.00', inventory_quantity: 7 },
        { id: 22, sku: 'OAT-2', price: '64.00', inventory_quantity: 5 }
      ],
      images: [{ src: 'https://cdn.shopify.com/oat.jpg' }]
    }]
  }));

  const connection = await ADAPTERS.shopify.test(shopifyConfig);
  assert.match(connection.message, /VELUNE Test/);
  assert.equal(calls[0].headers['X-Shopify-Access-Token'], 'shpat_shopify_secret');

  const rows = await ADAPTERS.shopify.importProducts(shopifyConfig);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].externalId, '11');
  assert.equal(rows[0].externalVariant, '21');
  assert.equal(rows[0].name, 'Oat Milk Cleanser');
  assert.equal(rows[0].description, 'Gentle daily cleanser');
  assert.equal(rows[0].stock, 12, 'stock is summed across variants');
  assert.equal(rows[0].price, 64);
  assert.equal(rows[0].image, 'https://cdn.shopify.com/oat.jpg');
});

test('Shopify export, stock sync and order push send provider-shaped payloads', async () => {
  const base = `https://${shopifyConfig.shop}/admin/api/2024-10`;
  routes.set(routeKey('POST', `${base}/products.json`), () => json({ product: { id: 101, handle: 'silk-milk-cleanser', status: 'active', variants: [{ id: 201, sku: 'silk-milk-cleanser' }] } }, 201));
  routes.set(routeKey('PUT', `${base}/variants/201.json`), () => json({ variant: { id: 201 } }));
  routes.set(routeKey('GET', `${base}/locations.json`), () => json({ locations: [{ id: 9, active: true }] }));
  routes.set(routeKey('GET', `${base}/products/101.json`), () => json({ product: { variants: [{ id: 201, inventory_item_id: 777 }] } }));
  routes.set(routeKey('POST', `${base}/inventory_levels/set.json`), () => json({ inventory_level: { available: 24 } }));
  routes.set(routeKey('POST', `${base}/orders.json`), () => json({ order: { id: 5001, name: '#5001', order_number: 5001 } }, 201));

  const link = await ADAPTERS.shopify.exportProduct(shopifyConfig, product, { price: 52, stock: 24 });
  assert.equal(link.externalId, '101');
  assert.equal(link.externalVariant, '201');
  const exported = calls.find((call) => call.method === 'POST' && call.url.endsWith('/products.json'));
  assert.equal(exported.body.product.title, 'Silk Milk Cleanser');
  assert.equal(exported.body.product.variants[0].price, '52.00');
  assert.equal(exported.body.product.variants[0].inventory_quantity, 24);

  const sync = await ADAPTERS.shopify.pushInventory(
    shopifyConfig,
    { externalId: '101', externalVariant: '201', externalSku: 'silk-milk-cleanser', meta: { inventoryItemId: '777' } },
    { price: 55, stock: 18 }
  );
  assert.deepEqual(sync.updated, ['price', 'stock']);
  const priceCall = calls.find((call) => call.url.endsWith('/variants/201.json'));
  assert.deepEqual(priceCall.body, { variant: { id: 201, price: '55.00' } });
  const stockCall = calls.find((call) => call.url.endsWith('/inventory_levels/set.json'));
  assert.deepEqual(stockCall.body, { location_id: 9, inventory_item_id: 777, available: 18 });

  const links = new Map([['silk-milk-cleanser', { externalId: '101', externalVariant: '201' }]]);
  const pushed = await ADAPTERS.shopify.pushOrder(shopifyConfig, order, links);
  assert.equal(pushed.externalId, '5001');
  const orderCall = calls.find((call) => call.url.endsWith('/orders.json'));
  assert.deepEqual(orderCall.body.order.line_items, [{ variant_id: 201, quantity: 2 }]);
  assert.equal(orderCall.body.order.email, 'nora@example.com');
  assert.equal(orderCall.body.order.shipping_address.country, 'United States');
  assert.equal(orderCall.body.order.financial_status, 'pending');
});

test('Shopify rejects an order whose lines are not linked yet', async () => {
  await assert.rejects(
    () => ADAPTERS.shopify.pushOrder(shopifyConfig, order, new Map()),
    (error) => error instanceof IntegrationError && /Export the products first/.test(error.message)
  );
});

test('Shopify errors never echo the access token', async () => {
  const base = `https://${shopifyConfig.shop}/admin/api/2024-10`;
  routes.set(routeKey('GET', `${base}/shop.json`), () => json({ message: `Bad token shpat_shopify_secret` }, 401));
  await assert.rejects(
    () => ADAPTERS.shopify.test(shopifyConfig),
    (error) => {
      assert.ok(error instanceof IntegrationError);
      assert.equal(error.status, 409);
      assert.equal(error.message.includes('shpat_shopify_secret'), false, 'the token must be scrubbed');
      return true;
    }
  );
});

test('WooCommerce connection test and import use Basic auth on the REST route', async () => {
  const base = 'https://woo.example.com/wp-json/wc/v3';
  routes.set(routeKey('GET', `${base}/products?per_page=1`), () => json([]));
  routes.set(routeKey('GET', `${base}/products?per_page=100&status=publish`), () => json([{
    id: 31,
    name: 'Cushion Lip Tint',
    description: '<p>Sheer rose tint</p>',
    short_description: 'Sheer rose',
    sku: 'TINT-04',
    price: '38.00',
    manage_stock: true,
    stock_quantity: 7,
    images: [{ src: 'https://woo.example.com/tint.jpg' }],
    categories: [{ name: 'Makeup' }],
    status: 'publish'
  }]));

  const connection = await ADAPTERS.woocommerce.test(wooConfig);
  assert.match(connection.message, /woo\.example\.com/);
  const expectedAuth = `Basic ${Buffer.from('ck_test:cs_test').toString('base64')}`;
  assert.equal(calls[0].headers.Authorization, expectedAuth);

  const rows = await ADAPTERS.woocommerce.importProducts(wooConfig);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].externalId, '31');
  assert.equal(rows[0].name, 'Cushion Lip Tint');
  assert.equal(rows[0].description, 'Sheer rose tint');
  assert.equal(rows[0].stock, 7);
  assert.equal(rows[0].categoryHint, 'Makeup');
});

test('WooCommerce export, stock sync and order push send provider-shaped payloads', async () => {
  const base = 'https://woo.example.com/wp-json/wc/v3';
  routes.set(routeKey('POST', `${base}/products`), () => json({ id: 301, sku: 'silk-milk-cleanser', permalink: 'https://woo.example.com/?p=301' }, 201));
  routes.set(routeKey('PUT', `${base}/products/301`), () => json({ id: 301 }));
  routes.set(routeKey('POST', `${base}/orders`), () => json({ id: 401, number: '401', status: 'processing' }, 201));

  const link = await ADAPTERS.woocommerce.exportProduct(wooConfig, product, { price: 52, stock: 24 });
  assert.equal(link.externalId, '301');
  assert.equal(link.meta.permalink, 'https://woo.example.com/?p=301');
  const exported = calls.find((call) => call.method === 'POST' && call.url.endsWith('/products'));
  assert.equal(exported.body.name, 'Silk Milk Cleanser');
  assert.equal(exported.body.regular_price, '52.00');
  assert.equal(exported.body.manage_stock, true);
  assert.equal(exported.body.stock_quantity, 24);

  const sync = await ADAPTERS.woocommerce.pushInventory(wooConfig, { externalId: '301', meta: {} }, { price: 55, stock: 18 });
  assert.deepEqual(sync.updated, ['price', 'stock']);
  const syncCall = calls.find((call) => call.method === 'PUT' && call.url.endsWith('/products/301'));
  assert.equal(syncCall.body.regular_price, '55.00');
  assert.equal(syncCall.body.stock_quantity, 18);

  const links = new Map([['silk-milk-cleanser', { externalId: '301' }]]);
  const pushed = await ADAPTERS.woocommerce.pushOrder(wooConfig, order, links);
  assert.equal(pushed.externalId, '401');
  const orderCall = calls.find((call) => call.method === 'POST' && call.url.endsWith('/orders'));
  assert.deepEqual(orderCall.body.line_items, [{ product_id: 301, quantity: 2 }]);
  assert.equal(orderCall.body.payment_method, 'cod');
  assert.equal(orderCall.body.billing.email, 'nora@example.com');
});

test('WooCommerce errors never echo the consumer secret', async () => {
  const base = 'https://woo.example.com/wp-json/wc/v3';
  routes.set(routeKey('GET', `${base}/products?per_page=1`), () => json({ message: 'Rejected cs_test' }, 401));
  await assert.rejects(
    () => ADAPTERS.woocommerce.test(wooConfig),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.message.includes('cs_test'), false);
      return true;
    }
  );
});
