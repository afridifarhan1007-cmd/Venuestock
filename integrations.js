// ---------------------------------------------------------------- sales channels
// Real HTTP adapters for Shopify, WooCommerce and a configurable supplier API.
// Nothing here is a stub: every action performs a live request against the
// configured endpoint, with a timeout, no redirect following and errors that
// never echo an access token back to the browser or into a job log.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PRIVATE_DIR } from './store.js';

export class IntegrationError extends Error {
  constructor(message, { status = 502, detail = null } = {}) {
    super(message);
    this.name = 'IntegrationError';
    this.status = status;
    this.detail = detail;
  }
}

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const PROVIDERS = {
  shopify: {
    label: 'Shopify',
    blurb: 'Push products, prices and stock to a Shopify store, and pull its catalogue into VELUNE.',
    fields: [
      { key: 'shop', label: 'Shop domain', required: true, secret: false, placeholder: 'your-store.myshopify.com', help: 'Use the *.myshopify.com domain, not a custom domain.' },
      { key: 'accessToken', label: 'Admin API access token', required: true, secret: true, placeholder: 'shpat_…', help: 'Shopify admin → Settings → Apps and sales channels → Develop apps → Admin API access token.' },
      { key: 'apiVersion', label: 'API version', required: false, secret: false, placeholder: '2024-10', help: 'Defaults to 2024-10.' }
    ],
    defaults: { apiVersion: '2024-10' }
  },
  woocommerce: {
    label: 'WooCommerce',
    blurb: 'Publish products and stock to a WooCommerce site and import its product catalogue.',
    fields: [
      { key: 'siteUrl', label: 'Site URL', required: true, secret: false, placeholder: 'https://shop.example.com', help: 'The WordPress site root. The REST route /wp-json/wc/v3 must be reachable.' },
      { key: 'consumerKey', label: 'Consumer key', required: true, secret: true, placeholder: 'ck_…', help: 'WooCommerce → Settings → Advanced → REST API.' },
      { key: 'consumerSecret', label: 'Consumer secret', required: true, secret: true, placeholder: 'cs_…', help: 'Read/write permission is required for pushing products and stock.' }
    ],
    defaults: {}
  },
  supplier: {
    label: 'Supplier API',
    blurb: 'A generic JSON supplier feed for catalogue import, stock updates and fulfilment orders.',
    fields: [
      { key: 'baseUrl', label: 'Base URL', required: true, secret: false, placeholder: 'https://api.supplier.example.com', help: 'HTTPS endpoint root. Requests never follow redirects.' },
      { key: 'apiKey', label: 'API key', required: true, secret: true, placeholder: 'Supplier API key', help: 'Sent in the configured auth header.' },
      { key: 'authHeader', label: 'Auth header', required: false, secret: false, placeholder: 'Authorization', help: 'Defaults to Authorization.' },
      { key: 'authPrefix', label: 'Auth prefix', required: false, secret: false, placeholder: 'Bearer ', help: 'Include the trailing space. Leave blank for a raw key.' },
      { key: 'productsPath', label: 'Products path', required: false, secret: false, placeholder: '/products', help: 'GET returns an array or { products | data | items }.' },
      { key: 'ordersPath', label: 'Orders path', required: false, secret: false, placeholder: '/orders', help: 'POST receives a normalised order.' },
      { key: 'stockPath', label: 'Stock path', required: false, secret: false, placeholder: '/inventory', help: 'POST receives { sku, quantity, price }.' }
    ],
    defaults: {
      authHeader: 'Authorization',
      authPrefix: 'Bearer ',
      productsPath: '/products',
      ordersPath: '/orders',
      stockPath: '/inventory'
    }
  }
};

export const PROVIDER_KEYS = Object.keys(PROVIDERS);

// ---------------------------------------------------------------- secrets at rest

function encryptionKey() {
  if (process.env.INTEGRATIONS_SECRET) {
    return crypto.createHash('sha256').update(`velune-integrations:${process.env.INTEGRATIONS_SECRET}`).digest();
  }
  // Without an explicit secret the key lives beside the database in the
  // private directory. It keeps tokens out of the SQLite payload in plain
  // text; production should set INTEGRATIONS_SECRET instead.
  const file = path.join(PRIVATE_DIR, 'integrations.key');
  try {
    const existing = fs.readFileSync(file);
    if (existing.length !== 32) throw new Error('Integration key file must contain 32 bytes.');
    return existing;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(file, key, { mode: 0o600, flag: 'wx' });
    return key;
  } catch (error) {
    if (error.code === 'EEXIST') return fs.readFileSync(file);
    throw error;
  }
}

export function sealConfig(config) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function openConfig(record) {
  const sealed = record?.encryptedConfig;
  if (!sealed) throw new IntegrationError('This channel has no saved credentials.', { status: 422 });
  const [version, ivText, tagText, bodyText] = String(sealed).split('.');
  if (version !== 'v1' || !ivText || !tagText || !bodyText) {
    throw new IntegrationError('Saved credentials are unreadable. Re-enter them.', { status: 422 });
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const text = Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString('utf8');
    // The provider drives which fields are secret, so error scrubbing needs it
    // even though it is stored in its own column rather than the sealed blob.
    return { ...JSON.parse(text), provider: record.provider };
  } catch {
    throw new IntegrationError('Saved credentials could not be decrypted. Re-enter them.', { status: 422 });
  }
}

function secretValues(config) {
  const def = PROVIDERS[config?.provider];
  if (!def) return [];
  return def.fields.filter((field) => field.secret).map((field) => config[field.key]).filter((value) => typeof value === 'string' && value.length > 2);
}

function scrub(message, config) {
  let text = String(message ?? '');
  for (const secret of secretValues(config)) text = text.split(secret).join('•••');
  return text.slice(0, 500);
}

// ---------------------------------------------------------------- config shaping

export function normalizeConfig(provider, input = {}, existing = null) {
  const def = PROVIDERS[provider];
  if (!def) throw new IntegrationError('Choose Shopify, WooCommerce or Supplier API.', { status: 422 });
  const config = { ...def.defaults, ...(existing || {}) };
  for (const field of def.fields) {
    const raw = input?.[field.key];
    if (field.secret) {
      if (typeof raw === 'string' && raw.trim()) config[field.key] = raw.trim().slice(0, 500);
    } else if (raw !== undefined) {
      // Auth prefixes such as "Bearer " are whitespace-sensitive.
      config[field.key] = field.key === 'authPrefix'
        ? String(raw ?? '').slice(0, 300)
        : String(raw ?? '').trim().slice(0, 300);
    }
  }
  for (const field of def.fields) {
    if (field.required && !config[field.key]) {
      throw new IntegrationError(`${field.label} is required.`, { status: 422 });
    }
  }
  if (provider === 'shopify') {
    config.shop = String(config.shop).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(config.shop)) {
      throw new IntegrationError('Shop domain must look like your-store.myshopify.com.', { status: 422 });
    }
    config.apiVersion = /^\d{4}-\d{2}$/.test(config.apiVersion) ? config.apiVersion : def.defaults.apiVersion;
  }
  if (provider === 'woocommerce') {
    config.siteUrl = String(config.siteUrl).replace(/\/+$/, '');
    assertHttpUrl(config.siteUrl, 'Site URL');
  }
  if (provider === 'supplier') {
    config.baseUrl = String(config.baseUrl).replace(/\/+$/, '');
    assertHttpUrl(config.baseUrl, 'Base URL');
    for (const key of ['productsPath', 'ordersPath', 'stockPath']) {
      const value = String(config[key] || def.defaults[key]);
      config[key] = value.startsWith('/') ? value : `/${value}`;
    }
    config.authHeader = config.authHeader || def.defaults.authHeader;
    if (config.authPrefix === undefined) config.authPrefix = def.defaults.authPrefix;
  }
  // Kept out of publicIntegration(); used so scrub() knows the secret fields.
  config.provider = provider;
  return config;
}

export function publicIntegration(record) {
  const def = PROVIDERS[record.provider];
  if (!def) {
    return { id: record.id, provider: record.provider, providerLabel: record.provider, name: record.name, active: record.active !== false, ready: false, config: {}, secrets: {}, createdAt: record.createdAt, updatedAt: record.updatedAt };
  }
  let config = {};
  try {
    config = openConfig(record);
  } catch {
    // A missing or rotated key should not break the whole list; the channel is
    // simply reported as unreadable so an administrator can re-enter it.
    config = {};
  }
  const shown = {};
  const secrets = {};
  for (const field of def.fields) {
    if (field.secret) secrets[field.key] = Boolean(config[field.key]);
    else shown[field.key] = config[field.key] ?? '';
  }
  const ready = def.fields.every((field) => config[field.key]);
  return {
    id: record.id,
    provider: record.provider,
    providerLabel: def.label,
    name: record.name,
    active: record.active !== false,
    ready,
    config: shown,
    secrets,
    createdAt: record.createdAt || '',
    updatedAt: record.updatedAt || ''
  };
}

export function providerFields(provider) {
  const def = PROVIDERS[provider];
  if (!def) throw new IntegrationError('Unknown provider.', { status: 422 });
  return def.fields.map((field) => ({ ...field }));
}

// ---------------------------------------------------------------- HTTP

function assertHttpUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new IntegrationError(`${label} is not a valid URL.`, { status: 422 });
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new IntegrationError(`${label} must use http or https.`, { status: 422 });
  return url;
}

async function httpJson(url, { method = 'GET', headers = {}, body = null, timeoutMs = 15_000, config = {}, label = 'The channel' } = {}) {
  assertHttpUrl(url, 'Request URL');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body === null ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === null ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error'
    });
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') throw new IntegrationError(`${label} did not respond within ${Math.round(timeoutMs / 1000)} seconds.`, { status: 504 });
    throw new IntegrationError(`${label} could not be reached: ${scrub(error.message, config)}`);
  }
  clearTimeout(timer);
  const text = await response.text().catch(() => '');
  if (text.length > 2_000_000) throw new IntegrationError(`${label} returned more than 2 MB of JSON.`, { status: 502 });
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const raw = (data && (data.message || data.error_description || data.error || data.errors)) || text.slice(0, 300) || `HTTP ${response.status}`;
    const reason = typeof raw === 'string' ? raw : JSON.stringify(raw);
    throw new IntegrationError(`${label} rejected the request (${response.status}): ${scrub(reason, config)}`, {
      status: response.status === 401 || response.status === 403 ? 409 : 502,
      detail: { status: response.status }
    });
  }
  if (data === null) throw new IntegrationError(`${label} did not return JSON.`, { status: 502 });
  return data;
}

function joinPath(base, suffix) {
  return `${String(base).replace(/\/+$/, '')}/${String(suffix).replace(/^\/+/, '')}`;
}

function safeImage(value) {
  const text = String(value || '').trim();
  if (text.startsWith('/images/')) return text;
  if (/^https:\/\//i.test(text)) return text.slice(0, 500);
  return '';
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------- Shopify

function shopifyRequest(config, suffix, options = {}) {
  return httpJson(joinPath(`https://${config.shop}/admin/api/${config.apiVersion}`, suffix), {
    ...options,
    config,
    label: 'Shopify',
    headers: { 'X-Shopify-Access-Token': config.accessToken, ...(options.headers || {}) }
  });
}

function shopifyProduct(product, price, stock, sku = product.slug) {
  return {
    title: String(product.name).slice(0, 250),
    body_html: `<p>${String(product.description || product.short || product.name)}</p>`,
    vendor: 'VELUNE',
    product_type: String(product.category || '').slice(0, 100),
    status: 'active',
    variants: [{
      price: Number(price).toFixed(2),
      sku,
      inventory_management: 'shopify',
      inventory_policy: 'deny',
      requires_shipping: true,
      inventory_quantity: Math.max(0, Number(stock) || 0)
    }],
    ...(product.image ? { images: [{ src: product.image }] } : {})
  };
}

const shopifyAdapter = {
  async test(config) {
    const data = await shopifyRequest(config, 'shop.json');
    const shop = data.shop || {};
    return { message: `Connected to ${shop.name || shop.domain || config.shop}.`, detail: { domain: shop.domain || config.shop, currency: shop.currency || '' } };
  },
  async importProducts(config) {
    const data = await shopifyRequest(config, 'products.json?limit=250&status=active');
    const rows = Array.isArray(data.products) ? data.products : [];
    return rows.map((row) => {
      const variants = Array.isArray(row.variants) ? row.variants : [];
      const first = variants[0] || {};
      const stock = variants.reduce((sum, variant) => sum + numeric(variant.inventory_quantity), 0);
      return {
        externalId: String(row.id),
        externalVariant: first.id ? String(first.id) : '',
        externalSku: String(first.sku || ''),
        name: stripHtml(row.title || ''),
        description: stripHtml(row.body_html || ''),
        short: stripHtml(row.body_html || '').slice(0, 220),
        price: numeric(first.price),
        cost: null,
        stock: Math.max(0, stock),
        image: safeImage((row.image && row.image.src) || (Array.isArray(row.images) ? row.images[0]?.src : '')),
        categoryHint: String(row.product_type || ''),
        status: String(row.status || 'active')
      };
    }).filter((row) => row.name && row.externalId);
  },
  async exportProduct(config, product, { price, stock, link = null }) {
    const sku = link?.externalSku || product.slug;
    const body = { product: shopifyProduct(product, price, stock, sku) };
    if (link?.externalId) body.product.id = Number(link.externalId);
    const data = link?.externalId
      ? await shopifyRequest(config, `products/${link.externalId}.json`, { method: 'PUT', body })
      : await shopifyRequest(config, 'products.json', { method: 'POST', body });
    const saved = data.product || {};
    const variant = Array.isArray(saved.variants) ? saved.variants[0] || {} : {};
    if (!saved.id) throw new IntegrationError('Shopify accepted the request but returned no product id.');
    return {
      externalId: String(saved.id),
      externalVariant: variant.id ? String(variant.id) : link?.externalVariant || '',
      externalSku: variant.sku || product.slug,
      meta: { handle: saved.handle || '', status: saved.status || '' }
    };
  },
  async pushInventory(config, link, { price, stock }) {
    const updated = [];
    const variantId = link.externalVariant;
    if (variantId) {
      await shopifyRequest(config, `variants/${variantId}.json`, { method: 'PUT', body: { variant: { id: Number(variantId), price: Number(price).toFixed(2) } } });
      updated.push('price');
    }
    const locations = await shopifyRequest(config, 'locations.json');
    const location = (locations.locations || []).find((entry) => entry.active !== false) || (locations.locations || [])[0];
    if (!location) throw new IntegrationError('Shopify returned no active location for stock updates.');
    let inventoryItemId = link.meta?.inventoryItemId;
    if (!inventoryItemId && link.externalId) {
      const data = await shopifyRequest(config, `products/${link.externalId}.json`);
      const variants = data.product?.variants || [];
      const match = variants.find((entry) => String(entry.id) === String(variantId)) || variants[0];
      inventoryItemId = match?.inventory_item_id ? String(match.inventory_item_id) : '';
    }
    if (!inventoryItemId) throw new IntegrationError('Shopify did not return an inventory item id for this product.');
    await shopifyRequest(config, 'inventory_levels/set.json', {
      method: 'POST',
      body: { location_id: location.id, inventory_item_id: Number(inventoryItemId), available: Math.max(0, Number(stock) || 0) }
    });
    updated.push('stock');
    return { updated, meta: { ...(link.meta || {}), inventoryItemId, locationId: String(location.id) } };
  },
  async pushOrder(config, order, links) {
    const lineItems = [];
    for (const item of order.items || []) {
      const link = links.get(item.slug);
      if (!link?.externalVariant) continue;
      lineItems.push({ variant_id: Number(link.externalVariant), quantity: Number(item.qty) || 1 });
    }
    if (!lineItems.length) throw new IntegrationError('None of the order lines are linked to a Shopify variant. Export the products first.');
    const data = await shopifyRequest(config, 'orders.json', {
      method: 'POST',
      body: {
        order: {
          line_items: lineItems,
          financial_status: 'pending',
          inventory_behaviour: 'bypass',
          tags: 'VELUNE',
          note: `VELUNE ${order.number}`,
          email: order.customer?.email || '',
          shipping_address: shopifyAddress(order.shipping, order.customer),
          billing_address: shopifyAddress(order.shipping, order.customer)
        }
      }
    });
    if (!data.order?.id) throw new IntegrationError('Shopify accepted the order but returned no order id.');
    return { externalId: String(data.order.id), externalName: data.order.name || `#${data.order.order_number || data.order.id}`, meta: { adminUrl: '' } };
  }
};

function shopifyAddress(shipping = {}, customer = {}) {
  return {
    first_name: customer.firstName || '',
    last_name: customer.lastName || '',
    address1: shipping.address1 || '',
    address2: shipping.address2 || '',
    city: shipping.city || '',
    province: shipping.state || '',
    zip: shipping.zip || '',
    country: shipping.country === 'IN' ? 'India' : 'United States',
    phone: customer.phone || ''
  };
}

// ---------------------------------------------------------------- WooCommerce

function wooRequest(config, suffix, options = {}) {
  const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  return httpJson(joinPath(`${config.siteUrl}/wp-json/wc/v3`, suffix), {
    ...options,
    config,
    label: 'WooCommerce',
    headers: { Authorization: `Basic ${auth}`, ...(options.headers || {}) }
  });
}

const wooAdapter = {
  async test(config) {
    await wooRequest(config, 'products?per_page=1');
    return { message: `Connected to ${config.siteUrl}.`, detail: { siteUrl: config.siteUrl } };
  },
  async importProducts(config) {
    const data = await wooRequest(config, 'products?per_page=100&status=publish');
    if (!Array.isArray(data)) throw new IntegrationError('WooCommerce did not return a product list.');
    return data.map((row) => ({
      externalId: String(row.id),
      externalVariant: '',
      externalSku: String(row.sku || ''),
      name: stripHtml(row.name || ''),
      description: stripHtml(row.description || ''),
      short: stripHtml(row.short_description || '').slice(0, 220),
      price: numeric(row.price),
      cost: null,
      stock: row.manage_stock ? Math.max(0, numeric(row.stock_quantity)) : 0,
      image: safeImage(Array.isArray(row.images) ? row.images[0]?.src : ''),
      categoryHint: Array.isArray(row.categories) ? String(row.categories[0]?.name || '') : '',
      status: String(row.status || 'publish')
    })).filter((row) => row.name && row.externalId);
  },
  async exportProduct(config, product, { price, stock, link = null }) {
    const body = {
      name: String(product.name).slice(0, 200),
      type: 'simple',
      status: 'publish',
      description: `<p>${String(product.description || product.short || product.name)}</p>`,
      short_description: String(product.short || '').slice(0, 300),
      regular_price: Number(price).toFixed(2),
      sku: link?.externalSku || product.slug,
      manage_stock: true,
      stock_quantity: Math.max(0, Number(stock) || 0),
      ...(product.image ? { images: [{ src: product.image }] } : {})
    };
    const data = link?.externalId
      ? await wooRequest(config, `products/${link.externalId}`, { method: 'PUT', body })
      : await wooRequest(config, 'products', { method: 'POST', body });
    if (!data.id) throw new IntegrationError('WooCommerce accepted the request but returned no product id.');
    return { externalId: String(data.id), externalVariant: '', externalSku: data.sku || link?.externalSku || product.slug, meta: { permalink: data.permalink || '' } };
  },
  async pushInventory(config, link, { price, stock }) {
    await wooRequest(config, `products/${link.externalId}`, {
      method: 'PUT',
      body: { regular_price: Number(price).toFixed(2), manage_stock: true, stock_quantity: Math.max(0, Number(stock) || 0) }
    });
    return { updated: ['price', 'stock'], meta: link.meta || {} };
  },
  async pushOrder(config, order, links) {
    const lineItems = [];
    for (const item of order.items || []) {
      const link = links.get(item.slug);
      if (!link?.externalId) continue;
      lineItems.push({ product_id: Number(link.externalId), quantity: Number(item.qty) || 1 });
    }
    if (!lineItems.length) throw new IntegrationError('None of the order lines are linked to a WooCommerce product. Export the products first.');
    const data = await wooRequest(config, 'orders', {
      method: 'POST',
      body: {
        payment_method: 'cod',
        payment_method_title: 'Cash on delivery',
        set_paid: false,
        status: 'processing',
        customer_note: `VELUNE ${order.number}`,
        billing: wooAddress(order.shipping, order.customer),
        shipping: wooAddress(order.shipping, order.customer),
        line_items: lineItems,
        shipping_lines: [{ method_id: order.shippingMethod || 'standard', method_title: order.shippingMethod || 'Standard', total: String(order.shippingCost || 0) }]
      }
    });
    if (!data.id) throw new IntegrationError('WooCommerce accepted the order but returned no order id.');
    return { externalId: String(data.id), externalName: `#${data.number || data.id}`, meta: { status: data.status || '' } };
  }
};

function wooAddress(shipping = {}, customer = {}) {
  return {
    first_name: customer.firstName || '',
    last_name: customer.lastName || '',
    address_1: shipping.address1 || '',
    address_2: shipping.address2 || '',
    city: shipping.city || '',
    state: shipping.state || '',
    postcode: shipping.zip || '',
    country: shipping.country === 'IN' ? 'IN' : 'US',
    phone: customer.phone || '',
    email: customer.email || ''
  };
}

// ---------------------------------------------------------------- generic supplier

function supplierHeaders(config) {
  const prefix = config.authPrefix ?? 'Bearer ';
  return { [config.authHeader || 'Authorization']: `${prefix}${config.apiKey}` };
}

function supplierRequest(config, suffix, options = {}) {
  return httpJson(joinPath(config.baseUrl, suffix), {
    ...options,
    config,
    label: 'Supplier API',
    headers: { ...supplierHeaders(config), ...(options.headers || {}) }
  });
}

function supplierList(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['products', 'data', 'items', 'results']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

const supplierAdapter = {
  async test(config) {
    const data = await supplierRequest(config, config.productsPath);
    const count = supplierList(data).length;
    return { message: `Supplier API responded. ${count} product${count === 1 ? '' : 's'} visible at ${config.productsPath}.`, detail: { path: config.productsPath } };
  },
  async importProducts(config) {
    const data = await supplierRequest(config, config.productsPath);
    return supplierList(data).map((row) => {
      const firstImage = typeof row.image === 'string'
        ? row.image
        : row.image_url || row.thumbnail || (Array.isArray(row.images) ? (typeof row.images[0] === 'string' ? row.images[0] : row.images[0]?.src) : '');
      return {
        externalId: String(row.id ?? row.product_id ?? row.sku ?? ''),
        externalVariant: String(row.variant_id ?? ''),
        externalSku: String(row.sku ?? ''),
        name: stripHtml(row.name ?? row.title ?? row.product_name ?? ''),
        description: stripHtml(row.description ?? row.details ?? ''),
        short: stripHtml(row.short_description ?? row.subtitle ?? '').slice(0, 220),
        price: numeric(row.price ?? row.selling_price ?? row.retail_price),
        cost: Number.isFinite(Number(row.cost ?? row.base_cost ?? row.wholesale_price)) ? Number(row.cost ?? row.base_cost ?? row.wholesale_price) : null,
        stock: Math.max(0, numeric(row.stock ?? row.quantity ?? row.inventory ?? row.stock_quantity)),
        image: safeImage(firstImage),
        categoryHint: String(row.category ?? row.category_name ?? row.collection ?? ''),
        status: String(row.status ?? 'active')
      };
    }).filter((row) => row.name && row.externalId);
  },
  async exportProduct(config, product, { price, stock, link = null }) {
    const data = await supplierRequest(config, config.productsPath, {
      method: 'POST',
      body: {
        sku: link?.externalSku || product.slug,
        name: product.name,
        description: product.description || product.short || product.name,
        price: round2(price),
        stock: Math.max(0, Number(stock) || 0),
        currency: 'USD',
        image: product.image || '',
        external_id: link?.externalId || ''
      }
    });
    const externalId = String(data.id ?? data.product_id ?? data.sku ?? product.slug);
    return { externalId, externalVariant: '', externalSku: data.sku || link?.externalSku || product.slug, meta: { supplierStatus: data.status || '' } };
  },
  async pushInventory(config, link, { price, stock }) {
    await supplierRequest(config, config.stockPath, {
      method: 'POST',
      body: { sku: link.externalSku || link.slug, external_id: link.externalId, price: round2(price), quantity: Math.max(0, Number(stock) || 0) }
    });
    return { updated: ['price', 'stock'], meta: link.meta || {} };
  },
  async pushOrder(config, order, links) {
    const items = (order.items || []).map((item) => {
      const link = links.get(item.slug);
      return {
        sku: link?.externalSku || item.slug,
        external_id: link?.externalId || '',
        name: item.name,
        quantity: Number(item.qty) || 1,
        price: round2(item.price)
      };
    });
    const data = await supplierRequest(config, config.ordersPath, {
      method: 'POST',
      body: {
        reference: order.number,
        created_at: order.createdAt,
        currency: order.currency || 'USD',
        total: order.total,
        payment_method: order.paymentMethod,
        customer: order.customer,
        shipping_address: order.shipping,
        items,
        notes: order.notes || ''
      }
    });
    const externalId = String(data.id ?? data.order_id ?? data.reference ?? order.number);
    return { externalId, externalName: data.number || externalId, meta: { status: data.status || '' } };
  }
};

export const ADAPTERS = {
  shopify: shopifyAdapter,
  woocommerce: wooAdapter,
  supplier: supplierAdapter
};

export function adapterFor(provider) {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new IntegrationError('Unknown provider.', { status: 422 });
  return adapter;
}

export async function testConnection(record) {
  const config = openConfig(record);
  return adapterFor(record.provider).test(config);
}

export async function importChannelProducts(record) {
  const config = openConfig(record);
  return adapterFor(record.provider).importProducts(config);
}

export async function exportChannelProduct(record, product, details) {
  const config = openConfig(record);
  return adapterFor(record.provider).exportProduct(config, product, details);
}

export async function pushChannelInventory(record, link, details) {
  const config = openConfig(record);
  return adapterFor(record.provider).pushInventory(config, link, details);
}

export async function pushChannelOrder(record, order, links) {
  const config = openConfig(record);
  return adapterFor(record.provider).pushOrder(config, order, links);
}

export function describeProviders() {
  return PROVIDER_KEYS.map((key) => ({
    key,
    label: PROVIDERS[key].label,
    blurb: PROVIDERS[key].blurb,
    fields: providerFields(key),
    defaults: { ...PROVIDERS[key].defaults }
  }));
}
