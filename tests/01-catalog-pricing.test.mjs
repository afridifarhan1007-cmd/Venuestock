import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin } from './helpers.mjs';

let server;
let api;

before(async () => {
  server = await startServer();
  api = server.api;
});

after(async () => {
  await server.stop();
});

test('storefront exposes a cosmetics-only catalogue of 200+ products', async () => {
  const response = await api.get('/api/products');
  assert.equal(response.status, 200);
  assert.ok(response.body.products.length >= 200, `expected 200+ products, got ${response.body.products.length}`);

  const slugs = new Set(response.body.products.map((product) => product.slug));
  for (const legacy of ['arden-table-lamp', 'atlas-headphones', 'nomad-weekender', 'heritage-watch']) {
    assert.equal(slugs.has(legacy), false, `${legacy} should not be sold in the cosmetics store`);
  }

  const beauty = new Set(['skincare', 'makeup', 'haircare', 'perfumes', 'beauty-accessories']);
  const categorySlugs = new Set(response.body.categories.map((category) => category.slug));
  assert.deepEqual([...categorySlugs].sort(), [...beauty].sort());

  for (const product of response.body.products) {
    assert.ok(beauty.has(product.category), `${product.slug} has non-beauty category ${product.category}`);
    assert.equal(product.price, 52, `${product.slug} should default to the $52 selling price`);
    assert.equal(Object.hasOwn(product, 'baseCost'), false, 'cost must never be exposed publicly');
    assert.equal(Object.hasOwn(product, 'profit'), false, 'profit must never be exposed publicly');
    assert.equal(/\.svg(?:\?|$)/i.test(product.image), false, `${product.slug} must not serve a vector packshot`);
    assert.equal(product.photoRequired, product.image === '', `${product.slug} photo state is inconsistent`);
    assert.ok(product.description.length >= 10);
  }
});

test('admin sees the $46 cost and $6 profit behind every catalogue product', async () => {
  await adminLogin(api);
  const response = await api.get('/api/admin/products');
  assert.equal(response.status, 200);
  assert.ok(response.body.products.length >= 200);
  for (const product of response.body.products) {
    assert.equal(product.baseCost, 46, `${product.slug} base cost`);
    assert.equal(product.profit, 6, `${product.slug} profit`);
    assert.equal(product.price, 52, `${product.slug} selling price`);
    assert.equal(product.priceMode, 'formula');
    assert.equal(product.tracked, true);
    assert.equal(product.marginPercent, 13.04);
  }
});

test('selling price follows cost plus profit and manual prices are respected', async () => {
  const create = await api.post('/api/admin/products', {
    name: 'Test Barrier Balm',
    category: 'skincare',
    stock: 12,
    image: '/images/catalog/melt-cleansing-balm.svg',
    short: 'A test balm for pricing checks.',
    description: 'A rich barrier balm used to verify the server-side pricing engine.'
  });
  assert.equal(create.status, 201);
  const created = create.body.product;
  assert.equal(created.baseCost, 46);
  assert.equal(created.profit, 6);
  assert.equal(created.price, 52);

  const recost = await api.patch(`/api/admin/products/${created.slug}`, { ...created, baseCost: 50, profit: 8 });
  assert.equal(recost.status, 200);
  assert.equal(recost.body.product.price, 58, '50 cost + 8 profit = 58');
  assert.equal(recost.body.product.baseCost, 50);

  const manual = await api.patch(`/api/admin/products/${created.slug}`, { ...recost.body.product, priceMode: 'manual', price: 99 });
  assert.equal(manual.status, 200);
  assert.equal(manual.body.product.price, 99);
  assert.equal(manual.body.product.priceMode, 'manual');

  const zeroProfit = await api.patch(`/api/admin/products/${created.slug}`, { ...manual.body.product, priceMode: 'formula', baseCost: 20, profit: 0 });
  assert.equal(zeroProfit.status, 200);
  assert.equal(zeroProfit.body.product.price, 20);

  const removed = await api.del(`/api/admin/products/${created.slug}`);
  assert.equal(removed.status, 200);
});

test('pricing rejects impossible input', async () => {
  const base = {
    name: 'Invalid Pricing Product',
    category: 'skincare',
    stock: 3,
    image: '/images/catalog/melt-cleansing-balm.svg',
    description: 'A product used only to prove invalid pricing is refused.'
  };
  assert.equal((await api.post('/api/admin/products', { ...base, baseCost: -1, profit: 6 })).status, 422);
  assert.equal((await api.post('/api/admin/products', { ...base, baseCost: 46, profit: -2 })).status, 422);
  assert.equal((await api.post('/api/admin/products', { ...base, priceMode: 'manual', price: 0 })).status, 422);
  const droppedCompareAt = await api.post('/api/admin/products', { ...base, baseCost: 46, profit: 6, compareAt: 40 });
  assert.equal(droppedCompareAt.status, 201, 'a compare-at at or below the price saves instead of erroring');
  assert.equal(droppedCompareAt.body.product.compareAt, null, 'the meaningless compare-at is dropped');
  assert.equal((await api.post('/api/admin/products', { ...base, category: 'furniture' })).status, 422);
});

test('server-rendered storefront pages carry catalogue content and metadata', async () => {
  for (const route of ['/', '/shop', '/checkout', '/account', '/contact', '/policies', '/admin']) {
    const response = await api.get(route);
    assert.equal(response.status, 200, route);
  }
  const shop = await api.get('/shop');
  assert.match(shop.body, /Skincare/);
  assert.doesNotMatch(shop.body, /Arden Table Lamp|Wireless Headphones/);

  const first = await api.get('/api/products');
  const product = first.body.products[0];
  const page = await api.get(`/product/${product.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.body, new RegExp(product.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(page.body, /\$52/);
  assert.match(page.body, /Product/);

  const sitemap = await api.get('/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.body, /\/product\//);
  const robots = await api.get('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.body, /Sitemap:/);
});
