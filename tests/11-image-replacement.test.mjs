// Product image replacement: content sniffing, DB persistence, cache-busted
// storefront URLs, per-product isolation, and survival across a restart that
// re-runs the catalogue import.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, adminLogin, pngBase64 } from './helpers.mjs';

const PRODUCT = 'silk-milk-cleanser';
const OTHER = 'melt-cleansing-balm';

let server;
let api;

before(async () => {
  server = await startServer({ prefix: 'velune-images' });
  api = server.api;
  await adminLogin(api);
});

after(async () => {
  await server.stop();
});

function heicBytes() {
  const buffer = Buffer.alloc(256);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('heic', 8, 'ascii');
  return buffer.toString('base64');
}

test('upload, save, replace and cache-bust the storefront URL', async () => {
  // The seeded row carries a legacy vector path; it must be treated as missing.
  const seeded = await api.get(`/api/products/${PRODUCT}`, { guest: true });
  assert.equal(seeded.body.product.image, '');
  assert.equal(seeded.body.product.photoRequired, true);
  const seededPage = await api.get(`/product/${PRODUCT}`, { guest: true });
  assert.match(seededPage.body, /data-pdp-placeholder/);
  assert.equal(seededPage.body.includes('/images/catalog/'), false);

  // An Android picker can report image/jpg for a PNG; the bytes are what count.
  const first = await api.post('/api/admin/uploads', { mime: 'image/jpg', data: pngBase64({ width: 80, height: 100 }) });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.mime, 'image/png');
  assert.match(first.body.path, /^\/images\/uploads\/[a-z0-9-]+\.png$/);

  const saved = await api.patch(`/api/admin/products/${PRODUCT}`, { image: first.body.path });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.product.image, first.body.path, 'the database must store the uploaded path');

  const publicProduct = await api.get(`/api/products/${PRODUCT}`, { guest: true });
  assert.equal(publicProduct.status, 200);
  assert.equal(publicProduct.body.product.image.split('?')[0], first.body.path);
  assert.match(publicProduct.body.product.image, /\?v=/, 'public image URLs must carry a version token');
  assert.match(publicProduct.body.product.cardImage, /\?v=/);
  assert.equal((await api.get(first.body.path, { guest: true })).status, 200);

  const page = await api.get(`/product/${PRODUCT}`, { guest: true });
  assert.equal(page.status, 200);
  assert.ok(page.body.includes(first.body.path), 'the product page must render the saved upload');
  assert.match(page.body, /\?v=/, 'the product page must not pin a stale image URL');

  // Replace the image again, this time with no declared MIME at all.
  const second = await api.post('/api/admin/uploads', { data: pngBase64({ width: 90, height: 120 }) });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const replaced = await api.patch(`/api/admin/products/${PRODUCT}`, { image: second.body.path });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));

  const refreshed = await api.get(`/api/products/${PRODUCT}`, { guest: true });
  assert.equal(refreshed.body.product.image.split('?')[0], second.body.path);
  assert.notEqual(refreshed.body.product.image.split('?')[0], first.body.path);
  assert.equal((await api.get(second.body.path, { guest: true })).status, 200);
});

test('each product keeps its own uploaded image', async () => {
  const own = await api.post('/api/admin/uploads', { data: pngBase64({ width: 70, height: 90 }) });
  assert.equal(own.status, 201);
  assert.equal((await api.patch(`/api/admin/products/${OTHER}`, { image: own.body.path })).status, 200);

  const other = await api.get(`/api/products/${OTHER}`, { guest: true });
  assert.equal(other.body.product.image.split('?')[0], own.body.path);

  const main = await api.get(`/api/products/${PRODUCT}`, { guest: true });
  assert.notEqual(main.body.product.image.split('?')[0], own.body.path, 'updating one SKU must not touch another');
});

test('HEIC photos are rejected with a clear message instead of silently failing', async () => {
  const response = await api.post('/api/admin/uploads', { mime: 'image/heic', data: heicBytes() });
  assert.equal(response.status, 422);
  assert.match(response.body.error, /HEIC\/HEIF/);
});

test('an upload survives a restart even when the catalogue marker is missing', async () => {
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'velune-images-restart-'));
  const env = {
    DATA_DIR: path.join(shared, 'data'),
    UPLOADS_DIR: path.join(shared, 'uploads'),
    STORE_DB_PATH: path.join(shared, 'images.db')
  };
  let first;
  let second;
  try {
    first = await startServer({ prefix: 'velune-images-a', env });
    await adminLogin(first.api);
    const uploaded = await first.api.post('/api/admin/uploads', { data: pngBase64({ width: 96, height: 120 }) });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    const url = uploaded.body.path;
    assert.equal((await first.api.patch(`/api/admin/products/${PRODUCT}`, { image: url })).status, 200);
    await first.stop({ keepData: true });
    first = null;

    // Simulate an older database without the one-time catalogue marker: the
    // next boot re-imports data/cosmetics.json and must not revert the photo.
    const db = new DatabaseSync(env.STORE_DB_PATH);
    db.prepare("DELETE FROM meta WHERE key = 'catalog_import'").run();
    db.close();

    second = await startServer({ prefix: 'velune-images-b', env });
    const product = await second.api.get(`/api/products/${PRODUCT}`, { guest: true });
    assert.equal(product.body.product.image.split('?')[0], url, 'a catalogue re-import must preserve an owner image');
    assert.equal((await second.api.get(url, { guest: true })).status, 200);
    assert.ok(fs.existsSync(path.join(env.UPLOADS_DIR, path.basename(url))));
  } finally {
    if (first) await first.stop().catch(() => {});
    if (second) await second.stop().catch(() => {});
    fs.rmSync(shared, { recursive: true, force: true });
  }
});
