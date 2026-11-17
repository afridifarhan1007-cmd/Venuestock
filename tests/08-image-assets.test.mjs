// Product imagery policy: the storefront shows photography only. Legacy vector
// packshots are never served, products without a photograph are explicitly
// marked, and an admin upload replaces that pending state.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, adminLogin, pngBase64, ROOT } from './helpers.mjs';

let server;
let api;

const cleanUrl = (url) => String(url || '').split('?')[0];
const fileFor = (url) => path.join(ROOT, 'public', cleanUrl(url).slice(1).replaceAll('/', path.sep));
const isPhoto = (url) => /\.(jpe?g|png|webp|avif)$/i.test(cleanUrl(url));
const isVector = (url) => /\.svg$/i.test(cleanUrl(url));
const readManifest = () => {
  const file = path.join(ROOT, 'data', 'image-licenses.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).assets : {};
};

before(async () => {
  server = await startServer();
  api = server.api;
});

after(async () => {
  await server.stop();
});

test('no product serves vector art or a missing image file', async () => {
  const { body } = await api.get('/api/products');
  assert.ok(body.products.length >= 200);
  for (const product of body.products) {
    assert.equal(isVector(product.image), false, `${product.slug} still exposes a vector packshot`);
    assert.equal(isVector(product.cardImage), false, `${product.slug} still renders a vector card image`);
    assert.equal(typeof product.photoRequired, 'boolean', `${product.slug} must declare its photo state`);
    if (product.image) {
      assert.ok(isPhoto(product.image), `${product.slug} has a non-photographic image: ${product.image}`);
      assert.ok(fs.existsSync(fileFor(cleanUrl(product.image))), `${product.slug} points at a missing file`);
    }
  }
});

test('products without a photograph are marked instead of illustrated', async () => {
  const { body } = await api.get('/api/products');
  const missing = body.products.filter((product) => product.photoRequired);
  assert.ok(missing.length > 0, 'the seeded catalogue has no real photography');
  for (const product of missing) {
    assert.equal(product.image, '', `${product.slug} must not fall back to artwork`);
    assert.equal(product.cardImage, '', `${product.slug} card must not fall back to artwork`);
    assert.equal(product.artwork, '', `${product.slug} still has a vector fallback`);
  }
});

test('storefront pages never emit catalogue vectors and show a pending PDP', async () => {
  const home = await api.get('/', { guest: true });
  assert.equal(home.status, 200);
  assert.equal(home.body.includes('/images/catalog/'), false, 'home categories must not show vector packshots');

  const { body } = await api.get('/api/products');
  const pending = body.products.find((product) => product.photoRequired);
  const page = await api.get(`/product/${pending.slug}`, { guest: true });
  assert.equal(page.status, 200);
  assert.match(page.body, /data-pdp-placeholder/, 'missing-photo product needs an explicit pending state');
  assert.match(page.body, /Photo coming soon/);
  assert.equal(page.body.includes('/images/catalog/'), false, 'PDP must not reference catalogue vectors');
  assert.equal(/data-pdp-image/.test(page.body), false, 'a pending product must not render a fake image');
});

test('the broken-image fallback stays neutral, with no bottle illustration', async () => {
  const script = await api.get('/js/img-fallback.js', { guest: true });
  assert.equal(script.status, 200);
  assert.equal(script.body.includes('x="150"'), false, 'the fallback still draws a bottle');
  assert.match(script.body, /PHOTO COMING SOON/);
});

test('the admin flags missing photos and an upload replaces the pending state', async () => {
  await adminLogin(api);
  const admin = await api.get('/api/admin/products');
  const before = admin.body.products.find((product) => product.photoRequired);
  assert.ok(before, 'the admin needs a photo-required flag');
  assert.ok(before.image, 'the legacy path stays in the admin record for reference');

  const uploaded = await api.post('/api/admin/uploads', { data: pngBase64({ width: 90, height: 112 }) });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const saved = await api.patch(`/api/admin/products/${before.slug}`, { image: uploaded.body.path });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const storefront = await api.get(`/api/products/${before.slug}`, { guest: true });
  assert.equal(storefront.body.product.photoRequired, false);
  assert.equal(cleanUrl(storefront.body.product.image), uploaded.body.path);
  assert.match(storefront.body.product.image, /\?v=/, 'photo URLs must be versioned');

  const page = await api.get(`/product/${before.slug}`, { guest: true });
  assert.match(page.body, /data-pdp-image/, 'the uploaded photograph must replace the pending panel');
  assert.equal(page.body.includes('data-pdp-placeholder'), false);
  assert.ok(page.body.includes(uploaded.body.path));
  assert.equal((await api.get(uploaded.body.path, { guest: true })).status, 200);
});

test('any applied photography ships both responsive sizes and a licence record', async () => {
  const { body } = await api.get('/api/products');
  const manifest = readManifest();
  for (const product of body.products) {
    if (!/-800\.jpe?g$/i.test(cleanUrl(product.image))) continue;
    const small = product.image.replace(/-800\./i, '-400.');
    assert.ok(fs.existsSync(fileFor(cleanUrl(small))), `${product.slug} has no 400px variant at ${small}`);
    assert.ok(manifest[product.slug], `${product.slug} has a photograph but no licence record`);
    assert.match(String(manifest[product.slug].license || ''), /\S/, `${product.slug} has an empty licence`);
    assert.equal(
      /(^|[^a-z])(nc|nd)([^a-z]|$)/.test(String(manifest[product.slug].license).toLowerCase()),
      false,
      `${product.slug} uses a non-commercial or no-derivatives licence`
    );
  }
});
