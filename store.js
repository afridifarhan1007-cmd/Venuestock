// ---------------------------------------------------------------- storage layer
// SQLite (node:sqlite) is the source of truth for every collection. The
// legacy data/db.json file is imported once on first start and then never
// written again, so an existing store can be upgraded without losing orders,
// customers or chat history.
//
// The `db` export keeps the array-shaped read API the server already uses
// (db.products.filter(...), db.tickets.find(...)), while every write goes
// through an explicit put*() helper so mutations cannot silently stay in memory.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = __dirname;
const BUNDLED_DATA_DIR = path.join(__dirname, 'data');
// Runtime state (database, private uploads, encryption key) can live on a
// mounted volume via DATA_DIR. Catalogue source files stay with the app, so a
// fresh volume still seeds the 200-product catalogue on first boot.
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : BUNDLED_DATA_DIR;
const bundledFile = (name) => {
  const bundled = path.join(BUNDLED_DATA_DIR, name);
  return fs.existsSync(bundled) ? bundled : path.join(DATA_DIR, name);
};
const DB_JSON_PATH = bundledFile('db.json');
const SEED_PATH = bundledFile('seed.json');
const STORE_PATH = process.env.STORE_DB_PATH || path.join(DATA_DIR, 'velune.db');
const CATALOG_PATH = bundledFile('cosmetics.json');
export const PRIVATE_DIR = path.join(DATA_DIR, 'private');
export const DOCS_DIR = path.join(PRIVATE_DIR, 'documents');
export const PROFILES_DIR = path.join(PRIVATE_DIR, 'profiles');

const now = () => new Date().toISOString();
const json = (value) => (value === undefined ? null : JSON.stringify(value));
const parseJson = (text, fallback) => {
  if (text === null || text === undefined || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
fs.mkdirSync(DOCS_DIR, { recursive: true });
fs.mkdirSync(PROFILES_DIR, { recursive: true });

export const sqlite = new DatabaseSync(STORE_PATH);
sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA foreign_keys = ON');
sqlite.exec('PRAGMA busy_timeout = 5000');

sqlite.exec(`
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  line TEXT,
  image TEXT,
  sort INTEGER
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  base_cost REAL,
  profit REAL,
  price REAL NOT NULL,
  compare_at REAL,
  badge TEXT,
  rating REAL,
  review_count INTEGER,
  stock INTEGER NOT NULL DEFAULT 0,
  featured INTEGER,
  is_new INTEGER,
  short TEXT,
  description TEXT,
  image TEXT,
  details TEXT,
  specs TEXT,
  variants TEXT,
  price_mode TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE TABLE IF NOT EXISTS orders (
  number TEXT PRIMARY KEY,
  id TEXT,
  customer_id TEXT,
  customer_email TEXT,
  status TEXT,
  payment_status TEXT,
  total REAL,
  currency TEXT,
  created_at TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(customer_email);
CREATE TABLE IF NOT EXISTS order_lines (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL,
  product_slug TEXT,
  name TEXT,
  qty INTEGER,
  unit_price REAL,
  unit_cost REAL,
  line_total REAL
);
CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_number);
CREATE INDEX IF NOT EXISTS idx_order_lines_product ON order_lines(product_slug);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT,
  kyc_status TEXT,
  email_verified_at TEXT,
  phone_verified_at TEXT,
  password_hash TEXT,
  session_version INTEGER,
  created_at TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_customers_kyc ON customers(kyc_status);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  name TEXT,
  role TEXT,
  password_hash TEXT,
  active INTEGER,
  created_at TEXT,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  visitor_id TEXT,
  customer_id TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  subject TEXT,
  source TEXT,
  order_number TEXT,
  status TEXT,
  assigned_staff_id TEXT,
  unread_admin INTEGER,
  unread_customer INTEGER,
  created_at TEXT,
  updated_at TEXT,
  last_message_at TEXT,
  admin_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE,
  conversation_id TEXT NOT NULL,
  from_party TEXT,
  sender_name TEXT,
  text TEXT,
  attachment TEXT,
  payment_info TEXT,
  order_number TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, seq);
CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS reseller_inventory (
  customer_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  qty INTEGER,
  updated_at TEXT,
  PRIMARY KEY (customer_id, slug)
);
CREATE TABLE IF NOT EXISTS reseller_stores (
  id TEXT PRIMARY KEY,
  customer_id TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT,
  created_at TEXT,
  updated_at TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_reseller_stores_status ON reseller_stores(status);
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider);
CREATE TABLE IF NOT EXISTS integration_links (
  integration_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  external_id TEXT,
  external_variant TEXT,
  external_sku TEXT,
  meta TEXT,
  synced_at TEXT,
  PRIMARY KEY (integration_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_integration_links_slug ON integration_links(slug);
CREATE TABLE IF NOT EXISTS integration_jobs (
  id TEXT PRIMARY KEY,
  integration_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  detail TEXT,
  created_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_integration_jobs_integration ON integration_jobs(integration_id, created_at);
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  identifier TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_otp_lookup ON otp_codes(purpose, identifier);
CREATE TABLE IF NOT EXISTS verification_documents (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  doc_type TEXT,
  kind TEXT,
  stored_name TEXT NOT NULL,
  mime TEXT,
  bytes INTEGER,
  status TEXT,
  note TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_docs_customer ON verification_documents(customer_id);
CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT,
  to_addr TEXT,
  subject TEXT,
  body TEXT,
  status TEXT,
  error TEXT,
  created_at TEXT
);
`);

// Small column-level migration helper: adding an optional field to a stored
// entity should never require deleting the database.
function ensureColumns(table, additions) {
  const existing = new Set(sqlite.prepare(`SELECT name FROM pragma_table_info(?)`).all(table).map((row) => row.name));
  for (const [name, definition] of Object.entries(additions)) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

ensureColumns('conversations', { message: 'TEXT' });
ensureColumns('reseller_inventory', { price: 'REAL', published: 'INTEGER DEFAULT 0' });

const statement = {
  metaGet: sqlite.prepare('SELECT value FROM meta WHERE key = ?'),
  metaSet: sqlite.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  settingsAll: sqlite.prepare('SELECT key, value FROM settings'),
  settingGet: sqlite.prepare('SELECT value FROM settings WHERE key = ?'),
  settingSet: sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  categoriesAll: sqlite.prepare('SELECT * FROM categories ORDER BY sort, name'),
  categoriesClear: sqlite.prepare('DELETE FROM categories'),
  categorySet: sqlite.prepare('INSERT INTO categories (slug, name, line, image, sort) VALUES (?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET name = excluded.name, line = excluded.line, image = excluded.image, sort = excluded.sort'),
  categoryDelete: sqlite.prepare('DELETE FROM categories WHERE slug = ?'),
  productsAll: sqlite.prepare('SELECT * FROM products ORDER BY rowid'),
  productGet: sqlite.prepare('SELECT * FROM products WHERE slug = ?'),
  productCount: sqlite.prepare('SELECT COUNT(*) AS count FROM products'),
  productSet: sqlite.prepare(`INSERT INTO products (id, slug, name, category, base_cost, profit, price, compare_at, badge,
      rating, review_count, stock, featured, is_new, short, description, image, details, specs, variants, price_mode, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(slug) DO UPDATE SET id = excluded.id, name = excluded.name, category = excluded.category,
      base_cost = excluded.base_cost, profit = excluded.profit, price = excluded.price, compare_at = excluded.compare_at,
      badge = excluded.badge, rating = excluded.rating, review_count = excluded.review_count, stock = excluded.stock,
      featured = excluded.featured, is_new = excluded.is_new, short = excluded.short, description = excluded.description,
      image = excluded.image, details = excluded.details, specs = excluded.specs, variants = excluded.variants,
      price_mode = excluded.price_mode, created_at = excluded.created_at, updated_at = excluded.updated_at`),
  productDelete: sqlite.prepare('DELETE FROM products WHERE slug = ?'),
  ordersAll: sqlite.prepare('SELECT payload FROM orders ORDER BY created_at DESC'),
  orderGet: sqlite.prepare('SELECT payload FROM orders WHERE number = ?'),
  orderSet: sqlite.prepare('INSERT INTO orders (number, id, customer_id, customer_email, status, payment_status, total, currency, created_at, payload) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(number) DO UPDATE SET status = excluded.status, payment_status = excluded.payment_status, total = excluded.total, currency = excluded.currency, customer_id = excluded.customer_id, payload = excluded.payload'),
  orderDeleteLines: sqlite.prepare('DELETE FROM order_lines WHERE order_number = ?'),
  orderLineAdd: sqlite.prepare('INSERT INTO order_lines (order_number, product_slug, name, qty, unit_price, unit_cost, line_total) VALUES (?,?,?,?,?,?,?)'),
  profitRows: sqlite.prepare(`SELECT ol.product_slug, ol.name, ol.qty, ol.unit_price, ol.unit_cost, ol.line_total, o.created_at, o.status
      FROM order_lines ol JOIN orders o ON o.number = ol.order_number`),
  customersAll: sqlite.prepare('SELECT payload FROM customers ORDER BY created_at DESC'),
  customerGet: sqlite.prepare('SELECT payload FROM customers WHERE id = ?'),
  customerByEmail: sqlite.prepare('SELECT payload FROM customers WHERE email = ?'),
  customerSet: sqlite.prepare('INSERT INTO customers (id, email, phone, kyc_status, email_verified_at, phone_verified_at, password_hash, session_version, created_at, payload) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, phone = excluded.phone, kyc_status = excluded.kyc_status, email_verified_at = excluded.email_verified_at, phone_verified_at = excluded.phone_verified_at, password_hash = excluded.password_hash, session_version = excluded.session_version, payload = excluded.payload'),
  customerDelete: sqlite.prepare('DELETE FROM customers WHERE id = ?'),
  staffAll: sqlite.prepare('SELECT payload FROM staff ORDER BY created_at'),
  staffGet: sqlite.prepare('SELECT payload FROM staff WHERE id = ?'),
  staffByUsername: sqlite.prepare('SELECT payload FROM staff WHERE username = ?'),
  staffSet: sqlite.prepare('INSERT INTO staff (id, username, name, role, password_hash, active, created_at, payload) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, name = excluded.name, role = excluded.role, password_hash = excluded.password_hash, active = excluded.active, payload = excluded.payload'),
  staffDelete: sqlite.prepare('DELETE FROM staff WHERE id = ?'),
  conversationsAll: sqlite.prepare('SELECT * FROM conversations ORDER BY created_at DESC'),
  conversationGet: sqlite.prepare('SELECT * FROM conversations WHERE id = ?'),
  conversationsOpen: sqlite.prepare("SELECT * FROM conversations WHERE status = 'open'"),
  conversationsRecent: sqlite.prepare(
    "SELECT * FROM conversations WHERE COALESCE(last_message_at, updated_at, created_at) >= ? ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC"
  ),
  conversationSet: sqlite.prepare(`INSERT INTO conversations (id, visitor_id, customer_id, name, email, phone, subject, source, order_number, status,
      assigned_staff_id, unread_admin, unread_customer, created_at, updated_at, last_message_at, admin_notes, message)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET visitor_id = excluded.visitor_id, customer_id = excluded.customer_id, name = excluded.name,
      email = excluded.email, phone = excluded.phone, subject = excluded.subject, source = excluded.source,
      order_number = excluded.order_number, status = excluded.status, assigned_staff_id = excluded.assigned_staff_id,
      unread_admin = excluded.unread_admin, unread_customer = excluded.unread_customer, updated_at = excluded.updated_at,
      last_message_at = excluded.last_message_at, admin_notes = excluded.admin_notes, message = excluded.message`),
  conversationDelete: sqlite.prepare('DELETE FROM conversations WHERE id = ?'),
  messagesFor: sqlite.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq'),
  messagesAll: sqlite.prepare('SELECT * FROM messages ORDER BY seq'),
  messageGet: sqlite.prepare('SELECT * FROM messages WHERE id = ?'),
  messageSet: sqlite.prepare('INSERT INTO messages (id, conversation_id, from_party, sender_name, text, attachment, payment_info, order_number, created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text = excluded.text, attachment = excluded.attachment, payment_info = excluded.payment_info'),
  messageDelete: sqlite.prepare('DELETE FROM messages WHERE id = ?'),
  messageCount: sqlite.prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?'),
  subscribersAll: sqlite.prepare('SELECT * FROM subscribers ORDER BY created_at DESC'),
  subscriberSet: sqlite.prepare('INSERT INTO subscribers (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING'),
  inventoryAll: sqlite.prepare('SELECT * FROM reseller_inventory'),
  inventoryFor: sqlite.prepare('SELECT * FROM reseller_inventory WHERE customer_id = ?'),
  inventoryGet: sqlite.prepare('SELECT * FROM reseller_inventory WHERE customer_id = ? AND slug = ?'),
  inventorySet: sqlite.prepare('INSERT INTO reseller_inventory (customer_id, slug, qty, price, published, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(customer_id, slug) DO UPDATE SET qty = excluded.qty, price = excluded.price, published = excluded.published, updated_at = excluded.updated_at'),
  inventoryDelete: sqlite.prepare('DELETE FROM reseller_inventory WHERE customer_id = ? AND slug = ?'),
  storesAll: sqlite.prepare('SELECT * FROM reseller_stores ORDER BY created_at DESC'),
  storeGet: sqlite.prepare('SELECT * FROM reseller_stores WHERE id = ?'),
  storeByCustomer: sqlite.prepare('SELECT * FROM reseller_stores WHERE customer_id = ?'),
  storeBySlug: sqlite.prepare('SELECT * FROM reseller_stores WHERE slug = ?'),
  storeSet: sqlite.prepare('INSERT INTO reseller_stores (id, customer_id, slug, status, created_at, updated_at, payload) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, status = excluded.status, updated_at = excluded.updated_at, payload = excluded.payload'),
  storeDelete: sqlite.prepare('DELETE FROM reseller_stores WHERE id = ?'),
  integrationsAll: sqlite.prepare('SELECT * FROM integrations ORDER BY created_at'),
  integrationGet: sqlite.prepare('SELECT * FROM integrations WHERE id = ?'),
  integrationSet: sqlite.prepare(`INSERT INTO integrations (id, provider, name, active, created_at, updated_at, payload)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, name = excluded.name,
      active = excluded.active, updated_at = excluded.updated_at, payload = excluded.payload`),
  integrationDelete: sqlite.prepare('DELETE FROM integrations WHERE id = ?'),
  linksAll: sqlite.prepare('SELECT * FROM integration_links ORDER BY slug'),
  linksForIntegration: sqlite.prepare('SELECT * FROM integration_links WHERE integration_id = ? ORDER BY slug'),
  linksForSlug: sqlite.prepare('SELECT * FROM integration_links WHERE slug = ? ORDER BY integration_id'),
  linkGet: sqlite.prepare('SELECT * FROM integration_links WHERE integration_id = ? AND slug = ?'),
  linkSet: sqlite.prepare(`INSERT INTO integration_links (integration_id, slug, external_id, external_variant, external_sku, meta, synced_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(integration_id, slug) DO UPDATE SET external_id = excluded.external_id,
      external_variant = excluded.external_variant, external_sku = excluded.external_sku,
      meta = excluded.meta, synced_at = excluded.synced_at`),
  linkDelete: sqlite.prepare('DELETE FROM integration_links WHERE integration_id = ? AND slug = ?'),
  linksDeleteForIntegration: sqlite.prepare('DELETE FROM integration_links WHERE integration_id = ?'),
  linksDeleteForSlug: sqlite.prepare('DELETE FROM integration_links WHERE slug = ?'),
  jobsAll: sqlite.prepare('SELECT * FROM integration_jobs ORDER BY created_at DESC LIMIT ?'),
  jobsForIntegration: sqlite.prepare('SELECT * FROM integration_jobs WHERE integration_id = ? ORDER BY created_at DESC LIMIT ?'),
  jobAdd: sqlite.prepare('INSERT INTO integration_jobs (id, integration_id, type, status, message, detail, created_at, finished_at) VALUES (?,?,?,?,?,?,?,?)'),
  jobFinish: sqlite.prepare('UPDATE integration_jobs SET status = ?, message = ?, detail = ?, finished_at = ? WHERE id = ?'),
  jobsDeleteForIntegration: sqlite.prepare('DELETE FROM integration_jobs WHERE integration_id = ?'),
  otpInsert: sqlite.prepare('INSERT INTO otp_codes (id, purpose, identifier, code_hash, expires_at, attempts, consumed_at, created_at) VALUES (?,?,?,?,?,?,?,?)'),
  otpActive: sqlite.prepare('SELECT * FROM otp_codes WHERE purpose = ? AND identifier = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1'),
  otpAttempts: sqlite.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?'),
  otpConsume: sqlite.prepare('UPDATE otp_codes SET consumed_at = ? WHERE id = ?'),
  otpClear: sqlite.prepare('UPDATE otp_codes SET consumed_at = ? WHERE purpose = ? AND identifier = ? AND consumed_at IS NULL'),
  otpPrune: sqlite.prepare('DELETE FROM otp_codes WHERE expires_at < ? OR consumed_at IS NOT NULL'),
  otpCountRecent: sqlite.prepare('SELECT COUNT(*) AS count FROM otp_codes WHERE purpose = ? AND identifier = ? AND created_at > ?'),
  docsForCustomer: sqlite.prepare('SELECT * FROM verification_documents WHERE customer_id = ? ORDER BY created_at'),
  docGet: sqlite.prepare('SELECT * FROM verification_documents WHERE id = ?'),
  docSet: sqlite.prepare(`INSERT INTO verification_documents (id, customer_id, doc_type, kind, stored_name, mime, bytes, status, note, reviewed_by, reviewed_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, note = excluded.note, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at`),
  docDelete: sqlite.prepare('DELETE FROM verification_documents WHERE id = ?'),
  docsPending: sqlite.prepare('SELECT customer_id, COUNT(*) AS count FROM verification_documents WHERE status = ? GROUP BY customer_id'),
  outboxAdd: sqlite.prepare('INSERT INTO outbox (channel, to_addr, subject, body, status, error, created_at) VALUES (?,?,?,?,?,?,?)'),
  outboxList: sqlite.prepare('SELECT * FROM outbox ORDER BY seq DESC LIMIT ?'),
  outboxStatus: sqlite.prepare('UPDATE outbox SET status = ?, error = ? WHERE seq = ?')
};

function transaction(fn) {
  sqlite.exec('BEGIN');
  try {
    const result = fn();
    sqlite.exec('COMMIT');
    return result;
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

// ---------------------------------------------------------------- row mapping

const PRODUCT_COLUMNS = ['id', 'slug', 'name', 'category', 'base_cost', 'profit', 'price', 'compare_at', 'badge',
  'rating', 'review_count', 'stock', 'featured', 'is_new', 'short', 'description', 'image', 'details', 'specs',
  'variants', 'price_mode', 'created_at', 'updated_at'];

function rowToProduct(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    baseCost: row.base_cost === null ? null : row.base_cost,
    profit: row.profit === null ? null : row.profit,
    price: row.price,
    compareAt: row.compare_at,
    badge: row.badge || null,
    rating: row.rating ?? 5,
    reviewCount: row.review_count ?? 0,
    stock: row.stock ?? 0,
    featured: Boolean(row.featured),
    isNew: Boolean(row.is_new),
    short: row.short || '',
    description: row.description || '',
    image: row.image || '',
    details: parseJson(row.details, []),
    specs: parseJson(row.specs, []),
    variants: parseJson(row.variants, []),
    priceMode: row.price_mode || 'manual',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function productToRow(product) {
  return [
    product.id || product.slug,
    product.slug,
    product.name,
    product.category,
    product.baseCost === undefined ? null : product.baseCost,
    product.profit === undefined ? null : product.profit,
    product.price,
    product.compareAt ?? null,
    product.badge || null,
    product.rating ?? 5,
    product.reviewCount ?? 0,
    product.stock ?? 0,
    product.featured ? 1 : 0,
    product.isNew ? 1 : 0,
    product.short || '',
    product.description || '',
    product.image || '',
    json(product.details || []),
    json(product.specs || []),
    json(product.variants || []),
    product.priceMode || 'manual',
    product.createdAt || now(),
    product.updatedAt || now()
  ];
}

function rowToConversation(row, messages) {
  return {
    id: row.id,
    visitorId: row.visitor_id || '',
    customerId: row.customer_id || null,
    name: row.name || '',
    email: row.email || '',
    phone: row.phone || '',
    subject: row.subject || '',
    message: row.message || '',
    source: row.source || '',
    orderNumber: row.order_number || null,
    status: row.status || 'open',
    assignedStaffId: row.assigned_staff_id || null,
    unread: { admin: row.unread_admin || 0, customer: row.unread_customer || 0 },
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    lastMessageAt: row.last_message_at || row.created_at || '',
    adminNotes: row.admin_notes || '',
    thread: messages.map(rowToMessage)
  };
}

function conversationToRow(conversation) {
  return [
    conversation.id,
    conversation.visitorId || '',
    conversation.customerId || null,
    conversation.name || '',
    conversation.email || '',
    conversation.phone || '',
    conversation.subject || '',
    conversation.source || '',
    conversation.orderNumber || null,
    conversation.status || 'open',
    conversation.assignedStaffId || null,
    conversation.unread?.admin || 0,
    conversation.unread?.customer || 0,
    conversation.createdAt || now(),
    conversation.updatedAt || now(),
    conversation.lastMessageAt || conversation.createdAt || now(),
    conversation.adminNotes ?? '',
    conversation.message || ''
  ];
}

function rowToMessage(row) {
  return {
    id: row.id,
    from: row.from_party,
    senderName: row.sender_name || '',
    text: row.text || '',
    attachment: parseJson(row.attachment, null),
    paymentInfo: parseJson(row.payment_info, null),
    orderNumber: row.order_number || undefined,
    at: row.created_at || ''
  };
}

function unwrap(row) {
  return parseJson(row.payload, null);
}

// ---------------------------------------------------------------- one-time import

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function importFrom(sourceName, source) {
  if (!source) return 0;
  let count = 0;
  if (Array.isArray(source.products) && statement.productCount.get().count === 0) {
    transaction(() => {
      for (const product of source.products) {
        statement.productSet.run(...productToRow(normaliseImportedProduct(product)));
        count += 1;
      }
    });
  }
  if (Array.isArray(source.categories) && statement.categoriesAll.all().length === 0) {
    transaction(() => {
      source.categories.forEach((category, index) => {
        statement.categorySet.run(category.slug, category.name, category.line || '', category.image || '', index);
        count += 1;
      });
    });
  }
  if (Array.isArray(source.orders)) {
    transaction(() => {
      for (const order of source.orders) {
        statement.orderSet.run(order.number, order.id || null, order.customerId || null, order.customer?.email || '',
          order.status || '', order.paymentStatus || '', order.total ?? null, order.currency || 'USD',
          order.createdAt || now(), json(order));
        writeOrderLines(order);
        count += 1;
      }
    });
  }
  if (Array.isArray(source.customers)) {
    transaction(() => {
      for (const customer of source.customers) putCustomer(customer, { touch: false });
      count += source.customers.length;
    });
  }
  if (Array.isArray(source.staff)) {
    transaction(() => {
      for (const entry of source.staff) putStaff(entry);
      count += source.staff.length;
    });
  }
  if (Array.isArray(source.tickets)) {
    transaction(() => {
      for (const conversation of source.tickets) {
        statement.conversationSet.run(...conversationToRow(conversation));
        for (const message of Array.isArray(conversation.thread) ? conversation.thread : []) {
          statement.messageSet.run(message.id || `msg_${crypto.randomBytes(6).toString('hex')}`, conversation.id,
            message.from || 'customer', message.senderName || '', message.text || '', json(message.attachment),
            json(message.paymentInfo), message.orderNumber || null, message.at || conversation.createdAt || now());
        }
        count += 1;
      }
    });
  }
  if (Array.isArray(source.subscribers)) {
    transaction(() => {
      for (const entry of source.subscribers) {
        const email = typeof entry === 'string' ? entry : entry.email;
        if (email) statement.subscriberSet.run(email, typeof entry === 'string' ? now() : entry.createdAt || now());
        count += 1;
      }
    });
  }
  if (Array.isArray(source.resellerInventory)) {
    transaction(() => {
      for (const entry of source.resellerInventory) {
        statement.inventorySet.run(entry.customerId, entry.slug, entry.qty ?? 0,
          Number.isFinite(entry.price) ? entry.price : null, entry.published ? 1 : 0, entry.updatedAt || now());
        count += 1;
      }
    });
  }
  if (Array.isArray(source.resellerStores)) {
    transaction(() => {
      for (const entry of source.resellerStores) {
        statement.storeSet.run(entry.id, entry.customerId, entry.slug, entry.status || 'draft',
          entry.createdAt || now(), entry.updatedAt || now(), json(entry));
        count += 1;
      }
    });
  }
  if (source.settings && typeof source.settings === 'object' && statement.metaGet.get('json_import') === undefined) {
    transaction(() => {
      for (const [key, value] of Object.entries(source.settings)) statement.settingSet.run(key, json(value));
    });
  }
  console.log(`[store] imported ${count} records from ${sourceName}`);
  return count;
}

// Legacy products carry no cost fields; they stay manual-priced so profit
// reporting never invents a margin for a product that has no known cost.
function normaliseImportedProduct(product) {
  return {
    ...product,
    baseCost: Number.isFinite(product.baseCost) ? product.baseCost : null,
    profit: Number.isFinite(product.profit) ? product.profit : null,
    priceMode: product.priceMode || 'manual'
  };
}

function writeOrderLines(order) {
  statement.orderDeleteLines.run(order.number);
  const lines = Array.isArray(order.items) ? order.items : Array.isArray(order.lines) ? order.lines : [];
  const gross = lines.reduce((sum, line) => sum + (line.price ?? line.unitPrice ?? 0) * (line.qty || line.quantity || 0), 0);
  const discount = Math.min(Math.max(0, Number(order.discount) || 0), gross);
  const scale = gross > 0 ? (gross - discount) / gross : 1;
  for (const line of lines) {
    const qty = line.qty || line.quantity || 0;
    const unitPrice = line.price ?? line.unitPrice ?? 0;
    // Store the discounted line value so margin reports reflect promos rather
    // than crediting profit that was never collected.
    const lineTotal = line.lineTotal ?? unitPrice * qty;
    statement.orderLineAdd.run(order.number, line.slug || null, line.name || '', qty, unitPrice,
      Number.isFinite(line.unitCost) ? line.unitCost : (Number.isFinite(line.baseCost) ? line.baseCost : null),
      Math.round(lineTotal * scale * 100) / 100);
  }
}

// The beauty lines lead the navigation; anything the owner added earlier is
// pushed below them once, when the catalogue is first installed.
const CATALOG_CATEGORIES = [
  { slug: 'skincare', name: 'Skincare', line: 'Cleansers, serums, barrier care.', sort: 1 },
  { slug: 'makeup', name: 'Makeup', line: 'Complexion, lips, eyes.', sort: 2 },
  { slug: 'haircare', name: 'Haircare', line: 'Scalp first, then length.', sort: 3 },
  { slug: 'perfumes', name: 'Perfumes', line: 'Eau de parfum and roll-on oils.', sort: 4 },
  { slug: 'beauty-accessories', name: 'Beauty Accessories', line: 'Tools that make the routine work.', sort: 5 }
];

// The store now sells cosmetics only. Earlier builds seeded homeware, audio
// and travel goods; remove that demo catalogue once, keeping owner-created or
// beauty categories untouched. Historical orders keep their line records.
const LEGACY_CATALOG_CATEGORIES = ['home', 'audio', 'carry', 'wellness', 'timepieces'];

function pruneLegacyCatalog() {
  if (statement.metaGet.get('legacy_catalog_pruned')) return;
  let removed = 0;
  transaction(() => {
    for (const slug of LEGACY_CATALOG_CATEGORIES) {
      for (const row of statement.productsAll.all()) {
        if (row.category === slug) {
          statement.productDelete.run(row.slug);
          removed += 1;
        }
      }
      statement.categoryDelete.run(slug);
    }
  });
  statement.metaSet.run('legacy_catalog_pruned', json({ at: now(), removed }));
  if (removed) console.log(`[store] removed ${removed} legacy non-cosmetics products`);
}

function bootstrapStore() {
  const legacy = readJsonFile(DB_JSON_PATH);
  const alreadyImported = statement.metaGet.get('json_import');
  if (legacy && !alreadyImported) {
    importFrom('data/db.json', legacy);
    statement.metaSet.run('json_import', json({ at: now(), file: 'data/db.json' }));
  }
  if (statement.productCount.get().count === 0) {
    importFrom('data/seed.json', readJsonFile(SEED_PATH));
  }
  // The beauty catalogue is upserted once per file so an owner's later edits to
  // a SKU are never overwritten by a restart.
  if (fs.existsSync(CATALOG_PATH) && !statement.metaGet.get('catalog_import')) {
    const imported = importCatalogFile(CATALOG_PATH, { categories: CATALOG_CATEGORIES, preserveOwnerImages: true });
    const beautySlugs = new Set(CATALOG_CATEGORIES.map((category) => category.slug));
    for (const row of statement.categoriesAll.all()) {
      if (!beautySlugs.has(row.slug)) statement.categorySet.run(row.slug, row.name, row.line || '', row.image || '', 10 + row.sort);
    }
    statement.metaSet.run('catalog_import', json({ at: now(), file: 'data/cosmetics.json', imported }));
  }
  pruneLegacyCatalog();
}
bootstrapStore();

// Catalog files (data/cosmetics.json) are upserted by slug, so re-running an
// import refreshes copy, prices and stock without duplicating products.
export function importCatalogFile(file, { categories: categoryList = null, preserveOwnerImages = false } = {}) {
  const list = readJsonFile(file);
  if (!Array.isArray(list)) throw new Error(`Catalog file ${file} must contain a JSON array.`);
  let imported = 0;
  transaction(() => {
    if (Array.isArray(categoryList)) {
      categoryList.forEach((category, index) => {
        statement.categorySet.run(category.slug, category.name, category.line || '', category.image || '',
          Number.isFinite(category.sort) ? category.sort : index);
      });
    }
    for (const product of list) {
      const normalised = normaliseImportedProduct(product);
      // A boot-time catalogue sync must never replace an owner's uploaded
      // photo or a custom image URL. Only copy/price/stock fields refresh.
      if (preserveOwnerImages) {
        const existing = statement.productGet.get(normalised.slug);
        if (existing?.image && existing.image !== normalised.image) normalised.image = existing.image;
      }
      statement.productSet.run(...productToRow(normalised));
      imported += 1;
    }
  });
  return imported;
}

// ---------------------------------------------------------------- read facade

let settingsCache = null;

function loadSettings() {
  const output = {};
  for (const row of statement.settingsAll.all()) output[row.key] = parseJson(row.value, null);
  return output;
}

function settingsObject() {
  if (!settingsCache) settingsCache = loadSettings();
  return settingsCache;
}

export const db = {
  get products() {
    return statement.productsAll.all().map(rowToProduct);
  },
  get categories() {
    return statement.categoriesAll.all().map((row) => ({ slug: row.slug, name: row.name, line: row.line || '', image: row.image || '' }));
  },
  get orders() {
    return statement.ordersAll.all().map(unwrap).filter(Boolean);
  },
  get customers() {
    return statement.customersAll.all().map(unwrap).filter(Boolean);
  },
  get staff() {
    return statement.staffAll.all().map(unwrap).filter(Boolean);
  },
  get subscribers() {
    return statement.subscribersAll.all().map((row) => ({ email: row.email, createdAt: row.created_at }));
  },
  get resellerInventory() {
    return statement.inventoryAll.all().map((row) => ({
      customerId: row.customer_id,
      slug: row.slug,
      qty: row.qty,
      price: row.price === null ? null : row.price,
      published: Boolean(row.published),
      updatedAt: row.updated_at
    }));
  },
  get resellerStores() {
    return statement.storesAll.all().map(unwrap).filter(Boolean);
  },
  get integrations() {
    return statement.integrationsAll.all().map(unwrap).filter(Boolean);
  },
  get tickets() {
    const grouped = new Map();
    for (const row of statement.messagesAll.all()) {
      if (!grouped.has(row.conversation_id)) grouped.set(row.conversation_id, []);
      grouped.get(row.conversation_id).push(row);
    }
    return statement.conversationsAll.all().map((row) => rowToConversation(row, grouped.get(row.id) || []));
  },
  get settings() {
    return settingsObject();
  },
  set settings(value) {
    settingsCache = value;
  }
};

// ---------------------------------------------------------------- writes

export function putProduct(product) {
  statement.productSet.run(...productToRow(normaliseImportedProduct(product)));
  return product;
}

export function deleteProduct(slug) {
  statement.productDelete.run(slug);
  statement.linksDeleteForSlug.run(slug);
}

export function putCategory(category, sort = null) {
  const existing = statement.categoriesAll.all();
  const index = existing.findIndex((row) => row.slug === category.slug);
  statement.categorySet.run(category.slug, category.name, category.line || '', category.image || '',
    sort ?? (index >= 0 ? index : existing.length));
  return category;
}

export function deleteCategory(slug) {
  statement.categoryDelete.run(slug);
}

export function replaceCategories(list) {
  transaction(() => {
    statement.categoriesClear.run();
    list.forEach((category, index) => {
      statement.categorySet.run(category.slug, category.name, category.line || '', category.image || '', index);
    });
  });
}

export function putOrder(order) {
  statement.orderSet.run(order.number, order.id || null, order.customerId || null, order.customer?.email || '',
    order.status || '', order.paymentStatus || '', order.total ?? null, order.currency || 'USD',
    order.createdAt || now(), json(order));
  writeOrderLines(order);
  return order;
}

export function putCustomer(customer) {
  statement.customerSet.run(customer.id, (customer.email || '').toLowerCase(), customer.phone || null,
    customer.kycStatus || 'pending', customer.emailVerifiedAt || null, customer.phoneVerifiedAt || null,
    customer.passwordHash || null, Number(customer.sessionVersion) || 1, customer.createdAt || now(), json(customer));
  return customer;
}

export function deleteCustomer(id) {
  statement.customerDelete.run(id);
  transaction(() => {
    for (const row of statement.docsForCustomer.all(id)) statement.docDelete.run(row.id);
  });
}

export function findCustomerByEmail(email) {
  const row = statement.customerByEmail.get(String(email || '').toLowerCase());
  return row ? unwrap(row) : null;
}

export function findCustomerById(id) {
  const row = statement.customerGet.get(id);
  return row ? unwrap(row) : null;
}

export function putStaff(entry) {
  statement.staffSet.run(entry.id, entry.username, entry.name || '', entry.role || 'employee',
    entry.passwordHash || null, entry.active === false ? 0 : 1, entry.createdAt || now(), json(entry));
  return entry;
}

export function deleteStaff(id) {
  statement.staffDelete.run(id);
}

export function findStaffByUsername(username) {
  const row = statement.staffByUsername.get(String(username || '').toLowerCase());
  return row ? unwrap(row) : null;
}

export function findStaffById(id) {
  const row = statement.staffGet.get(id);
  return row ? unwrap(row) : null;
}

export function putConversation(conversation) {
  statement.conversationSet.run(...conversationToRow(conversation));
  return conversation;
}

export function deleteConversation(id) {
  transaction(() => {
    for (const row of statement.messagesFor.all(id)) statement.messageDelete.run(row.id);
    statement.conversationDelete.run(id);
  });
}

export function putMessage(conversationId, message) {
  statement.messageSet.run(message.id, conversationId, message.from || 'customer', message.senderName || '',
    message.text || '', json(message.attachment), json(message.paymentInfo), message.orderNumber || null,
    message.at || now());
  return message;
}

export function messagesFor(conversationId) {
  return statement.messagesFor.all(conversationId).map(rowToMessage);
}

export function conversationAssignee(id) {
  const row = statement.conversationGet.get(id);
  return row ? { assignedStaffId: row.assigned_staff_id || null, status: row.status || 'open' } : null;
}

export function getConversation(id) {
  const row = statement.conversationGet.get(id);
  if (!row) return null;
  return rowToConversation(row, statement.messagesFor.all(id));
}

export function openConversationFor(visitorId, customerId) {
  const rows = statement.conversationsOpen.all();
  const match = rows.filter((row) => (visitorId && row.visitor_id === visitorId) || (customerId && row.customer_id === customerId))
    .sort((left, right) => String(right.last_message_at || '').localeCompare(String(left.last_message_at || '')))[0];
  if (!match) return undefined;
  return rowToConversation(match, statement.messagesFor.all(match.id));
}

// The visitor's own thread, open or resolved: a closed chat must stay readable so
// the answer an agent sent while closing it is not swallowed by the widget.
export function recentConversationFor(visitorId, customerId, sinceIso) {
  const rows = statement.conversationsRecent.all(sinceIso);
  const match = rows.filter((row) => (visitorId && row.visitor_id === visitorId) || (customerId && row.customer_id === customerId))[0];
  if (!match) return undefined;
  return rowToConversation(match, statement.messagesFor.all(match.id));
}

export function unreadTotals() {
  const rows = statement.conversationsOpen.all();
  const perConversation = rows
    .filter((row) => (row.unread_admin || 0) > 0)
    .map((row) => ({ id: row.id, unread: row.unread_admin, name: row.name || '' }));
  return {
    admin: rows.reduce((sum, row) => sum + (row.unread_admin || 0), 0),
    open: rows.length,
    perConversation
  };
}

export function deleteMessage(messageId) {
  const row = statement.messageGet.get(messageId);
  if (row) statement.messageDelete.run(messageId);
  return row ? rowToMessage(row) : null;
}

export function putSubscriber(email) {
  statement.subscriberSet.run(email, now());
}

export function putInventory(entry) {
  statement.inventorySet.run(entry.customerId, entry.slug, entry.qty ?? 0,
    Number.isFinite(entry.price) ? entry.price : null, entry.published ? 1 : 0, entry.updatedAt || now());
}

export function deleteInventory(customerId, slug) {
  statement.inventoryDelete.run(customerId, slug);
}

export function listInventory(customerId) {
  return statement.inventoryFor.all(customerId).map((row) => ({
    customerId: row.customer_id, slug: row.slug, qty: row.qty,
    price: row.price === null ? null : row.price, published: Boolean(row.published), updatedAt: row.updated_at
  }));
}

export function getInventory(customerId, slug) {
  const row = statement.inventoryGet.get(customerId, slug);
  return row ? {
    customerId: row.customer_id, slug: row.slug, qty: row.qty,
    price: row.price === null ? null : row.price, published: Boolean(row.published), updatedAt: row.updated_at
  } : null;
}

export function putStore(store) {
  const timestamp = now();
  const record = { ...store, updatedAt: timestamp, createdAt: store.createdAt || timestamp };
  statement.storeSet.run(record.id, record.customerId, record.slug, record.status || 'draft',
    record.createdAt, record.updatedAt, json(record));
  return record;
}

export function deleteStore(id) {
  statement.storeDelete.run(id);
}

export function listStores() {
  return statement.storesAll.all().map(unwrap).filter(Boolean);
}

export function findStoreBySlug(slug) {
  const row = statement.storeBySlug.get(slug);
  return row ? unwrap(row) : null;
}

export function findStoreForCustomer(customerId) {
  const row = statement.storeByCustomer.get(customerId);
  return row ? unwrap(row) : null;
}

// ---------------------------------------------------------------- integrations

export function listIntegrations() {
  return statement.integrationsAll.all().map(unwrap).filter(Boolean);
}

export function getIntegration(id) {
  const row = statement.integrationGet.get(id);
  return row ? unwrap(row) : null;
}

export function putIntegration(record) {
  const timestamp = now();
  const saved = { ...record, updatedAt: timestamp, createdAt: record.createdAt || timestamp };
  statement.integrationSet.run(saved.id, saved.provider, saved.name, saved.active === false ? 0 : 1,
    saved.createdAt, saved.updatedAt, json(saved));
  return saved;
}

export function deleteIntegration(id) {
  transaction(() => {
    statement.linksDeleteForIntegration.run(id);
    statement.jobsDeleteForIntegration.run(id);
    statement.integrationDelete.run(id);
  });
}

function rowToLink(row) {
  return {
    integrationId: row.integration_id,
    slug: row.slug,
    externalId: row.external_id || '',
    externalVariant: row.external_variant || '',
    externalSku: row.external_sku || '',
    meta: parseJson(row.meta, {}),
    syncedAt: row.synced_at || ''
  };
}

export function listIntegrationLinks(integrationId = null) {
  const rows = integrationId ? statement.linksForIntegration.all(integrationId) : statement.linksAll.all();
  return rows.map(rowToLink);
}

export function getIntegrationLink(integrationId, slug) {
  const row = statement.linkGet.get(integrationId, slug);
  return row ? rowToLink(row) : null;
}

export function linksForSlug(slug) {
  return statement.linksForSlug.all(slug).map(rowToLink);
}

export function putIntegrationLink(link) {
  statement.linkSet.run(link.integrationId, link.slug, link.externalId || null, link.externalVariant || null,
    link.externalSku || null, json(link.meta || {}), link.syncedAt || now());
  return link;
}

export function deleteIntegrationLink(integrationId, slug) {
  statement.linkDelete.run(integrationId, slug);
}

function rowToJob(row) {
  return {
    id: row.id,
    integrationId: row.integration_id || '',
    type: row.type || '',
    status: row.status || '',
    message: row.message || '',
    detail: parseJson(row.detail, null),
    createdAt: row.created_at || '',
    finishedAt: row.finished_at || ''
  };
}

export function addIntegrationJob(entry) {
  const job = {
    id: entry.id || `job_${crypto.randomBytes(8).toString('hex')}`,
    integrationId: entry.integrationId || null,
    type: entry.type,
    status: entry.status || 'running',
    message: entry.message || '',
    detail: entry.detail ?? null,
    createdAt: entry.createdAt || now(),
    finishedAt: entry.finishedAt || null
  };
  statement.jobAdd.run(job.id, job.integrationId, job.type, job.status, job.message,
    json(job.detail), job.createdAt, job.finishedAt);
  return job;
}

export function finishIntegrationJob(id, { status, message = '', detail = null }) {
  statement.jobFinish.run(status, message, json(detail), now(), id);
}

export function listIntegrationJobs({ integrationId = null, limit = 50 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = integrationId
    ? statement.jobsForIntegration.all(integrationId, capped)
    : statement.jobsAll.all(capped);
  return rows.map(rowToJob);
}

export function setSetting(key, value) {
  statement.settingSet.run(key, json(value));
  settingsObject()[key] = value;
}

// Flush the in-memory settings object into the settings table. Existing server
// code calls persist() after touching db.settings, and this keeps that working.
export async function persist() {
  const values = settingsObject();
  transaction(() => {
    for (const [key, value] of Object.entries(values)) statement.settingSet.run(key, json(value));
  });
}

export function reloadSettings() {
  settingsCache = loadSettings();
  return settingsCache;
}

// ---------------------------------------------------------------- verification codes

export function hashOtp(identifier, code) {
  return crypto.createHash('sha256').update(`${identifier}:${code}`).digest('hex');
}

export function createOtp({ purpose, identifier, code, ttlMs }) {
  transaction(() => {
    statement.otpClear.run(now(), purpose, identifier);
    statement.otpInsert.run(`otp_${crypto.randomBytes(8).toString('hex')}`, purpose, identifier,
      hashOtp(identifier, code), Date.now() + ttlMs, 0, null, now());
  });
}

export function activeOtp(purpose, identifier) {
  return statement.otpActive.get(purpose, identifier) || null;
}

export function registerOtpAttempt(id) {
  statement.otpAttempts.run(id);
}

export function consumeOtp(id) {
  statement.otpConsume.run(now(), id);
}

export function recentOtpCount(purpose, identifier, windowMs) {
  return statement.otpCountRecent.get(purpose, identifier, new Date(Date.now() - windowMs).toISOString()).count;
}

export function pruneOtps() {
  statement.otpPrune.run(Date.now());
}

// ---------------------------------------------------------------- identity documents

const DOC_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

export function privateDirectoryFor(kind) {
  return kind === 'profile' ? PROFILES_DIR : DOCS_DIR;
}

// Identity documents are written outside the web root and never served
// statically; only the admin document endpoint can stream them back.
export async function writePrivateFile(buffer, { kind, prefix = 'doc', mime }) {
  const directory = privateDirectoryFor(kind);
  await fsp.mkdir(directory, { recursive: true });
  const extension = DOC_EXTENSIONS[mime] || 'bin';
  const storedName = `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.${extension}`;
  await fsp.writeFile(path.join(directory, storedName), buffer);
  return storedName;
}

export function resolvePrivatePath(storedName) {
  const safe = String(storedName || '');
  if (!safe || safe.includes('/') || safe.includes('\\') || safe.includes('..')) return null;
  for (const directory of [DOCS_DIR, PROFILES_DIR]) {
    const candidate = path.join(directory, safe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function deletePrivateFile(storedName) {
  const filePath = resolvePrivatePath(storedName);
  if (filePath) fsp.unlink(filePath).catch(() => {});
}

export function putDocument(document) {
  statement.docSet.run(document.id, document.customerId, document.docType || null, document.kind || 'front',
    document.storedName, document.mime || null, document.bytes || 0, document.status || 'pending',
    document.note || null, document.reviewedBy || null, document.reviewedAt || null, document.createdAt || now());
  return document;
}

export function documentsFor(customerId) {
  return statement.docsForCustomer.all(customerId).map(rowToDocument);
}

export function getDocument(id) {
  const row = statement.docGet.get(id);
  return row ? rowToDocument(row) : null;
}

export function deleteDocument(id) {
  const row = statement.docGet.get(id);
  statement.docDelete.run(id);
  if (row) {
    const filePath = resolvePrivatePath(row.stored_name);
    if (filePath) fsp.unlink(filePath).catch(() => {});
  }
}

function rowToDocument(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    docType: row.doc_type || '',
    kind: row.kind || 'front',
    storedName: row.stored_name,
    mime: row.mime || '',
    bytes: row.bytes || 0,
    status: row.status || 'pending',
    note: row.note || '',
    reviewedBy: row.reviewed_by || '',
    reviewedAt: row.reviewed_at || '',
    createdAt: row.created_at || ''
  };
}

// ---------------------------------------------------------------- reports

export function profitReport({ from = null, to = null } = {}) {
  const rows = statement.profitRows.all()
    .filter((row) => row.status !== 'Cancelled')
    .filter((row) => (!from || row.created_at >= from) && (!to || row.created_at <= to));
  const totals = { revenue: 0, cost: 0, profit: 0, units: 0, trackedRevenue: 0, untrackedRevenue: 0, untrackedUnits: 0 };
  const byProduct = new Map();
  for (const row of rows) {
    const qty = row.qty || 0;
    const unitPrice = row.unit_price || 0;
    const lineTotal = row.line_total ?? unitPrice * qty;
    totals.revenue += lineTotal;
    totals.units += qty;
    if (Number.isFinite(row.unit_cost)) {
      const cost = row.unit_cost * qty;
      totals.cost += cost;
      totals.profit += lineTotal - cost;
      totals.trackedRevenue += lineTotal;
    } else {
      totals.untrackedRevenue += lineTotal;
      totals.untrackedUnits += qty;
    }
    const key = row.product_slug || row.name || 'unknown';
    const bucket = byProduct.get(key) || { slug: row.product_slug || '', name: row.name || '', units: 0, revenue: 0, cost: 0, profit: 0, tracked: Number.isFinite(row.unit_cost) };
    bucket.units += qty;
    bucket.revenue += lineTotal;
    if (Number.isFinite(row.unit_cost)) {
      bucket.cost += row.unit_cost * qty;
      bucket.profit += lineTotal - row.unit_cost * qty;
    } else {
      bucket.tracked = false;
    }
    byProduct.set(key, bucket);
  }
  return { totals, products: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue) };
}

// ---------------------------------------------------------------- dev outbox

export function pushOutbox({ channel, to, subject, body }) {
  const info = statement.outboxAdd.run(channel, to, subject, body, 'queued', null, now());
  return Number(info.lastInsertRowid);
}

export function markOutbox(seq, status, error = '') {
  statement.outboxStatus.run(status, error || null, seq);
}

export function listOutbox(limit = 40) {
  return statement.outboxList.all(limit).map((row) => ({
    seq: row.seq, channel: row.channel, to: row.to_addr, subject: row.subject || '',
    body: row.body || '', status: row.status, error: row.error || '', createdAt: row.created_at
  }));
}

export function statementFor(name) {
  return statement[name] || null;
}

export const storeStatements = statement;
