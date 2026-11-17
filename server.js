import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import * as channels from './integrations.js';
import { deliveryMode, sendVerificationEmail, sendVerificationSms, verificationOtpText } from './notify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const VIEWS_DIR = path.join(__dirname, 'views');
const DEFAULT_UPLOADS_DIR = path.join(PUBLIC_DIR, 'images', 'uploads');
// Uploaded product images and chat attachments belong on the persistent
// volume in production (UPLOADS_DIR), not in the deploy directory.
const UPLOADS_DIR = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : DEFAULT_UPLOADS_DIR;
const UPLOADS_URL_PREFIX = '/images/uploads/';
const PROOFS_DIR = path.join(UPLOADS_DIR, 'proofs');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_SECRET = process.env.ADMIN_SECRET || crypto.randomBytes(32).toString('hex');
const IS_PROD = process.env.NODE_ENV === 'production';
// Only honour X-Forwarded-For when the app really sits behind a trusted proxy;
// otherwise any client could forge its address and dodge the rate limiter.
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const SESSION_COOKIE = 'velune_session';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const SSE_TICKET_TTL = 12 * 60 * 60 * 1000;
const CHAT_TEXT_MAX = 2000;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const scryptAsync = promisify(crypto.scrypt);

const FREE_SHIPPING_THRESHOLD = 150;
const SHIPPING_METHODS = {
  standard: { label: 'Standard', price: 8, eta: '3–5 business days' },
  express: { label: 'Express', price: 18, eta: '1–2 business days' }
};
const PROMOS = {
  WELCOME10: { type: 'percent', value: 10, label: '10% off' },
  FREESHIP: { type: 'shipping', value: 100, label: 'Free standard shipping' }
};
const ORDER_STATUSES = ['Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];
const PAYMENT_STATUSES = [
  'Awaiting Payment',
  'Proof submitted',
  'Paid',
  'Refunded',
  'Payment on delivery',
  'Cancelled — no payment due'
];
const PAYMENT_METHODS = ['Bank Transfer', 'UPI', 'Binance Pay', 'Crypto', 'Cash on delivery'];
const COD_METHODS = new Set(['Cash on delivery']);
const PROOF_STATUSES = ['pending', 'accepted', 'rejected'];

const US_STATES = new Set(('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY').split(' '));

// Compared lower-case so "Telangana", "telangana" and "TE LANGANA " all match.
const IN_STATES = new Set([
  'andaman and nicobar islands', 'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar',
  'chandigarh', 'chhattisgarh', 'dadra and nagar haveli', 'daman and diu', 'delhi',
  'goa', 'gujarat', 'haryana', 'himachal pradesh', 'jammu and kashmir', 'jharkhand',
  'karnataka', 'kerala', 'ladakh', 'laccadives', 'madhya pradesh', 'maharashtra',
  'manipur', 'meghalaya', 'mizoram', 'nagaland', 'odisha', 'puducherry', 'punjab',
  'rajasthan', 'sikkim', 'tamil nadu', 'telangana', 'tripura', 'uttar pradesh',
  'uttarakhand', 'west bengal'
].map((name) => name.toLowerCase()));

const IN_STATE_LABELS = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli', 'Daman and Diu', 'Delhi',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand',
  'Karnataka', 'Kerala', 'Ladakh', 'Laccadives', 'Madhya Pradesh', 'Maharashtra',
  'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal'
];

// ---------------------------------------------------------------- data layer

function defaultPayments() {
  return {
    methods: {
      bank: {
        enabled: true,
        label: 'Bank Transfer',
        note: 'We dispatch once the transfer lands in our account.',
        fields: [
          { key: 'accountName', label: 'Account name', value: '' },
          { key: 'accountNumber', label: 'Account number', value: '', required: true },
          { key: 'bankName', label: 'Bank', value: '' }
        ]
      },
      upi: {
        enabled: true,
        label: 'UPI',
        note: 'Pay from any UPI app, then send us the payment reference or upload the slip.',
        fields: [
          { key: 'vpa', label: 'UPI ID', value: '', required: true },
          { key: 'appName', label: 'Registered name', value: '' }
        ]
      },
      binance: {
        enabled: true,
        label: 'Binance Pay',
        note: 'Open Binance Pay, scan the QR or use the Pay ID, then upload the receipt.',
        fields: [
          { key: 'payId', label: 'Pay ID', value: '', required: true },
          { key: 'userId', label: 'User ID', value: '' }
        ]
      },
      crypto: {
        enabled: true,
        label: 'Crypto',
        note: 'Double-check the network before sending. Wrong-network transfers cannot be recovered.',
        fields: [
          { key: 'asset', label: 'Coin', value: 'USDT' },
          { key: 'network', label: 'Network', value: 'TRC20' },
          { key: 'address', label: 'Wallet address', value: '', required: true }
        ]
      },
      cod: {
        enabled: true,
        label: 'Cash on Delivery',
        note: 'Pay the courier when your order arrives.',
        fields: []
      }
    },
    instructions: 'After paying, upload your payment slip or screenshot in the chat or on your order page. We confirm during business hours.',
    updatedAt: ''
  };
}

function defaultSettings() {
  return {
    supportEmail: 'support@velune.store',
    whatsapp: '',
    telegram: '',
    hours: 'Monday–Friday, 9am–5pm Pacific',
    responseTime: 'within one business day',
    announcement: 'Complimentary U.S. shipping over $150 · 30-day returns',
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    payments: defaultPayments(),
    // Operating costs are tracked apart from product margin so profit reports
    // can show both gross and net figures.
    expenses: [],
    updatedAt: new Date().toISOString()
  };
}

function defaultCurrency() {
  return {
    base: 'USD',
    display: 'USD',
    inrPerUsd: 83.2,
    symbolUsd: '$',
    symbolInr: '₹',
    updatedAt: ''
  };
}

// KYC gating. `mode: otp` verifies email and mobile only; `otp+documents`
// additionally requires an administrator to approve an uploaded identity
// document before protected features (wholesale pricing, reseller stock)
// unlock. Aadhaar images are never mandatory or publicly addressable.
function defaultKyc() {
  return {
    mode: 'otp+documents',
    requireDocumentsForReseller: true,
    acceptedDocTypes: ['aadhaar', 'passport', 'driving-licence', 'voter-id'],
    protectedFeatures: ['wholesale', 'reseller'],
    retentionDays: 180,
    updatedAt: ''
  };
}

// Default cost-plus pricing from the owner's brief: $46 cost + $6 profit.
const DEFAULT_BASE_COST = Number(process.env.DEFAULT_BASE_COST) || 46;
const DEFAULT_PROFIT = Number(process.env.DEFAULT_PROFIT) || 6;

// The SQLite layer owns persistence. Reads keep the familiar db.<collection>
// shape; writes go through the put*/delete* helpers below.
const db = store.db;
const messagesFor = store.messagesFor;

// Settings are stored as one row per key. Filling only missing keys lets an
// older database gain new settings without dropping what the owner typed.
function ensureDbDefaults() {
  const settings = db.settings;
  const defaults = defaultSettings();
  for (const [key, value] of Object.entries(defaults)) {
    if (key === 'payments') continue;
    if (settings[key] === undefined || settings[key] === null) settings[key] = value;
  }
  if (!settings.sessionSecret) settings.sessionSecret = defaults.sessionSecret;
  if (!settings.supportEmail) settings.supportEmail = defaults.supportEmail;
  if (!settings.announcement) settings.announcement = defaults.announcement;
  if (!settings.hours) settings.hours = defaults.hours;
  if (!settings.responseTime) settings.responseTime = defaults.responseTime;
  if (!settings.adminUsername) settings.adminUsername = ADMIN_USERNAME;
  if (!settings.currency) settings.currency = defaultCurrency();
  if (!settings.kyc) settings.kyc = defaultKyc();
  ensurePayments();
}

// Payment channels are stored per method with a keyed field list, so an old
// database gains new methods or fields without dropping what the owner typed.
function ensurePayments() {
  const template = defaultPayments();
  const stored = db.settings.payments;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) db.settings.payments = template;
  const payments = db.settings.payments;
  if (!payments.methods || typeof payments.methods !== 'object') payments.methods = {};
  for (const [key, method] of Object.entries(template.methods)) {
    const entry = payments.methods[key];
    if (!entry || typeof entry !== 'object') {
      payments.methods[key] = method;
      continue;
    }
    if (typeof entry.enabled !== 'boolean') entry.enabled = false;
    if (typeof entry.label !== 'string') entry.label = method.label;
    if (typeof entry.note !== 'string') entry.note = method.note;
    if (!Array.isArray(entry.fields)) entry.fields = [];
    if (typeof entry.qr !== 'string') entry.qr = '';
    // Rebuild the field list from the template so upgrades can add a field or
    // restate which value a channel needs before it can be offered, while
    // keeping whatever the owner already typed.
    const storedValues = new Map(entry.fields.map((field) => [field.key, field.value]));
    entry.fields = method.fields.map((field) => ({
      ...field,
      value: typeof storedValues.get(field.key) === 'string' ? storedValues.get(field.key) : field.value
    }));
  }
  if (typeof payments.instructions !== 'string') payments.instructions = template.instructions;
}

// Resolve the admin password hash: env overrides win, then the stored hash.
// On a brand-new database with no env override, generate a one-time password,
// store only its hash, and print it once so the owner can sign in and change it.
async function ensureAdminCredentials() {
  if (process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD) return;
  if (db.settings.adminPasswordHash) return;
  const generated = crypto.randomBytes(9).toString('base64url');
  db.settings.adminPasswordHash = await hashPassword(generated);
  db.settings.updatedAt = new Date().toISOString();
  await persist();
  console.log(`\n  One-time admin password generated: ${generated}`);
  console.log('  Sign in at /admin and save this password somewhere safe. It will not be shown again.\n');
}
ensureDbDefaults();

// persist() flushes the settings cache into SQLite. Collection rows are
// written immediately by their put*/delete* helpers, so nothing else to do.
async function persist() {
  await store.persist();
}

await persist();

// ---------------------------------------------------------------- helpers

const now = () => new Date().toISOString();
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const clampStr = (value, max) => String(value ?? '').trim().slice(0, max);
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
const slugify = (value) =>
  String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

const htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => htmlEscapes[char]);

class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function httpError(status, message, code) {
  return new HttpError(status, message, code);
}

function baseUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${proto}://${req.headers.host || `localhost:${PORT}`}`;
}

// ---------------------------------------------------------------- HTTP utils

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

function requestIsHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || String(process.env.SITE_URL || '').startsWith('https://');
}

function directoryWritable(directory) {
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.accessSync(directory, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// Liveness plus the checks that actually break a launch: the database answers
// and the persistent volume accepts writes.
function healthReport() {
  const checks = {
    database: 'ok',
    uploads: directoryWritable(UPLOADS_DIR) ? 'ok' : 'unwritable',
    privateFiles: directoryWritable(store.PRIVATE_DIR) ? 'ok' : 'unwritable'
  };
  try {
    store.sqlite.prepare('SELECT 1 AS ok').get();
  } catch {
    checks.database = 'unavailable';
  }
  return {
    ok: Object.values(checks).every((status) => status === 'ok'),
    uptime: Math.round(process.uptime()),
    orders: db.orders.length,
    products: db.products.length,
    checks
  };
}

function securityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // Identity documents and profile pictures are streamed with an admin/session
  // header, so the browser can only show them through a same-origin blob: URL.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Only advertise HSTS once the origin is actually served over HTTPS, so a
  // plain-http preview can never pin a browser to a broken scheme.
  if (IS_PROD || requestIsHttps(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('X-Request-Id', crypto.randomUUID());
}

function encodeBody(res, body, headers) {
  // 200+ products make the catalogue JSON worth compressing; browsers and the
  // storefront fetch both advertise support, and the payload shrinks ~6x.
  const acceptsGzip = res.acceptsGzip === true && Buffer.byteLength(body) > 2048;
  if (!acceptsGzip) return { payload: Buffer.from(body), headers };
  try {
    return { payload: zlib.gzipSync(Buffer.from(body)), headers: { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } };
  } catch {
    return { payload: Buffer.from(body), headers };
  }
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  const { payload: out, headers: withEncoding } = encodeBody(res, body, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.writeHead(status, { ...withEncoding, 'Content-Length': out.length });
  res.end(out);
}

function sendText(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  const { payload: out, headers: withEncoding } = encodeBody(res, body, { 'Content-Type': type, ...headers });
  res.writeHead(status, { ...withEncoding, 'Content-Length': out.length });
  res.end(out);
}

function sendHtml(res, status, body, cache = 'no-cache') {
  const { payload: out, headers: withEncoding } = encodeBody(res, body, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': cache
  });
  res.writeHead(status, { ...withEncoding, 'Content-Length': out.length });
  res.end(out);
}

const PRIVATE_FILE_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

// Identity documents and profile pictures live below data/private and are
// streamed only here, never cached, with a sandboxed response so a crafted
// PDF or SVG can never execute in the admin's session.
async function streamPrivateFile(res, storedName) {
  const filePath = store.resolvePrivatePath(storedName);
  if (!filePath) throw httpError(404, 'That file is no longer stored.');
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const mime = PRIVATE_FILE_MIME[extension] || 'application/octet-stream';
  const buffer = await fsp.readFile(filePath);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store, private, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; sandbox",
    'Content-Disposition': `${mime === 'application/pdf' ? 'attachment' : 'inline'}; filename="velune-${extension}"`,
    'Referrer-Policy': 'no-referrer'
  });
  res.end(buffer);
}

async function streamPrivateDocument(res, documentId, ownerId = null) {
  const document = store.getDocument(documentId);
  if (!document) throw httpError(404, 'Document not found.');
  if (ownerId && document.customerId !== ownerId) throw httpError(404, 'Document not found.');
  return streamPrivateFile(res, document.storedName);
}

async function readJson(req, limit = 1_000_000) {
  const type = req.headers['content-type'] || '';
  if (!type.includes('application/json')) throw httpError(415, 'Content-Type must be application/json');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'Invalid JSON body');
  }
}

const rateBuckets = new Map();
// The test harness drives many journeys from one loopback address and turns the
// limiter off explicitly; every other environment keeps the production limits.
const RATE_LIMITS_DISABLED = String(process.env.RATE_LIMIT_DISABLED) === 'true';

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

function rateLimit(req, bucket, limit, windowMs) {
  if (RATE_LIMITS_DISABLED) return;
  const ip = clientIp(req);
  const key = `${bucket}:${ip}`;
  const time = Date.now();
  let entry = rateBuckets.get(key);
  if (!entry || entry.resetAt <= time) {
    entry = { count: 0, resetAt: time + windowMs };
    rateBuckets.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > limit) {
    const retry = Math.ceil((entry.resetAt - time) / 1000);
    throw httpError(429, `Too many requests. Try again in ${retry}s.`);
  }
}
setInterval(() => {
  const time = Date.now();
  for (const [key, entry] of rateBuckets) if (entry.resetAt <= time) rateBuckets.delete(key);
}, 60_000).unref();

// ---------------------------------------------------------------- auth

// Employees default to the support desk only. Each permission is granted
// explicitly by an administrator, so a new account can never reach settings,
// products or customer records by accident.
const STAFF_PERMISSIONS = ['chat', 'tickets', 'upload', 'moderate', 'products', 'inventory', 'customers', 'verification', 'reports', 'staff'];

function defaultStaffPermissions(input = null, existing = null) {
  const permissions = {};
  for (const key of STAFF_PERMISSIONS) {
    const value = input?.[key] ?? existing?.[key];
    permissions[key] = key === 'chat' || key === 'tickets' || key === 'upload' ? value !== false : value === true;
  }
  return permissions;
}

function publicStaff(staff) {
  return {
    id: staff.id,
    username: staff.username,
    name: staff.name,
    role: staff.role,
    active: staff.active !== false,
    permissions: staff.permissions || defaultStaffPermissions(),
    chatScope: staff.chatScope === 'assigned' ? 'assigned' : 'all',
    createdAt: staff.createdAt || ''
  };
}

function signStaffToken(staff) {
  const expires = Date.now() + 12 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({
    id: staff.id,
    username: staff.username,
    name: staff.name,
    role: staff.role,
    expires
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function verifyStaffToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !/^[a-f0-9]{64}$/.test(signature || '')) return null;
  const expected = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return null;
    const staff = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!staff?.id || !['admin', 'employee'].includes(staff.role) || Number(staff.expires) < Date.now()) return null;
    if (staff.role === 'employee') {
      const current = db.staff.find((entry) => entry.id === staff.id && entry.active !== false);
      if (!current) return null;
      return publicStaff(current);
    }
    return publicStaff(staff);
  } catch {
    return null;
  }
}

function requireStaff(req) {
  const direct = req.headers['x-velune-admin'] || '';
  const header = req.headers.authorization || '';
  const token = direct || (header.startsWith('Bearer ') ? header.slice(7) : '');
  const staff = verifyStaffToken(token);
  if (!staff) throw httpError(401, 'Staff session expired. Sign in again.');
  return staff;
}

function requireAdminRole(req) {
  const staff = req.staff || requireStaff(req);
  if (staff.role !== 'admin') throw httpError(403, 'Only an administrator can do that.');
  return staff;
}

function employeeCanAccess(method, pathname, staff) {
  if (pathname === '/api/admin/session') return true;
  const permissions = staff?.permissions || defaultStaffPermissions();
  if (pathname.startsWith('/api/admin/chat') || pathname.startsWith('/api/admin/tickets')) {
    return permissions.chat === true || permissions.tickets === true;
  }
  if (method === 'POST' && pathname === '/api/admin/uploads') return permissions.upload === true;
  if (pathname.startsWith('/api/admin/products') || pathname.startsWith('/api/admin/categories')) return permissions.products === true;
  if (pathname.startsWith('/api/admin/inventory')) return permissions.inventory === true;
  if (pathname.startsWith('/api/admin/customers') || pathname.startsWith('/api/admin/verification')) return permissions.customers === true;
  if (pathname.startsWith('/api/admin/reports')) return permissions.reports === true;
  if (pathname.startsWith('/api/admin/staff')) return false;
  if (pathname.startsWith('/api/admin/integrations')) return false;
  if (method === 'GET') {
    return permissions.reports === true || permissions.customers === true || permissions.products === true;
  }
  return false;
}

// Conversations a member of staff may see: admins and unrestricted agents see
// the whole inbox, scoped agents only their own or unclaimed threads.
function visibleConversations(staff) {
  const all = db.tickets;
  if (!staff || staff.role === 'admin') return all;
  if ((staff.chatScope || 'all') === 'all') return all;
  return all.filter((conversation) => !conversation.assignedStaffId || conversation.assignedStaffId === staff.id);
}

function requireConversationScope(staff, conversation) {
  if (!staff || staff.role === 'admin') return;
  if ((staff.chatScope || 'all') === 'all') return;
  if (!conversation.assignedStaffId || conversation.assignedStaffId === staff.id) return;
  throw httpError(403, 'This conversation is assigned to another agent.');
}

function requireMessageModeration(staff) {
  if (staff.role === 'admin') return;
  if (staff.permissions?.moderate === true || staff.permissions?.chat === true) return;
  throw httpError(403, 'Your account cannot delete messages.');
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw httpError(403, 'Request origin is not allowed.');
  }
  const forwarded = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const requestHost = forwarded || req.headers.host || '';
  let siteHost = '';
  try {
    siteHost = process.env.SITE_URL ? new URL(process.env.SITE_URL).host : '';
  } catch {
    siteHost = '';
  }
  if (originHost !== requestHost && (!siteHost || originHost !== siteHost)) {
    throw httpError(403, 'Request origin is not allowed.');
  }
}

// ---------------------------------------------------------------- customer auth

const sessionSecret = () => process.env.SESSION_SECRET || db.settings.sessionSecret;

function parseCookies(req) {
  const output = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (!key) continue;
    try {
      output[key] = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      output[key] = '';
    }
  }
  return output;
}

function customerCookie(req, token, maxAgeMs) {
  const secure = IS_PROD || requestIsHttps(req);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
    maxAgeMs / 1000
  )}${secure ? '; Secure' : ''}`;
}

function signCustomerToken(customer) {
  const expires = Date.now() + SESSION_TTL;
  const version = Number(customer.sessionVersion) || 1;
  const payload = `${customer.id}.${version}.${expires}`;
  const signature = crypto.createHmac('sha256', sessionSecret()).update(`customer:${payload}`).digest('hex');
  return `${payload}.${signature}`;
}

function verifyCustomerToken(token) {
  if (typeof token !== 'string') return null;
  const match = token.match(/^(cust_[a-f0-9]{16})\.(\d+)\.(\d{13})\.([a-f0-9]{64})$/);
  if (!match) return null;
  const [, id, version, expires, signature] = match;
  if (Number(expires) < Date.now()) return null;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(`customer:${id}.${version}.${expires}`).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch {
    return null;
  }
  const customer = db.customers.find((entry) => entry.id === id);
  if (!customer || (Number(customer.sessionVersion) || 1) !== Number(version)) return null;
  return customer;
}

function currentCustomer(req) {
  const headerToken = req.headers['x-velune-customer'];
  return verifyCustomerToken(headerToken || parseCookies(req)[SESSION_COOKIE]);
}

function requireCustomer(req) {
  const customer = currentCustomer(req);
  if (!customer) throw httpError(401, 'Please sign in to continue.');
  return customer;
}

// ---------------------------------------------------------------- verification (KYC)

const KYC_STATUSES = ['unverified', 'pending', 'approved', 'rejected'];

function kycConfig() {
  const stored = db.settings.kyc;
  const cfg = { ...defaultKyc(), ...(stored && typeof stored === 'object' ? stored : {}) };
  if (!KYC_STATUSES.includes(cfg.mode === 'otp' ? 'unverified' : 'pending')) cfg.mode = 'otp+documents';
  if (!['otp', 'otp+documents'].includes(cfg.mode)) cfg.mode = 'otp+documents';
  if (!Array.isArray(cfg.acceptedDocTypes) || !cfg.acceptedDocTypes.length) cfg.acceptedDocTypes = defaultKyc().acceptedDocTypes;
  return cfg;
}

// A channel counts as ready when real provider credentials are present, or
// when the owner explicitly asks for verification to be enforced while codes
// are still being relayed by hand from the admin Delivery panel.
function otpChannelsReady() {
  return deliveryMode().live === true || String(process.env.OTP_ENFORCE) === 'true';
}

// Contact channels are verified by OTP; identity documents by an
// administrator. Rejected accounts can resubmit once the reason is fixed.
function verificationState(customer) {
  const cfg = kycConfig();
  const emailVerified = Boolean(customer?.emailVerifiedAt);
  const phoneVerified = Boolean(customer?.phoneVerifiedAt);
  const documents = customer ? store.documentsFor(customer.id) : [];
  const approvedDocs = documents.filter((document) => document.status === 'accepted');
  const docsApproved = approvedDocs.length > 0;
  return {
    emailVerified,
    phoneVerified,
    contactsVerified: emailVerified && phoneVerified,
    documents,
    docsApproved,
    docsPending: documents.some((document) => document.status === 'pending'),
    docsRejected: documents.some((document) => document.status === 'rejected'),
    status: customer?.kycStatus || 'unverified',
    mode: cfg.mode,
    requireDocumentsForReseller: cfg.requireDocumentsForReseller !== false
  };
}

// Protected features unlock only when the checks that apply have passed.
// Retail checkout needs verified contact details; reseller/wholesale also
// needs an approved identity document when documents are enabled.
function canUseFeature(customer, feature) {
  if (!customer) return false;
  if (!verificationRequired(customer)) return true;
  const state = verificationState(customer);
  // Contact checks always apply, even to accounts an administrator approved:
  // changing a verified number must lock checkout until the new one is proven.
  if (!state.contactsVerified) return false;
  if (feature === 'checkout') return true;
  return state.docsApproved || !state.requireDocumentsForReseller || customer.kycStatus === 'approved';
}

function featureBlockedError(feature) {
  const state = feature === 'checkout' ? 'Verify your email and mobile number' : 'Complete identity verification';
  return httpError(403, `${state} to unlock this feature. Check your account page for the current status.`, 'verification_required');
}

function requireFeature(customer, feature) {
  if (!canUseFeature(customer, feature)) throw featureBlockedError(feature);
}

// A rejected or pending customer keeps read access to their own profile and
// chats, so this only guards writes that move money or stock.
function applyKycDecision(customer, status, { reviewedBy = '', note = '' } = {}) {
  if (!KYC_STATUSES.includes(status)) throw httpError(422, 'Choose pending, approved or rejected.');
  const updated = {
    ...customer,
    kycStatus: status,
    kycReviewedBy: reviewedBy,
    kycReviewedAt: now(),
    kycNote: clampStr(note, 400)
  };
  store.putCustomer(updated);
  return updated;
}

// Accounts created before identity verification existed keep checking out
// unchanged; only accounts issued with the verification fields are gated.
function verificationRequired(customer) {
  return Boolean(customer?.kycStatus) && otpChannelsReady();
}

// Recomputes the account status after a verification event. An administrator's
// approval is never downgraded automatically; rejections clear only when the
// customer fixes the issue and the contact checks pass again.
function refreshKycStatus(customer) {
  const cfg = kycConfig();
  const state = verificationState(customer);
  let status = customer.kycStatus || 'unverified';
  if (!state.contactsVerified) {
    // A changed or removed contact detail must be proven again; the accepted
    // document stays on file, so re-verifying contacts restores approval.
    status = 'unverified';
  } else if (cfg.mode === 'otp') {
    status = 'approved';
  } else if (state.docsApproved) {
    status = 'approved';
  } else if (status !== 'approved') {
    status = state.documents.length ? 'pending' : 'unverified';
  }
  const updated = { ...customer, kycStatus: status };
  store.putCustomer(updated);
  return updated;
}

// ---------------------------------------------------------------- one-time codes

const OTP_TTL_MS = 10 * 60_000;
const OTP_RESEND_AFTER_MS = 45_000;
const OTP_WINDOW_MS = 60 * 60_000;
const OTP_MAX_PER_WINDOW = 5;
const OTP_MAX_ATTEMPTS = 6;

// Indian mobile numbers lead, but existing accounts use US numbers, so both
// are accepted and stored in E.164 form.
function normaliseMobile(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length > 10 && digits.length <= 15 && /^[1-9]\d{9,14}$/.test(digits)) return `+${digits}`;
  return null;
}

function mobileCountry(e164) {
  if (String(e164).startsWith('+91')) return 'IN';
  if (String(e164).startsWith('+1')) return 'US';
  return '';
}

function newOtpCode() {
  return String(crypto.randomInt(100_000, 1_000_000));
}

// The code is hashed before it touches the database and is never returned to
// the browser. When SMTP/SMS credentials are missing the message is recorded
// in the outbox table, which the admin Delivery panel reads.
async function issueOtp({ purpose, identifier, channel, displayName = '' }) {
  const label = purpose === 'email' ? 'email address' : 'mobile number';
  const active = store.activeOtp(purpose, identifier);
  if (active) {
    const age = Date.now() - new Date(active.created_at).getTime();
    if (age < OTP_RESEND_AFTER_MS) {
      throw httpError(429, `Please wait ${Math.ceil((OTP_RESEND_AFTER_MS - age) / 1000)} seconds before requesting another code.`);
    }
  }
  if (store.recentOtpCount(purpose, identifier, OTP_WINDOW_MS) >= OTP_MAX_PER_WINDOW) {
    throw httpError(429, `Too many codes requested for this ${label}. Please try again in an hour.`);
  }
  const code = newOtpCode();
  store.createOtp({ purpose, identifier, code, ttlMs: OTP_TTL_MS });
  const greeting = displayName ? `Hi ${displayName},\n\n` : '';
  let result;
  if (channel === 'sms') {
    result = await sendVerificationSms({ to: identifier, text: verificationOtpText(code, 'sms') });
  } else {
    result = await sendVerificationEmail({
      to: identifier,
      subject: `${code} is your VELUNE verification code`,
      text: `${greeting}${verificationOtpText(code, 'email')}`,
      html: `<p>${escapeHtml(greeting)}Your VELUNE verification code is</p><p style="font-size:28px;letter-spacing:6px;font-weight:600">${code}</p><p>It expires in 10 minutes. Never share this code with anyone.</p>`
    });
  }
  return {
    delivered: result.delivered,
    channel: result.channel,
    error: result.error || '',
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    resendAfterSeconds: Math.ceil(OTP_RESEND_AFTER_MS / 1000),
    // Local testing only: mirrors the code into the API response when an
    // operator explicitly asks for it and no provider is configured.
    devCode: String(process.env.OTP_DEV_ECHO) === 'true' && result.channel === 'outbox' ? code : undefined
  };
}

function verifyOtp({ purpose, identifier, code }) {
  const row = store.activeOtp(purpose, identifier);
  if (!row) throw httpError(410, 'That code is no longer active. Request a new one.');
  if (Number(row.expires_at) < Date.now()) {
    store.consumeOtp(row.id);
    throw httpError(410, 'That code has expired. Request a new one.');
  }
  if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) {
    store.consumeOtp(row.id);
    throw httpError(429, 'Too many incorrect attempts. Request a new code.');
  }
  store.registerOtpAttempt(row.id);
  const submitted = clampStr(code, 10);
  if (!/^\d{6}$/.test(submitted)) throw httpError(422, 'Enter the 6-digit code we sent.');
  const expected = Buffer.from(store.hashOtp(identifier, submitted), 'utf8');
  const stored = Buffer.from(String(row.code_hash), 'utf8');
  const ok = expected.length === stored.length && crypto.timingSafeEqual(expected, stored);
  if (!ok) throw httpError(422, 'That code is not correct. Check it and try again.');
  store.consumeOtp(row.id);
  return true;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString('hex')}$${Buffer.from(derived).toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (!salt.length || !expected.length) return false;
  try {
    const derived = await scryptAsync(password, salt, expected.length, SCRYPT_OPTIONS);
    return crypto.timingSafeEqual(Buffer.from(derived), expected);
  } catch {
    return false;
  }
}

function publicCustomer(customer) {
  const { passwordHash, sessionVersion, profilePicture, ...safe } = customer;
  return {
    ...safe,
    fullName: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
    hasAvatar: Boolean(customer.profilePicture)
  };
}

// What the signed-in customer is allowed to see about their own verification.
// Stored filenames are never included — documents are only reachable through
// the guarded endpoints that stream them back to their owner or an admin.
function verificationPayload(customer) {
  const state = verificationState(customer);
  const cfg = kycConfig();
  const enforced = verificationRequired(customer);
  const nextSteps = [];
  if (enforced && !state.emailVerified) nextSteps.push('Verify your email address with the code we sent.');
  if (enforced && !state.phoneVerified) nextSteps.push('Verify your mobile number with the code we sent.');
  if (enforced && cfg.mode === 'otp+documents' && !state.docsApproved && !state.documents.length) {
    nextSteps.push('Upload an identity document when you need wholesale or reseller access.');
  }
  if (state.docsRejected) nextSteps.push('Resubmit a clearer copy of the document we could not read.');
  if (!nextSteps.length) nextSteps.push('Your account is fully verified.');
  return {
    status: customer.kycStatus || 'unverified',
    mode: cfg.mode,
    providersConfigured: otpChannelsReady(),
    enforced,
    email: { address: customer.email, verified: state.emailVerified, verifiedAt: customer.emailVerifiedAt || '' },
    phone: { number: customer.phone, verified: state.phoneVerified, verifiedAt: customer.phoneVerifiedAt || '' },
    contactsVerified: state.contactsVerified,
    documents: state.documents.map((document) => ({
      id: document.id,
      docType: document.docType,
      kind: document.kind,
      mime: document.mime,
      bytes: document.bytes,
      status: document.status,
      note: document.note || '',
      createdAt: document.createdAt,
      reviewedAt: document.reviewedAt || ''
    })),
    docsApproved: state.docsApproved,
    acceptedDocTypes: cfg.acceptedDocTypes,
    retentionDays: cfg.retentionDays,
    canCheckout: !enforced || state.contactsVerified,
    canReseller: !enforced || canUseFeature(customer, 'reseller'),
    reviewedBy: customer.kycReviewedBy || '',
    reviewedAt: customer.kycReviewedAt || '',
    note: customer.kycNote || '',
    nextSteps
  };
}

function adminCustomer(customer) {
  const orders = db.orders.filter(
    (order) => order.customerId === customer.id || order.customer.email === customer.email
  );
  const verification = verificationState(customer);
  return {
    ...publicCustomer(customer),
    orderCount: orders.length,
    spent: round2(orders.filter((order) => order.status !== 'Cancelled').reduce((sum, order) => sum + order.total, 0)),
    verification: {
      status: customer.kycStatus || 'unverified',
      emailVerified: verification.emailVerified,
      phoneVerified: verification.phoneVerified,
      documents: verification.documents.map((document) => ({
        id: document.id,
        docType: document.docType,
        kind: document.kind,
        mime: document.mime,
        bytes: document.bytes,
        status: document.status,
        note: document.note || '',
        reviewedBy: document.reviewedBy || '',
        reviewedAt: document.reviewedAt || '',
        createdAt: document.createdAt
      })),
      reviewedBy: customer.kycReviewedBy || '',
      reviewedAt: customer.kycReviewedAt || '',
      note: customer.kycNote || ''
    }
  };
}

function publicOrder(order) {
  const { token, idempotencyKey, restocked, ...safe } = order;
  return {
    ...safe,
    items: (Array.isArray(order.items) ? order.items : []).map(({ unitCost, ...line }) => line)
  };
}

// Admin view keeps the cost snapshot and adds per-line and per-order profit.
function adminOrder(order) {
  const safe = publicOrder(order);
  let cost = 0;
  let tracked = true;
  const items = (Array.isArray(order.items) ? order.items : []).map(({ unitCost, ...line }) => {
    if (!Number.isFinite(unitCost)) {
      tracked = false;
      return { ...line, unitCost: null, lineProfit: null };
    }
    const lineTotal = (line.price || 0) * (line.qty || 0);
    cost += unitCost * (line.qty || 0);
    return { ...line, unitCost, lineProfit: round2(lineTotal - unitCost * (line.qty || 0)) };
  });
  const merchandise = round2(items.reduce((sum, line) => sum + (line.price || 0) * (line.qty || 0), 0));
  return {
    ...safe,
    items,
    costTotal: tracked ? round2(cost) : null,
    // Shipping and payment fees are not part of product margin; discount is.
    grossProfit: tracked ? round2(merchandise - (order.discount || 0) - cost) : null,
    profitTracked: tracked
  };
}

// ---------------------------------------------------------------- image uploads

const IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const IMAGE_SIGNATURES = {
  'image/jpeg': (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/png': (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (buffer) => buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
};

function sniffImage(buffer) {
  for (const [mime, isMatch] of Object.entries(IMAGE_SIGNATURES)) {
    if (isMatch(buffer)) return mime;
  }
  return null;
}

// Phones often default to HEIC/HEIF. The storefront does not ship a decoder, so
// name the format instead of returning a generic "unsupported image" error.
function looksLikeHeif(buffer) {
  if (buffer.length < 12 || buffer.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
  return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(buffer.subarray(8, 12).toString('ascii'));
}

// Public URL for a stored image, whether uploads live inside public/ (local
// development) or on a mounted volume (UPLOADS_DIR in production).
function uploadUrlFor(absolutePath) {
  if (absolutePath.startsWith(UPLOADS_DIR + path.sep)) {
    return `${UPLOADS_URL_PREFIX}${path.relative(UPLOADS_DIR, absolutePath).split(path.sep).join('/')}`;
  }
  return `/${path.relative(PUBLIC_DIR, absolutePath).split(path.sep).join('/')}`;
}

// Accepts base64 (raw or data: URL), verifies the bytes really are the image
// they claim to be, then writes a randomly named file below public/.
async function saveImage(base64, { directory, prefix = 'img' }) {
  let payload = String(base64 || '');
  if (payload.startsWith('data:')) payload = payload.slice(payload.indexOf(',') + 1);
  if (!payload) throw httpError(422, 'Choose an image to upload.');
  let buffer;
  try {
    buffer = Buffer.from(payload, 'base64');
  } catch {
    throw httpError(422, 'That image could not be read.');
  }
  if (buffer.length < 128) throw httpError(422, 'That image appears to be empty.');
  if (buffer.length > UPLOAD_MAX_BYTES) throw httpError(413, 'Images must be 5 MB or smaller.');
  const mime = sniffImage(buffer);
  if (!mime) throw httpError(422, 'Upload a JPEG, PNG or WebP image.');
  const filename = `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${IMAGE_EXTENSIONS[mime]}`;
  await fsp.mkdir(directory, { recursive: true });
  const absolutePath = path.join(directory, filename);
  await fsp.writeFile(absolutePath, buffer);
  return {
    path: uploadUrlFor(absolutePath),
    mime,
    bytes: buffer.length
  };
}

// Identity documents go to data/private/ — outside the web root, so no public
// URL can reach them. Only the admin review endpoint streams them back.
const DOC_MAX_BYTES = 5 * 1024 * 1024;

async function savePrivateDocument(base64, { kind, prefix = 'doc' }) {
  let payload = String(base64 || '');
  const declaredMime = payload.startsWith('data:') ? payload.slice(5, payload.indexOf(';') > 0 ? payload.indexOf(';') : payload.indexOf(',')) : '';
  if (payload.startsWith('data:')) payload = payload.slice(payload.indexOf(',') + 1);
  if (!payload) throw httpError(422, `Attach the ${kind === 'back' ? 'reverse' : 'front'} of the document.`);
  let buffer;
  try {
    buffer = Buffer.from(payload, 'base64');
  } catch {
    throw httpError(422, 'That file could not be read. Try saving it again.');
  }
  if (buffer.length < 512) throw httpError(422, 'That file appears to be empty.');
  if (buffer.length > DOC_MAX_BYTES) throw httpError(413, 'Document files must be 8 MB or smaller.');
  const mime = sniffImage(buffer) || (buffer.subarray(0, 5).toString('ascii') === '%PDF-' ? 'application/pdf' : '');
  if (!mime) throw httpError(422, 'Upload a JPEG, PNG, WebP image or a PDF.');
  if (declaredMime && declaredMime !== 'application/octet-stream' && declaredMime !== mime) {
    throw httpError(422, 'The file contents do not match the file type.');
  }
  const storedName = await store.writePrivateFile(buffer, { kind: 'doc', prefix, mime });
  return { storedName, mime, bytes: buffer.length };
}

// Profile pictures are private too: they are served through the account
// endpoint rather than a guessable public path.
async function savePrivateProfilePicture(base64) {
  let payload = String(base64 || '');
  if (payload.startsWith('data:')) payload = payload.slice(payload.indexOf(',') + 1);
  if (!payload) return null;
  const buffer = Buffer.from(payload, 'base64');
  if (buffer.length < 128) throw httpError(422, 'That profile picture appears to be empty.');
  if (buffer.length > UPLOAD_MAX_BYTES) throw httpError(413, 'Profile pictures must be 5 MB or smaller.');
  const mime = sniffImage(buffer);
  if (!mime) throw httpError(422, 'Upload a JPEG, PNG or WebP profile picture.');
  return store.writePrivateFile(buffer, { kind: 'profile', prefix: 'avatar', mime });
}

// Documents are always stored as a front/back pair so an administrator never
// reviews half a credential. Both sides are mandatory once a type is chosen.
const DOCUMENT_KINDS = ['front', 'back'];

async function storeUploadedDocuments(customer, reviewerName, payload = {}) {
  const cfg = kycConfig();
  const docType = clampStr(payload.docType, 40).toLowerCase();
  if (!cfg.acceptedDocTypes.includes(docType)) {
    throw httpError(422, `Choose one of: ${cfg.acceptedDocTypes.join(', ')}.`);
  }
  if (!payload.front || !payload.back) {
    throw httpError(422, 'Upload both the front and the reverse of the document.');
  }
  // Replacing a rejected submission removes the previous files first.
  for (const existing of store.documentsFor(customer.id)) {
    if (existing.docType === docType) store.deleteDocument(existing.id);
  }
  const created = [];
  for (const kind of DOCUMENT_KINDS) {
    const saved = await savePrivateDocument(payload[kind], { kind, prefix: `${docType}-${kind}` });
    created.push(
      store.putDocument({
        id: `doc_${crypto.randomBytes(8).toString('hex')}`,
        customerId: customer.id,
        docType,
        kind,
        storedName: saved.storedName,
        mime: saved.mime,
        bytes: saved.bytes,
        status: 'pending',
        note: '',
        reviewedBy: '',
        reviewedAt: '',
        createdAt: now()
      })
    );
  }
  const updated = refreshKycStatus({ ...customer, kycStatus: 'pending', kycSubmittedAt: now(), kycSubmittedBy: clampStr(reviewerName, 80) });
  return { docType, uploaded: created.length, customer: publicCustomer(updated) };
}

// Map a public /images/uploads/... URL back to the uploads directory, wherever
// UPLOADS_DIR points. Returns null for anything outside that directory.
function uploadLocalPath(urlPath) {
  const value = String(urlPath || '').split('?')[0].split('#')[0];
  if (!/^\/images\/uploads\/[\w./-]+$/.test(value) || value.includes('..')) return null;
  const localPath = path.resolve(UPLOADS_DIR, `.${value.slice('/images/uploads'.length)}`);
  return localPath.startsWith(UPLOADS_DIR + path.sep) ? localPath : null;
}

// Remove the file behind a chat attachment when its message is deleted.
function deleteStoredAttachment(message) {
  const localPath = uploadLocalPath(message?.attachment?.path);
  if (!localPath) return null;
  return fsp.unlink(localPath).catch(() => {});
}

// ---------------------------------------------------------------- realtime (SSE)

const sseChannels = new Map();
const sseTickets = new Map();

function sseClients(channel) {
  let clients = sseChannels.get(channel);
  if (!clients) {
    clients = new Set();
    sseChannels.set(channel, clients);
  }
  return clients;
}

function sseWrite(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
  } catch {
    /* the client is already gone */
  }
}

function sseBroadcast(channel, event, data) {
  const clients = sseChannels.get(channel);
  if (!clients || !clients.size) return 0;
  for (const res of clients) sseWrite(res, event, data);
  return clients.size;
}

// Every conversation event also reaches the admin channel so the support desk
// updates its inbox without polling. Agents restricted to their own assigned
// threads get a private channel instead, so they never receive other chats.
const scopedDesks = new Map();

function emitChat(conversationId, event, data) {
  sseBroadcast(`chat:${conversationId}`, event, data);
  sseBroadcast('admin:chat', event, { ...data, conversationId });
  if (!scopedDesks.size) return;
  const assignee = store.conversationAssignee(conversationId);
  if (!assignee) return;
  for (const [staffId, clients] of scopedDesks) {
    if (assignee.assignedStaffId && assignee.assignedStaffId !== staffId) continue;
    for (const res of clients) sseWrite(res, event, { ...data, conversationId });
  }
}

// EventSource cannot send headers, so the admin stream is opened with a
// single-use ticket minted by an authenticated request.
function issueSseTicket(scope) {
  if (sseTickets.size > 5_000) {
    const cutoff = Date.now();
    for (const [token, entry] of sseTickets) if (entry.expires <= cutoff) sseTickets.delete(token);
  }
  const token = crypto.randomBytes(18).toString('base64url');
  sseTickets.set(token, { ...scope, expires: Date.now() + SSE_TICKET_TTL });
  return token;
}

function readSseToken(token) {
  const entry = sseTickets.get(String(token || ''));
  if (!entry || entry.expires < Date.now()) {
    sseTickets.delete(String(token || ''));
    return null;
  }
  return entry;
}

function openSse(req, res, channel, { maxClients = 40 } = {}) {
  const clients = sseClients(channel);
  if (clients.size >= maxClients) throw httpError(503, 'Live chat is busy right now. Try again in a moment.');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 3000\n\n');
  clients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* cleaned up by the close handler */
    }
  }, 25_000);
  heartbeat.unref();

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    clients.delete(res);
    if (!clients.size) sseChannels.delete(channel);
    onSseClosed(channel);
  };
  res.on('close', cleanup);
  res.on('error', cleanup);
  return clients;
}

// ---------------------------------------------------------------- presence

const presenceByConversation = new Map();
let adminWatchers = 0;
const typingByConversation = new Map();

function onSseClosed(channel) {
  if (channel === 'admin:chat') {
    adminWatchers = Math.max(0, adminWatchers - 1);
    broadcastPresence();
    return;
  }
  if (channel.startsWith('admin:chat:staff:')) {
    const staffId = channel.slice('admin:chat:staff:'.length);
    scopedDesks.delete(staffId);
    adminWatchers = Math.max(0, adminWatchers - 1);
    broadcastPresence();
    return;
  }
  const conversationId = channel.startsWith('chat:') ? channel.slice(5) : '';
  if (!conversationId) return;
  const left = presenceByConversation.get(conversationId) || 0;
  if (left <= 1) presenceByConversation.delete(conversationId);
  else presenceByConversation.set(conversationId, left - 1);
  typingByConversation.delete(conversationId);
  broadcastPresence();
}

function customerIsOnline(conversationId) {
  return (presenceByConversation.get(conversationId) || 0) > 0;
}

function supportStatus() {
  return {
    online: adminWatchers > 0,
    hours: db.settings.hours,
    responseTime: db.settings.responseTime
  };
}

function broadcastPresence() {
  const payload = {
    adminOnline: adminWatchers > 0,
    onlineConversations: [...presenceByConversation.keys()]
  };
  sseBroadcast('admin:chat', 'presence', payload);
  for (const [, clients] of scopedDesks) {
    for (const res of clients) sseWrite(res, 'presence', payload);
  }
  for (const conversationId of presenceByConversation.keys()) {
    sseBroadcast(`chat:${conversationId}`, 'presence', { adminOnline: adminWatchers > 0 });
  }
}

// ---------------------------------------------------------------- conversations

// Support chats live in db.tickets: they already carry a thread, a status and
// the customer identity, so the inbox is the same table the contact form used.
function messagesOf(conversation) {
  if (!Array.isArray(conversation.thread)) conversation.thread = [];
  return conversation.thread;
}

const visitorIdOf = (value) => {
  const id = clampStr(value, 40);
  return /^vis_[A-Za-z0-9_-]{6,32}$/.test(id) ? id : '';
};

function conversationById(id) {
  return store.getConversation(clampStr(id, 24).toUpperCase());
}

function ownsConversation(conversation, visitorId, customer) {
  if (visitorId && conversation.visitorId === visitorId) return true;
  return Boolean(customer && conversation.customerId && conversation.customerId === customer.id);
}

function requireConversationAccess(conversation, body, req) {
  if (!conversation) throw httpError(404, 'Chat not found. Start a new conversation.');
  const visitorId = visitorIdOf(body?.visitorId);
  const customer = currentCustomer(req);
  if (!ownsConversation(conversation, visitorId, customer)) {
    throw httpError(403, 'This chat belongs to another visitor.');
  }
  return { visitorId, customer };
}

function paymentInfoFrom(input) {
  if (!input || typeof input !== 'object') return null;
  // The desk form posts the short {upi, binance, crypto, label} shape; newer
  // payloads carry explicit heading/lines. Accept both.
  if (input.upi || input.binance || input.crypto) {
    const lines = [
      input.label ? { label: 'Reference', value: clampStr(input.label, 200) } : null,
      input.upi ? { label: 'UPI', value: clampStr(input.upi, 200) } : null,
      input.binance ? { label: 'Binance Pay', value: clampStr(input.binance, 200) } : null,
      input.crypto ? { label: 'Crypto', value: clampStr(input.crypto, 200) } : null
    ].filter((line) => line && line.value);
    return lines.length ? { heading: 'Payment details', lines, note: '' } : null;
  }
  const info = {
    heading: clampStr(input.heading, 120),
    lines: Array.isArray(input.lines)
      ? input.lines.slice(0, 6).map((line) => ({ label: clampStr(line?.label, 40), value: clampStr(line?.value, 200) }))
          .filter((line) => line.label && line.value)
      : [],
    note: clampStr(input.note, 300)
  };
  return info.lines.length ? info : null;
}

function attachmentFrom(input) {
  if (!input || typeof input !== 'object') return null;
  const url = clampStr(input.path, 220);
  if (!/^\/images\/uploads\/[\w./-]+$/.test(url) || url.includes('..')) return null;
  return {
    path: url,
    mime: clampStr(input.mime, 40).toLowerCase(),
    bytes: Number(input.bytes) || 0,
    kind: clampStr(input.kind, 20) === 'slip' ? 'slip' : 'image',
    orderNumber: clampStr(input.orderNumber, 20).toUpperCase() || ''
  };
}

function lastMessageOf(conversation) {
  const thread = messagesOf(conversation);
  return thread[thread.length - 1] || null;
}

// Compact row for the admin inbox — the thread itself is fetched on open.
function conversationSummary(conversation) {
  const last = lastMessageOf(conversation);
  const { thread, adminNotes, ...rest } = conversation;
  return {
    ...rest,
    messageCount: thread.length,
    customerOnline: customerIsOnline(conversation.id),
    lastMessage: last
      ? {
          id: last.id,
          from: last.from,
          text: clampStr(last.text, 160),
          at: last.at,
          hasAttachment: Boolean(last.attachment)
        }
      : null
  };
}

// What the customer may see: the full thread, never the internal notes.
function conversationForCustomer(conversation) {
  const { adminNotes, ...safe } = conversation;
  return safe;
}

function makeMessage(from, senderName, text, { attachment = null, paymentInfo = null, orderNumber = null } = {}) {
  return {
    id: `msg_${crypto.randomBytes(6).toString('hex')}`,
    from,
    senderName: clampStr(senderName, 80) || (from === 'employee' ? 'Support Team' : 'You'),
    text: clampStr(text, CHAT_TEXT_MAX),
    attachment,
    paymentInfo,
    orderNumber: orderNumber || undefined,
    at: now()
  };
}

async function appendMessage(conversation, message, { reopen = false } = {}) {
  const thread = messagesOf(conversation);
  thread.push(message);
  const fromCustomer = message.from === 'customer';
  conversation.unread = conversation.unread || { admin: 0, customer: 0 };
  conversation.unread[fromCustomer ? 'admin' : 'customer'] += 1;
  conversation.lastMessageAt = message.at;
  conversation.updatedAt = message.at;
  if (reopen && fromCustomer && conversation.status !== 'open') conversation.status = 'open';
  store.putMessage(conversation.id, message);
  store.putConversation(conversation);
  emitChat(conversation.id, 'message', { message, conversation: conversationSummary(conversation) });
  broadcastUnread();
  return message;
}

// Inbox badges: unread totals for the desk and for the customer's own chat.
function broadcastUnread() {
  const totals = store.unreadTotals();
  const payload = {
    unreadAdmin: totals.admin,
    openConversations: totals.open,
    byConversation: totals.perConversation
  };
  sseBroadcast('admin:chat', 'notification', payload);
  for (const [staffId, clients] of scopedDesks) {
    const mine = totals.perConversation.filter((entry) => {
      const assignee = store.conversationAssignee(entry.id);
      return !assignee || !assignee.assignedStaffId || assignee.assignedStaffId === staffId;
    });
    const scoped = { unreadAdmin: mine.reduce((sum, entry) => sum + entry.unread, 0), openConversations: mine.length, byConversation: mine };
    for (const res of clients) sseWrite(res, 'notification', scoped);
  }
}

// Persist a freshly built conversation together with any opening message.
function saveConversation(conversation) {
  store.putConversation(conversation);
  for (const message of messagesOf(conversation)) store.putMessage(conversation.id, message);
  return conversation;
}

// A visitor resumes their own most recent thread whether or not an agent closed it:
// a reply sent while resolving must stay readable, and anything older than the
// window starts a fresh conversation. Still-open threads always resume.
const CHAT_RESUME_WINDOW_DAYS = 14;

function findVisitorConversation(visitorId, customer) {
  const customerId = customer ? customer.id : null;
  const since = new Date(Date.now() - CHAT_RESUME_WINDOW_DAYS * 86_400_000).toISOString();
  return store.recentConversationFor(visitorId, customerId, since) || store.openConversationFor(visitorId, customerId);
}

function startConversation({ visitorId, customer, name, email, phone, orderNumber, source, firstMessage }) {
  const existing = findVisitorConversation(visitorId, customer);
  const timestamp = now();
  if (existing) {
    if (customer && !existing.customerId) existing.customerId = customer.id;
    if (name && !existing.name) existing.name = name;
    if (email && !existing.email) existing.email = email;
    if (phone && !existing.phone) existing.phone = phone;
    // The most recent order wins — a returning visitor usually chats about what
    // they just bought, and the slip notices follow that order.
    if (orderNumber && orderNumber !== existing.orderNumber) existing.orderNumber = orderNumber;
    existing.updatedAt = timestamp;
    store.putConversation(existing);
    return existing;
  }
  const conversation = {
    id: `T-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    visitorId,
    customerId: customer?.id || null,
    name: name || customer?.firstName || 'Guest',
    email: email || customer?.email || '',
    phone: phone || '',
    subject: 'Live chat',
    source: source || 'widget',
    orderNumber: orderNumber || null,
    status: 'open',
    assignedStaffId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessageAt: timestamp,
    unread: { admin: 0, customer: 0 },
    adminNotes: '',
    thread: []
  };
  if (firstMessage) {
    const message = makeMessage('customer', name || customer?.firstName || 'You', firstMessage);
    conversation.thread = [message];
    conversation.unread.admin = 1;
    conversation.lastMessageAt = message.at;
    conversation.updatedAt = message.at;
    store.putMessage(conversation.id, message);
  }
  store.putConversation(conversation);
  broadcastUnread();
  return conversation;
}

// Notify admin dashboard when a slip is uploaded (no automated customer-facing message).
async function notifyOrderProof(order, proof) {
  sseBroadcast('admin:chat', 'proof', { orderNumber: order.number, proof });
}

// Notify admin dashboard of proof decisions (no automated customer-facing message).
async function notifyProofDecision(order, proof, paymentStatus) {
  // Notify admin dashboard of proof decisions (no automated customer-facing message).
  sseBroadcast('admin:chat', 'payment', { orderNumber: order.number, paymentStatus });
}

// ---------------------------------------------------------------- payment channels

const paymentField = (value, max = 120) => clampStr(value, max);

const PAYMENT_METHOD_NAMES = {
  bank: 'Bank Transfer',
  upi: 'UPI',
  binance: 'Binance Pay',
  crypto: 'Crypto',
  cod: 'Cash on delivery'
};

function paymentMethodValue(method, key) {
  const field = (method?.fields || []).find((entry) => entry.key === key);
  return field ? field.value : '';
}

// Public view: only enabled channels, and only those actually filled in.
function publicPayments() {
  const payments = db.settings.payments || defaultPayments();
  const methods = [];
  for (const [key, method] of Object.entries(payments.methods || {})) {
    if (!method.enabled) continue;
    const fields = (method.fields || [])
      .filter((field) => String(field.value || '').trim())
      .map((field) => ({ key: field.key, label: clampStr(field.label, 40), value: String(field.value).trim().slice(0, 200) }));
    // A channel only appears at checkout once the owner filled in what the
    // customer actually needs to pay (UPI ID, wallet address, account number).
    const ready = (method.fields || []).every((field) => !field.required || String(field.value || '').trim());
    if (!ready) continue;
    if (key !== 'cod' && !fields.length && !method.qr) continue;
    methods.push({
      key,
      name: PAYMENT_METHOD_NAMES[key] || clampStr(method.label, 40),
      label: clampStr(method.label, 60),
      note: clampStr(method.note, 300),
      fields,
      qr: method.qr || '',
      needsProof: key !== 'cod'
    });
  }
  return { methods, instructions: clampStr(payments.instructions, 500) };
}

function paymentDetailsForAdmin() {
  return publicPayments();
}

// Full channel config for the settings screen (values included, nothing secret).
function adminPayments() {
  const payments = db.settings.payments || defaultPayments();
  return {
    methods: Object.entries(payments.methods || {}).map(([key, method]) => ({
      key,
      storeName: PAYMENT_METHOD_NAMES[key] || key,
      enabled: Boolean(method.enabled),
      label: method.label || '',
      note: method.note || '',
      qr: method.qr || '',
      fields: (method.fields || []).map((field) => ({
        key: field.key,
        label: field.label,
        required: Boolean(field.required),
        value: field.value || ''
      }))
    })),
    instructions: payments.instructions || ''
  };
}

// Keep only the channels and fields the store actually offers, so a crafted
// settings payload can never invent a new payment channel.
function normalisePayments(input) {
  const template = defaultPayments();
  const methods = {};
  for (const [key, fallback] of Object.entries(template.methods)) {
    const incoming = input?.methods?.[key] || {};
    const fields = fallback.fields.map((field) => {
      const value = paymentField(incoming.fields?.[field.key] ?? field.value, field.key === 'address' ? 200 : 120);
      return { key: field.key, label: field.label, required: Boolean(field.required), value };
    });
    const qr = /^\/images\/uploads\/[\w./-]+$/.test(String(incoming.qr || '')) && !String(incoming.qr).includes('..')
      ? String(incoming.qr)
      : '';
    methods[key] = {
      enabled: incoming.enabled === true || incoming.enabled === false ? incoming.enabled : fallback.enabled,
      label: clampStr(incoming.label || fallback.label, 60),
      note: clampStr(incoming.note ?? fallback.note, 300),
      fields,
      qr
    };
  }
  return {
    methods,
    instructions: clampStr(input?.instructions ?? template.instructions, 500),
    updatedAt: now()
  };
}

function orderProofs(order) {
  return Array.isArray(order.paymentProof) ? order.paymentProof : [];
}

function latestProof(order) {
  return orderProofs(order)[orderProofs(order).length - 1] || null;
}

// ---------------------------------------------------------------- settings / channels

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '').slice(0, 15);
const telegramHandle = (value) => String(value ?? '').trim().replace(/^@+/, '').slice(0, 32);

function whatsappUrl() {
  const digits = digitsOnly(db.settings.whatsapp);
  return digits.length >= 7 ? `https://wa.me/${digits}` : '';
}

function whatsappDisplay() {
  const digits = digitsOnly(db.settings.whatsapp);
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

function whatsappOrderUrl(order) {
  const digits = digitsOnly(db.settings.whatsapp);
  if (digits.length < 7 || !order) return '';
  const lines = [
    `Hello VELUNE, I'm confirming my order ${order.number}.`,
    `Name: ${order.customer.firstName} ${order.customer.lastName}`.trim(),
    `Total: $${Number(order.total).toFixed(2)} (${order.shippingMethod} delivery)`,
    'Please confirm availability and delivery time.'
  ];
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
}

function telegramUrl() {
  const handle = telegramHandle(db.settings.telegram);
  return /^[A-Za-z0-9_]{3,32}$/.test(handle) ? `https://t.me/${handle}` : '';
}

function adminSettings() {
  const { sessionSecret, adminPasswordHash, payments, ...safe } = db.settings;
  return { ...safe, payments: adminPayments() };
}

function contactChannelCards() {
  const email = db.settings.supportEmail;
  const emailCard = `<a class="channel-card" href="mailto:${escapeHtml(email)}">
    <span class="channel-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="m3.5 6.5 8.5 7 8.5-7"/></svg></span>
    <span class="channel-card__label">Email</span>
    <strong>${escapeHtml(email)}</strong>
    <span class="channel-card__note">Best for order changes, returns and detailed questions.</span>
    <span class="channel-card__arrow" aria-hidden="true">→</span>
  </a>`;
  const cards = [emailCard];
  const wa = whatsappUrl();
  if (wa) {
    const display = whatsappDisplay();
    cards.push(`<a class="channel-card" href="${escapeHtml(wa)}" target="_blank" rel="noopener noreferrer">
      <span class="channel-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M20 11.7a7.8 7.8 0 0 1-11.4 6.9L4 20l1.5-4.4A7.8 7.8 0 1 1 20 11.7Z"/><path d="M9 8.5c.3 2.6 2.9 5.1 5.5 5.4l1-1.3 1.8.8c-.2 1.5-1.4 2.1-2.7 1.9-3.4-.5-6.3-3.4-6.8-6.8-.2-1.3.4-2.5 1.9-2.7l.8 1.8L9 8.5Z"/></svg></span>
      <span class="channel-card__label">WhatsApp</span>
      <strong>${escapeHtml(display)}</strong>
      <span class="channel-card__note">Message us during ${escapeHtml(db.settings.hours)}.</span>
      <span class="channel-card__arrow" aria-hidden="true">↗</span>
    </a>`);
  }
  const tg = telegramUrl();
  if (tg) {
    const handle = telegramHandle(db.settings.telegram);
    cards.push(`<a class="channel-card" href="${escapeHtml(tg)}" target="_blank" rel="noopener noreferrer">
      <span class="channel-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="m21 4-3 16-6-4.5L9 19l-.4-5.5L21 4Z"/><path d="m8.6 13.5 8.7-6.4"/></svg></span>
      <span class="channel-card__label">Telegram</span>
      <strong>@${escapeHtml(handle)}</strong>
      <span class="channel-card__note">Send a message or order number for a quick reply.</span>
      <span class="channel-card__arrow" aria-hidden="true">↗</span>
    </a>`);
  }
  return cards.join('');
}

function chatContactLinks() {
  const links = [`<a class="chat-channel" href="mailto:${escapeHtml(db.settings.supportEmail)}">Email us</a>`];
  if (whatsappUrl()) {
    links.push(
      `<a class="chat-channel" href="${escapeHtml(whatsappUrl())}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`
    );
  }
  if (telegramUrl()) {
    links.push(
      `<a class="chat-channel" href="${escapeHtml(telegramUrl())}" target="_blank" rel="noopener noreferrer">Telegram</a>`
    );
  }
  return links.join('');
}

function footerContactLinks() {
  const links = [`<li><a href="mailto:${escapeHtml(db.settings.supportEmail)}">${escapeHtml(db.settings.supportEmail)}</a></li>`];
  if (whatsappUrl()) {
    links.push(
      `<li><a href="${escapeHtml(whatsappUrl())}" target="_blank" rel="noopener noreferrer">WhatsApp</a></li>`
    );
  }
  if (telegramUrl()) {
    links.push(
      `<li><a href="${escapeHtml(telegramUrl())}" target="_blank" rel="noopener noreferrer">Telegram</a></li>`
    );
  }
  links.push('<li><a href="/contact">All contact options</a></li>');
  return links.join('');
}

const CATEGORY_SHORT_NAMES = {
  skincare: 'Skincare',
  makeup: 'Makeup',
  haircare: 'Haircare',
  perfumes: 'Perfume',
  'beauty-accessories': 'Tools'
};

function categoryShortName(category) {
  return CATEGORY_SHORT_NAMES[category.slug] || category.name;
}

function categoryCoverImage(category) {
  const products = db.products.filter((product) => product.category === category.slug);
  const photos = products
    .map((product) => photoPathFor(product))
    .filter(Boolean)
    .map((image) => {
      if (/^https?:\/\//i.test(image)) return { image, size: Number.MAX_SAFE_INTEGER };
      try {
        return { image, size: fs.statSync(assetFilePath(image.split('?')[0])).size };
      } catch {
        return { image, size: 0 };
      }
    })
    .sort((a, b) => b.size - a.size);
  if (photos.length) return versionedAsset(photos[0].image);
  return '';
}

function categoryTile(category) {
  const count = db.products.filter((product) => product.category === category.slug).length;
  const line = category.line || (count ? `${count} ${count === 1 ? 'product' : 'products'}.` : 'New department.');
  const cover = categoryCoverImage(category);
  const media = cover
    ? `<div class="category-tile__media"><img src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async"></div>`
    : `<div class="category-tile__media category-tile__media--type"><span class="category-tile__monogram">${escapeHtml(categoryShortName(category))}</span></div>`;
  return `<a class="category-tile category-tile--${escapeHtml(category.slug)}" href="/shop?category=${encodeURIComponent(category.slug)}">
          ${media}
          <div class="category-tile__body">
            <div>
              <div class="category-tile__name">${escapeHtml(category.name)}</div>
              <div class="category-tile__line">${escapeHtml(line)}</div>
            </div>
            <span class="category-tile__arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg></span>
          </div>
        </a>`;
}

function categoryTokens() {
  const categories = db.categories;
  const stocked = categories.filter((category) => db.products.some((product) => product.category === category.slug));
  return {
    '{{NAV_CATEGORY_LINKS}}': categories
      .slice(0, 6)
      .map(
        (category) =>
          `<a href="/shop?category=${encodeURIComponent(category.slug)}" data-nav="${escapeHtml(category.slug)}">${escapeHtml(categoryShortName(category))}</a>`
      )
      .join('\n        '),
    '{{MOBILE_CATEGORY_LINKS}}': categories
      .map(
        (category, index) =>
          `<a href="/shop?category=${encodeURIComponent(category.slug)}">${escapeHtml(category.name)} <span>${String(index + 1).padStart(2, '0')}</span></a>`
      )
      .join('\n    '),
    '{{FOOTER_CATEGORY_LINKS}}': categories
      .map(
        (category) =>
          `<li><a href="/shop?category=${encodeURIComponent(category.slug)}">${escapeHtml(category.name)}</a></li>`
      )
      .join('\n          '),
    '{{SEARCH_CATEGORY_LINKS}}': categories
      .slice(0, 4)
      .map(
        (category) =>
          `<li><a href="/shop?category=${encodeURIComponent(category.slug)}">${escapeHtml(category.name)}</a></li>`
      )
      .join('\n          '),
    '{{SHOP_CATEGORY_CHIPS}}': categories
      .map(
        (category) =>
          `<button type="button" class="chip" data-category="${escapeHtml(category.slug)}">${escapeHtml(categoryShortName(category))} <span class="count" data-count="${escapeHtml(category.slug)}"></span></button>`
      )
      .join('\n        '),
    '{{HOME_CATEGORY_TILES}}': (stocked.length ? stocked : categories).map(categoryTile).join('\n        ')
  };
}

function contactTokens(currency = currencyConfig().display) {
  const email = db.settings.supportEmail;
  const cfg = currencyConfig();
  const other = currency === 'INR' ? 'USD' : 'INR';
  return {
    '{{ANNOUNCEMENT}}': escapeHtml(db.settings.announcement),
    '{{SUPPORT_EMAIL}}': escapeHtml(email),
    '{{SUPPORT_EMAIL_HREF}}': escapeHtml(`mailto:${email}`),
    '{{SUPPORT_HOURS}}': escapeHtml(db.settings.hours),
    '{{SUPPORT_RESPONSE}}': escapeHtml(db.settings.responseTime),
    '{{WHATSAPP_URL}}': escapeHtml(whatsappUrl()),
    '{{TELEGRAM_URL}}': escapeHtml(telegramUrl()),
    '{{CONTACT_CHANNEL_CARDS}}': contactChannelCards(),
    '{{CHAT_CONTACT_LINKS}}': chatContactLinks(),
    '{{FOOTER_CONTACT_LINKS}}': footerContactLinks(),
    '{{CURRENCY_ACTIVE}}': currency,
    '{{CURRENCY_OTHER}}': other,
    '{{CURRENCY_OTHER_LABEL}}': other === 'INR' ? `INR (${cfg.symbolInr})` : `USD (${cfg.symbolUsd})`,
    '{{CURRENCY_RATE}}': String(cfg.inrPerUsd)
  };
}

// ---------------------------------------------------------------- domain

// Dual currency: USD is the stored unit for every price, total and cost, so
// the pricing formula and profit maths never depend on a display rate. INR is
// derived at the edge (server HTML and API payloads) from the admin's rate.
function currencyConfig() {
  const stored = db.settings.currency;
  const cfg = { ...defaultCurrency(), ...(stored && typeof stored === 'object' ? stored : {}) };
  const rate = Number(cfg.inrPerUsd);
  cfg.inrPerUsd = Number.isFinite(rate) && rate > 0 ? round2(rate) : 83.2;
  cfg.display = cfg.display === 'INR' ? 'INR' : 'USD';
  return cfg;
}

function toInr(usd) {
  return Math.round((Number(usd) || 0) * currencyConfig().inrPerUsd * 100) / 100;
}

function normaliseCurrencySettings(input = {}) {
  const current = currencyConfig();
  const rate = Number(input.inrPerUsd);
  return {
    ...current,
    base: 'USD',
    display: input.display === 'INR' ? 'INR' : input.display === 'USD' ? 'USD' : current.display,
    inrPerUsd: Number.isFinite(rate) && rate > 0 && rate < 10000 ? round2(rate) : current.inrPerUsd,
    symbolUsd: clampStr(input.symbolUsd, 4) || current.symbolUsd,
    symbolInr: clampStr(input.symbolInr, 4) || current.symbolInr,
    updatedAt: now()
  };
}

function normaliseKycSettings(input = {}) {
  const current = kycConfig();
  const accepted = Array.isArray(input.acceptedDocTypes)
    ? input.acceptedDocTypes.map((value) => slugify(clampStr(value, 40))).filter(Boolean)
    : current.acceptedDocTypes;
  const retention = Number(input.retentionDays);
  return {
    ...current,
    mode: input.mode === 'otp' ? 'otp' : 'otp+documents',
    requireDocumentsForReseller: input.requireDocumentsForReseller !== false,
    acceptedDocTypes: accepted.length ? [...new Set(accepted)].slice(0, 12) : current.acceptedDocTypes,
    protectedFeatures: Array.isArray(input.protectedFeatures)
      ? input.protectedFeatures.map((value) => clampStr(value, 30)).filter(Boolean).slice(0, 10)
      : current.protectedFeatures,
    retentionDays: Number.isFinite(retention) && retention >= 7 && retention <= 3650 ? Math.round(retention) : current.retentionDays,
    updatedAt: now()
  };
}

function symbolFor(currency) {
  const cfg = currencyConfig();
  return currency === 'INR' ? cfg.symbolInr : cfg.symbolUsd;
}

function amountIn(currency, usd) {
  return currency === 'INR' ? toInr(usd) : round2(usd);
}

function formatMoney(usd, currency = currencyConfig().display) {
  const value = amountIn(currency, usd);
  return currency === 'INR'
    ? `${symbolFor('INR')}${value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
    : `${symbolFor('USD')}${value.toFixed(2)}`;
}

const CURRENCY_COOKIE = 'velune_currency';

// A visitor's currency choice lives in a cookie (so a refresh keeps it) and
// falls back to the store default the administrator sets.
function requestedCurrency(req) {
  const choice = parseCookies(req)[CURRENCY_COOKIE];
  if (choice === 'INR' || choice === 'USD') return choice;
  return currencyConfig().display;
}

function currencyCookie(req, code, maxAgeMs = 365 * 24 * 60 * 60 * 1000) {
  const secure = IS_PROD || requestIsHttps(req);
  return `${CURRENCY_COOKIE}=${code}; Path=/; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`;
}

function moneyFor(req, usd) {
  return formatMoney(usd, requestedCurrency(req));
}

function withCurrency(product) {
  const cfg = currencyConfig();
  return {
    ...product,
    priceUsd: round2(product.price || 0),
    priceInr: toInr(product.price || 0),
    compareAtUsd: Number.isFinite(product.compareAt) ? round2(product.compareAt) : null,
    compareAtInr: Number.isFinite(product.compareAt) ? toInr(product.compareAt) : null,
    currencies: { base: 'USD', display: [cfg.display, cfg.display === 'INR' ? 'USD' : 'INR'], inrPerUsd: cfg.inrPerUsd, symbols: { USD: cfg.symbolUsd, INR: cfg.symbolInr } }
  };
}

function categoryName(slug) {
  return db.categories.find((category) => category.slug === slug)?.name || slug;
}

// ---------------------------------------------------------------- expenses

function expenseList() {
  return Array.isArray(db.settings.expenses) ? db.settings.expenses : [];
}

// A monthly entry is charged once per calendar month in the window; one-time
// entries are charged on the day they fall in.
function expenseTotals(list = expenseList(), { from = null, to = null } = {}) {
  const months = from
    ? Math.max(1, Math.round((Date.now() - new Date(from).getTime()) / (30.44 * 24 * 3600 * 1000)))
    : 12;
  let monthly = 0;
  let oneTime = 0;
  for (const entry of list) {
    const amount = Number(entry.amount) || 0;
    if (entry.period === 'one-time') {
      const date = new Date(entry.date || entry.createdAt);
      if ((!from || date >= new Date(from)) && (!to || date <= new Date(to))) oneTime += amount;
    } else {
      monthly += amount * months;
    }
  }
  return { monthly: round2(monthly), oneTime: round2(oneTime), total: round2(monthly + oneTime) };
}

const publicAssetCache = new Set();
const assetVersionCache = new Map();
const ASSET_VERSION_TTL_MS = 30_000;

// Resolve a public /images/... URL to the file that actually serves it. Uploads
// may live outside public/ when UPLOADS_DIR points at a mounted volume.
function assetFilePath(urlPath) {
  const clean = String(urlPath || '').split('?')[0].split('#')[0];
  const publicPath = clean.startsWith('/images/') || clean.startsWith('/js/') || clean.startsWith('/css/');
  if (!publicPath || clean.includes('..') || clean.includes('\0')) return null;
  if (clean.startsWith(UPLOADS_URL_PREFIX)) {
    const absolute = path.resolve(UPLOADS_DIR, `.${clean.slice('/images/uploads'.length)}`);
    return absolute.startsWith(UPLOADS_DIR + path.sep) ? absolute : null;
  }
  const absolute = path.resolve(PUBLIC_DIR, `.${clean}`);
  return absolute.startsWith(PUBLIC_DIR + path.sep) ? absolute : null;
}

// A short, content-derived query token. It changes whenever the file is
// replaced, so browsers and CDNs cannot keep showing the previous image even
// when the path stays the same. The token is deliberately not stored in the
// database; admin endpoints keep returning the clean path.
function assetVersion(urlPath) {
  const clean = String(urlPath || '').split('?')[0].split('#')[0];
  const cached = assetVersionCache.get(clean);
  const nowMs = Date.now();
  if (cached && nowMs - cached.at < ASSET_VERSION_TTL_MS) return cached.version;
  let version = '';
  const absolute = assetFilePath(clean);
  if (absolute) {
    try {
      const stat = fs.statSync(absolute);
      version = `${Math.round(stat.mtimeMs).toString(36)}-${stat.size.toString(36)}`;
    } catch {
      version = '';
    }
  }
  assetVersionCache.set(clean, { version, at: nowMs });
  return version;
}

function versionedAsset(urlPath) {
  const value = String(urlPath || '');
  if (!value || !value.startsWith('/images/')) return value;
  const [base, query] = value.split('?');
  const version = assetVersion(base);
  if (!version) return value;
  return `${base}${query ? `?${query}&` : '?'}v=${version}`;
}

function publicAssetExists(urlPath) {
  if (typeof urlPath !== 'string' || !urlPath.startsWith('/images/')) return false;
  const clean = urlPath.split('?')[0];
  if (publicAssetCache.has(clean)) return true;
  const absolute = assetFilePath(clean);
  if (absolute && fs.existsSync(absolute)) publicAssetCache.add(clean);
  return publicAssetCache.has(clean);
}

const PHOTO_FILE = /\.(?:jpe?g|png|webp|avif)$/i;

// The catalogue's legacy vector packshots are no longer product imagery. Only a
// raster upload (or an owner-supplied photo URL) may reach the storefront; a
// product without one is explicitly marked as awaiting photography instead.
function photoPathFor(product) {
  const value = String(product.image || '').trim();
  if (!value) return '';
  const clean = value.split('?')[0].split('#')[0];
  if (/\.svg$/i.test(clean)) return '';
  if (/^https?:\/\//i.test(clean)) return value;
  return PHOTO_FILE.test(clean) ? value : '';
}

function cardImageFor(product) {
  const image = photoPathFor(product);
  if (!image) return '';
  if (!/-800\.(jpe?g|png|webp|avif)$/i.test(image.split('?')[0])) return image;
  const small = image.replace(/-800\./i, '-400.');
  return publicAssetExists(small) ? small : image;
}

function enrichProduct(product) {
  const photo = photoPathFor(product);
  return withCurrency({
    ...stripCost(product),
    image: photo ? versionedAsset(photo) : '',
    categoryName: categoryName(product.category),
    inStock: product.stock > 0,
    cardImage: versionedAsset(cardImageFor(product)),
    artwork: '',
    photoRequired: !photo
  });
}

// Cost and margin never leave the admin API. The storefront only ever receives
// the selling price plus its currency equivalents.
function stripCost(product) {
  const { baseCost, profit, priceMode, ...safe } = product;
  return safe;
}

function adminProduct(product) {
  const cost = Number.isFinite(product.baseCost) ? product.baseCost : null;
  const margin = Number.isFinite(product.profit) ? product.profit : null;
  return {
    ...withCurrency(product),
    categoryName: categoryName(product.category),
    inStock: product.stock > 0,
    cardImage: versionedAsset(cardImageFor(product)),
    artwork: '',
    photoRequired: !photoPathFor(product),
    baseCost: cost,
    profit: margin,
    priceMode: product.priceMode || 'manual',
    marginPercent: cost && margin !== null ? round2((margin / cost) * 100) : null,
    tracked: cost !== null
  };
}

// ---------------------------------------------------------------- pricing engine
// Owner's rule: Selling Price = Base Price + Profit, default 46 + 6 = 52.
// priceMode "formula" keeps the selling price derived; "manual" lets the
// admin pin a price that no longer tracks cost + margin.

function resolvePricing(input, existing = null) {
  const priceMode = ['formula', 'manual'].includes(input.priceMode)
    ? input.priceMode
    : existing?.priceMode || 'formula';

  const baseCostRaw = input.baseCost === undefined || input.baseCost === '' || input.baseCost === null
    ? existing?.baseCost ?? DEFAULT_BASE_COST
    : Number(input.baseCost);
  const profitRaw = input.profit === undefined || input.profit === '' || input.profit === null
    ? existing?.profit ?? DEFAULT_PROFIT
    : Number(input.profit);

  if (Number.isFinite(baseCostRaw) && baseCostRaw < 0) throw httpError(422, 'Base cost cannot be negative.');
  if (!Number.isFinite(profitRaw) || profitRaw < 0) throw httpError(422, 'Profit must be a number of 0 or more.');
  if (Number.isFinite(baseCostRaw) && baseCostRaw > 10_000_000) throw httpError(422, 'Base cost must be under $10,000,000.');
  if (profitRaw > 10_000_000) throw httpError(422, 'Profit must be under $10,000,000.');

  const baseCost = baseCostRaw === undefined || baseCostRaw === null || !Number.isFinite(baseCostRaw) ? null : round2(baseCostRaw);
  const profit = round2(profitRaw);

  let price;
  if (priceMode === 'formula') {
    if (baseCost === null) throw httpError(422, 'Formula pricing needs a base cost.');
    price = round2(baseCost + profit);
  } else {
    price = Number(input.price);
    if (!Number.isFinite(price) || price < 1 || price > 10_000_000) throw httpError(422, 'Price must be between $1 and $10,000,000.');
    price = round2(price);
  }
  return { baseCost, profit, price, priceMode };
}

function productPayload(input, existing = null) {
  const name = clampStr(input.name, 90);
  const category = clampStr(input.category, 30);
  const stock = Number(input.stock);
  const compareAtRaw = input.compareAt === '' || input.compareAt == null ? null : Number(input.compareAt);
  const image = clampStr(input.image, 500);
  const description = clampStr(input.description, 2000);
  const short = clampStr(input.short, 220);

  if (name.length < 2) throw httpError(422, 'Product name must be at least 2 characters.');
  if (!db.categories.some((entry) => entry.slug === category)) throw httpError(422, 'Choose a valid category.');
  if (!Number.isInteger(stock) || stock < 0 || stock > 100_000) throw httpError(422, 'Stock must be a whole number between 0 and 100,000.');

  const pricing = resolvePricing(input, existing);
  if (compareAtRaw !== null && !Number.isFinite(compareAtRaw)) {
    throw httpError(422, 'Compare-at price must be a number.');
  }
  // A compare-at at or below the selling price carries no meaning; silently
  // dropping it keeps saves friction-free instead of erroring.
  if (!image.startsWith('/images/') && !/^https:\/\//.test(image)) {
    throw httpError(422, 'Image must be a local /images/ path or an https:// URL.');
  }
  if (description.length < 10) throw httpError(422, 'Description must be at least 10 characters.');

  let variants = existing?.variants || [];
  if (Array.isArray(input.variants)) {
    variants = input.variants
      .filter((variant) => variant && clampStr(variant.name, 40) && Array.isArray(variant.options))
      .map((variant) => ({
        name: clampStr(variant.name, 40),
        options: variant.options.map((option) => clampStr(option, 40)).filter(Boolean).slice(0, 8)
      }))
      .filter((variant) => variant.name && variant.options.length)
      .slice(0, 4);
  }

  const slug = existing ? existing.slug : slugify(name) || `product-${Date.now()}`;
  return {
    id: existing ? existing.id : slug,
    slug,
    name,
    category,
    price: pricing.price,
    baseCost: pricing.baseCost,
    profit: pricing.profit,
    priceMode: pricing.priceMode,
    compareAt: compareAtRaw !== null && compareAtRaw > pricing.price ? round2(compareAtRaw) : null,
    badge: clampStr(input.badge, 24) || null,
    rating: existing?.rating ?? 5,
    reviewCount: existing?.reviewCount ?? 0,
    stock,
    featured: Boolean(input.featured),
    isNew: input.isNew === undefined ? existing?.isNew ?? false : Boolean(input.isNew),
    short: short || description.slice(0, 160),
    description,
    details: Array.isArray(input.details) ? input.details.map((line) => clampStr(line, 220)).filter(Boolean).slice(0, 10) : existing?.details || [],
    specs: Array.isArray(input.specs)
      ? input.specs
          .filter((spec) => spec && clampStr(spec.k, 60) && clampStr(spec.v, 120))
          .map((spec) => ({ k: clampStr(spec.k, 60), v: clampStr(spec.v, 120) }))
          .slice(0, 10)
      : existing?.specs || [],
    variants,
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
    image
  };
}

function validateAddress(body) {
  const customer = body.customer || {};
  const shipping = body.shipping || {};
  // Two markets are supported: the existing U.S. flow is unchanged, India adds
  // a 6-digit PIN, full state names and an optional GSTIN for invoices.
  const country = clampStr(shipping.country, 2).toUpperCase() || 'US';
  if (!['US', 'IN'].includes(country)) {
    throw httpError(422, 'We currently ship only within India and the United States.');
  }
  const clean = {
    customer: {
      firstName: clampStr(customer.firstName, 60),
      lastName: clampStr(customer.lastName, 60),
      email: clampStr(customer.email, 254).toLowerCase(),
      phone: clampStr(customer.phone, 30)
    },
    shipping: {
      address1: clampStr(shipping.address1, 120),
      address2: clampStr(shipping.address2, 120),
      city: clampStr(shipping.city, 80),
      state: country === 'US' ? clampStr(shipping.state, 2).toUpperCase() : clampStr(shipping.state, 48),
      zip: clampStr(shipping.zip, 10),
      country,
      gstin: country === 'IN' ? clampStr(shipping.gstin, 15).toUpperCase() : ''
    }
  };
  if (clean.customer.firstName.length < 2) throw httpError(422, 'Please enter your first name.');
  if (clean.customer.lastName.length < 2) throw httpError(422, 'Please enter your last name.');
  if (!isEmail(clean.customer.email)) throw httpError(422, 'Please enter a valid email address.');
  if (clean.shipping.address1.length < 3) throw httpError(422, 'Please enter a street address.');
  if (clean.shipping.city.length < 2) throw httpError(422, 'Please enter a city.');

  if (country === 'US') {
    if (!US_STATES.has(clean.shipping.state)) throw httpError(422, 'Please choose a valid U.S. state.');
    if (!/^\d{5}(-\d{4})?$/.test(clean.shipping.zip)) throw httpError(422, 'Please enter a valid ZIP code.');
    return clean;
  }

  const stateKey = clean.shipping.state.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!IN_STATES.has(stateKey)) throw httpError(422, 'Please choose a valid Indian state or union territory.');
  if (!/^\d{6}$/.test(clean.shipping.zip)) throw httpError(422, 'Please enter a valid 6-digit PIN code.');
  if (!normaliseMobile(clean.customer.phone)?.startsWith('+91')) {
    throw httpError(422, 'An India delivery needs an Indian mobile number, for example 98765 43210.');
  }
  if (clean.shipping.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]{3}$/.test(clean.shipping.gstin)) {
    throw httpError(422, 'That GSTIN does not look valid. Leave it blank for a personal order.');
  }
  clean.customer.phone = normaliseMobile(clean.customer.phone);
  return clean;
}

function calculatePromo(code, subtotal, methodKey) {
  const normalized = clampStr(code, 30).toUpperCase();
  if (!normalized) return { code: null, promo: null, discount: 0, shipping: null };
  const promo = PROMOS[normalized];
  if (!promo) throw httpError(422, 'That promo code is not recognised.');
  if (promo.type === 'percent') {
    return { code: normalized, promo, discount: round2(subtotal * (promo.value / 100)), shipping: null };
  }
  if (promo.type === 'shipping') {
    return { code: normalized, promo, discount: 0, shipping: methodKey === 'standard' ? 0 : null };
  }
  return { code: null, promo: null, discount: 0, shipping: null };
}

function shippingPrice(methodKey, merchandiseTotal, forcedFree = null) {
  const method = SHIPPING_METHODS[methodKey];
  if (!method) throw httpError(422, 'Choose a valid shipping method.');
  if (forcedFree !== null) return forcedFree;
  if (methodKey === 'standard' && merchandiseTotal >= FREE_SHIPPING_THRESHOLD) return 0;
  return method.price;
}

function newOrderNumber() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => Array.from(crypto.randomBytes(4)).map((byte) => alphabet[byte % alphabet.length]).join('');
  let number;
  do {
    number = `VLN-${block()}-${block()}`;
  } while (db.orders.some((order) => order.number === number));
  return number;
}

function safeEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left)).digest();
  const b = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Constant-time comparison for two strings of unequal length (safeEqual has the
// same shape; this reads better where a secret is compared to an env value).
const equalDigests = safeEqual;

function findOrder(number, email, token) {
  const order = db.orders.find((entry) => entry.number.toUpperCase() === String(number).toUpperCase());
  if (!order) return null;
  if (token && safeEqual(order.token, token)) return order;
  if (email && order.customer.email === String(email).toLowerCase()) return order;
  return null;
}

// ---------------------------------------------------------------- pages

const partialCache = new Map();
async function loadPartial(name) {
  const file = path.join(VIEWS_DIR, 'partials', name);
  const stamp = String((await fsp.stat(file)).mtimeMs);
  const cached = partialCache.get(name);
  if (cached?.stamp === stamp) return cached.html;
  const html = await fsp.readFile(file, 'utf8');
  partialCache.set(name, { stamp, html });
  return html;
}

async function renderPage(viewFile, meta) {
  const [view, header, footer] = await Promise.all([
    fsp.readFile(path.join(VIEWS_DIR, viewFile), 'utf8'),
    loadPartial('header.html'),
    loadPartial('footer.html')
  ]);
  const tokens = {
    '{{TITLE}}': escapeHtml(meta.title),
    '{{DESCRIPTION}}': escapeHtml(meta.description),
    '{{CANONICAL}}': escapeHtml(meta.canonical),
    '{{OG_IMAGE}}': escapeHtml(meta.ogImage),
    '{{OG_TYPE}}': escapeHtml(meta.ogType || 'website'),
    '{{ROBOTS}}': meta.robots || 'index, follow',
    '{{JSONLD}}': meta.jsonld
      ? `<script type="application/ld+json">${JSON.stringify(meta.jsonld).replace(/[<>&]/g, (char) => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[char])}</script>`
      : '',
    '{{PAGE_SCRIPTS}}': meta.scripts || '',
    '{{YEAR}}': String(new Date().getFullYear()),
    ...contactTokens(meta.currency),
    ...categoryTokens()
  };
  if (meta.tokens) Object.assign(tokens, meta.tokens);
  let html = view
    .replace('<!--@header-->', header)
    .replace('<!--@footer-->', footer);
  for (const [token, value] of Object.entries(tokens)) html = html.split(token).join(value);
  // A stale cached bundle must never hydrate a fresh deploy, which otherwise
  // looks like an empty storefront until the browser cache expires.
  html = html.replace(/((?:src|href)=")(\/(?:js|css)\/[^"?#]+\.(?:js|css))(")/g,
    (match, open, url, close) => {
      const version = assetVersion(url);
      return version ? `${open}${url}?v=${version}${close}` : match;
    });
  return html;
}

const missingViewWarnings = new Set();

async function servePage(req, res, viewFile, meta) {
  try {
    const origin = baseUrl(req);
    const canonical = origin + meta.path;
    const ogImage = /^https?:\/\//.test(meta.ogImage || '') ? meta.ogImage : origin + (meta.ogImage || '/images/hero-cosmetics.jpg');
    const html = await renderPage(viewFile, { ...meta, canonical, ogImage, currency: requestedCurrency(req) });
    sendHtml(res, 200, html);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // A missing template turns every page into a 404. Say which file is
      // absent and where it was expected, once per file, so a bad deploy is
      // distinguishable from a genuinely unknown URL.
      if (!missingViewWarnings.has(viewFile)) {
        missingViewWarnings.add(viewFile);
        console.error(`[views] cannot render ${viewFile}: ${error.message} (expected under ${VIEWS_DIR})`);
      }
      return notFound(req, res);
    }
    throw error;
  }
}

async function notFound(req, res) {
  try {
    const html = await renderPage('404.html', {
      title: 'Page not found — VELUNE',
      description: 'The page you were looking for has moved or no longer exists.',
      canonical: baseUrl(req) + req.url,
      ogImage: `${baseUrl(req)}/images/hero-cosmetics.jpg`,
      robots: 'noindex, follow',
      scripts: ''
    });
    sendHtml(res, 404, html);
  } catch {
    sendText(res, 404, 'Page not found');
  }
}

// ---------------------------------------------------------------- API routes

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (!['GET', 'HEAD'].includes(req.method)) assertSameOrigin(req);

  if (req.method === 'GET' && pathname === '/api/health') {
    const report = healthReport();
    return sendJson(res, report.ok ? 200 : 503, report);
  }

  if (req.method === 'GET' && pathname === '/api/products') {
    return sendJson(res, 200, {
      products: db.products.map(enrichProduct),
      categories: db.categories
    });
  }

  const productMatch = pathname.match(/^\/api\/products\/([a-z0-9-]+)$/);
  if (req.method === 'GET' && productMatch) {
    const product = db.products.find((entry) => entry.slug === productMatch[1]);
    if (!product) return sendJson(res, 404, { error: 'Product not found' });
    const related = db.products.filter((entry) => entry.category === product.category && entry.slug !== product.slug).slice(0, 4);
    return sendJson(res, 200, { product: enrichProduct(product), related: related.map(enrichProduct) });
  }

  if (req.method === 'GET' && pathname === '/api/currency') {
    const cfg = currencyConfig();
    const active = requestedCurrency(req);
    return sendJson(res, 200, {
      active,
      default: cfg.display,
      base: 'USD',
      inrPerUsd: cfg.inrPerUsd,
      symbols: { USD: cfg.symbolUsd, INR: cfg.symbolInr },
      // Prices are stored in USD; the client converts with this rate so the
      // cart, checkout and catalogue agree without another round trip.
      options: [
        { code: 'USD', label: 'USD', symbol: cfg.symbolUsd },
        { code: 'INR', label: 'INR', symbol: cfg.symbolInr }
      ]
    });
  }

  if (req.method === 'POST' && pathname === '/api/currency') {
    const body = await readJson(req);
    const code = clampStr(body.code, 4).toUpperCase();
    if (!['USD', 'INR'].includes(code)) return sendJson(res, 422, { error: 'Choose USD or INR.' });
    const cfg = currencyConfig();
    return sendJson(res, 200, {
      active: code,
      inrPerUsd: cfg.inrPerUsd,
      symbols: { USD: cfg.symbolUsd, INR: cfg.symbolInr },
      message: code === 'INR' ? `Prices shown in Indian rupees at ₹${cfg.inrPerUsd} to the dollar.` : 'Prices shown in US dollars.',
      currency: { active: code, default: cfg.display, base: 'USD', inrPerUsd: cfg.inrPerUsd, options: [
        { code: 'USD', label: 'USD', symbol: cfg.symbolUsd },
        { code: 'INR', label: 'INR', symbol: cfg.symbolInr }
      ] }
    }, { 'Set-Cookie': currencyCookie(req, code) });
  }

  if (req.method === 'GET' && pathname === '/api/shipping') {
    return sendJson(res, 200, {
      methods: SHIPPING_METHODS,
      freeThreshold: FREE_SHIPPING_THRESHOLD,
      promosAvailable: Object.keys(PROMOS),
      states: [...US_STATES].sort(),
      countries: [
        { code: 'IN', label: 'India', states: IN_STATE_LABELS, zipLabel: 'PIN code', zipPattern: '^\\d{6}$', phoneExample: '98765 43210' },
        { code: 'US', label: 'United States', states: [...US_STATES].sort(), zipLabel: 'ZIP code', zipPattern: '^\\d{5}(-\\d{4})?$', phoneExample: '+1 415 555 0132' }
      ]
    });
  }

  if (req.method === 'POST' && pathname === '/api/newsletter') {
    rateLimit(req, 'newsletter', 8, 60_000);
    const body = await readJson(req);
    if (clampStr(body.website, 20)) return sendJson(res, 200, { ok: true });
    const email = clampStr(body.email, 254).toLowerCase();
    if (!isEmail(email)) return sendJson(res, 422, { error: 'Enter a valid email address.' });
    if (db.subscribers.some((entry) => entry.email === email)) {
      return sendJson(res, 200, { ok: true, message: 'You are already on the list.' });
    }
    store.putSubscriber(email);
    return sendJson(res, 201, { ok: true, message: 'You are on the list. One considered email a month.' });
  }

  if (req.method === 'POST' && pathname === '/api/support/ticket') {
    rateLimit(req, 'ticket', 6, 10 * 60_000);
    const body = await readJson(req);
    if (clampStr(body.website, 20)) return sendJson(res, 201, { ok: true, ticket: { id: 'T-hidden' } });
    const name    = clampStr(body.name, 80);
    const phone   = clampStr(body.phone, 30);
    const message = clampStr(body.message, 1500);
    if (name.length < 2)    return sendJson(res, 422, { error: 'Please enter your name.' });
    if (phone.length < 7)   return sendJson(res, 422, { error: 'Please enter your phone / WhatsApp number.' });
    if (message.length < 5) return sendJson(res, 422, { error: 'Please add a little more detail.' });
    const account = currentCustomer(req);
    const timestamp = now();
    const senderName = name || (account ? `${account.firstName} ${account.lastName}`.trim() : 'Customer');
    const ticket = {
      id: `T-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      visitorId: visitorIdOf(body.visitorId),
      name: senderName,
      phone,
      email: clampStr(body.email, 254).toLowerCase() || '',
      subject: clampStr(body.subject, 120) || 'General enquiry',
      message,
      orderNumber: clampStr(body.orderNumber, 20).toUpperCase() || null,
      customerId: account?.id || null,
      status: 'open',
      createdAt: timestamp,
      lastMessageAt: timestamp,
      unread: { admin: 1, customer: 0 },
      thread: [{
        id: `msg_${crypto.randomBytes(6).toString('hex')}`,
        from: 'customer',
        senderName,
        text: message,
        paymentInfo: null,
        at: timestamp
      }]
    };
    saveConversation(ticket);
    broadcastUnread();
    return sendJson(res, 201, { ok: true, ticket: conversationSummary(ticket), message: 'Chat started.' });
  }

  // Customer sends a follow-up message
  const ticketReplyMatch = pathname.match(/^\/api\/support\/ticket\/(T-[A-F0-9]+)\/reply$/);
  if (req.method === 'POST' && ticketReplyMatch) {
    rateLimit(req, 'ticket-reply', 20, 5 * 60_000);
    const body  = await readJson(req);
    const phone = clampStr(body.phone, 30);
    const text  = clampStr(body.text, 1500);
    if (text.length < 1) return sendJson(res, 422, { error: 'Message is empty.' });
    const ticket = conversationById(ticketReplyMatch[1]);
    if (!ticket || ticket.phone !== phone) return sendJson(res, 404, { error: 'Chat not found. Check your Chat ID and phone number.' });
    const msg = makeMessage('customer', ticket.name || 'Customer', text);
    await appendMessage(ticket, msg, { reopen: true });
    return sendJson(res, 201, { ok: true, message: msg });
  }

  // ── live chat (customer side) ──────────────────────────────
  if (req.method === 'GET' && pathname === '/api/chat/state') {
    const visitorId = visitorIdOf(url.searchParams.get('visitorId'));
    const customer = currentCustomer(req);
    const conversation = visitorId || customer ? findVisitorConversation(visitorId, customer) : null;
    return sendJson(res, 200, {
      visitorId,
      conversation: conversation ? conversationForCustomer(conversation) : null,
      payments: publicPayments(),
      support: supportStatus()
    });
  }

  if (req.method === 'POST' && pathname === '/api/chat/start') {
    rateLimit(req, 'chat-start', 12, 10 * 60_000);
    const body = await readJson(req);
    const visitorId = visitorIdOf(body.visitorId) || `vis_${crypto.randomBytes(9).toString('base64url')}`;
    const customer = currentCustomer(req);
    const requestedOrder = clampStr(body.orderNumber, 20).toUpperCase();
    const orderNumber = /^VLN-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(requestedOrder) ? requestedOrder : '';
    const conversation = startConversation({
      visitorId,
      customer,
      name: clampStr(body.name, 80),
      email: clampStr(body.email, 254).toLowerCase(),
      phone: clampStr(body.phone, 30),
      orderNumber,
      source: clampStr(body.source, 20) || 'widget',
      firstMessage: clampStr(body.message, CHAT_TEXT_MAX)
    });
    return sendJson(res, 201, {
      ok: true,
      visitorId,
      conversation: conversationForCustomer(conversation),
      payments: publicPayments(),
      support: supportStatus()
    });
  }

  if (req.method === 'POST' && pathname === '/api/chat/message') {
    rateLimit(req, 'chat-message', 40, 60_000);
    const body = await readJson(req);
    const conversation = conversationById(body.conversationId);
    requireConversationAccess(conversation, body, req);
    const text = clampStr(body.text, CHAT_TEXT_MAX);
    const attachment = attachmentFrom(body.attachment);
    if (!text && !attachment) return sendJson(res, 422, { error: 'Write a message first.' });
    const message = makeMessage(
      'customer',
      conversation.name || 'You',
      text || (attachment?.kind === 'slip' ? 'Payment slip uploaded.' : 'Photo attached.'),
      { attachment, orderNumber: conversation.orderNumber || undefined }
    );
    await appendMessage(conversation, message, { reopen: true });
    typingByConversation.delete(conversation.id);
    return sendJson(res, 201, { ok: true, message, conversation: conversationSummary(conversation) });
  }

  if (req.method === 'POST' && pathname === '/api/chat/typing') {
    const body = await readJson(req);
    const conversation = conversationById(body.conversationId);
    requireConversationAccess(conversation, body, req);
    typingByConversation.set(conversation.id, Date.now());
    emitChat(conversation.id, 'typing', { typing: Boolean(body.typing) });
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/chat/read') {
    const body = await readJson(req);
    const conversation = conversationById(body.conversationId);
    requireConversationAccess(conversation, body, req);
    if (conversation.unread?.customer) {
      conversation.unread.customer = 0;
      store.putConversation(conversation);
    }
    emitChat(conversation.id, 'seen', { at: now() });
    return sendJson(res, 200, { ok: true });
  }

  // Payment slip or photo from the chat composer.
  if (req.method === 'POST' && pathname === '/api/chat/attachment') {
    rateLimit(req, 'chat-attachment', 10, 10 * 60_000);
    const body = await readJson(req, 7_500_000);
    const conversation = conversationById(body.conversationId);
    requireConversationAccess(conversation, body, req);
    const saved = await saveImage(body.data, { directory: PROOFS_DIR, prefix: 'proof' });
    return sendJson(res, 201, { ...saved, kind: clampStr(body.kind, 20) === 'image' ? 'image' : 'slip' });
  }

  if (req.method === 'POST' && pathname === '/api/chat/stream-ticket') {
    const body = await readJson(req);
    const conversation = conversationById(body.conversationId);
    requireConversationAccess(conversation, body, req);
    return sendJson(res, 200, { token: issueSseTicket({ conversationId: conversation.id }) });
  }

  const chatStreamTicket = readSseToken(url.searchParams.get('sset'));
  if (req.method === 'GET' && pathname === '/api/chat/stream' && chatStreamTicket?.conversationId) {
    const conversation = conversationById(chatStreamTicket.conversationId);
    if (!conversation) return sendJson(res, 404, { error: 'Chat not found.' });
    openSse(req, res, `chat:${conversation.id}`, { maxClients: 6 });
    presenceByConversation.set(conversation.id, (presenceByConversation.get(conversation.id) || 0) + 1);
    broadcastPresence();
    if (conversation.unread?.customer) {
      conversation.unread.customer = 0;
      store.putConversation(conversation);
    }
    sseWrite(res, 'hello', {
      conversation: conversationForCustomer(conversation),
      payments: publicPayments(),
      support: supportStatus()
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/promo') {
    rateLimit(req, 'promo', 30, 60_000);
    const body = await readJson(req);
    const code = clampStr(body.code, 30).toUpperCase();
    const promo = PROMOS[code];
    if (!promo) return sendJson(res, 422, { error: 'That code is not recognised.' });
    return sendJson(res, 200, { code, label: promo.label, type: promo.type, value: promo.value });
  }

  if (req.method === 'POST' && pathname === '/api/orders') {
    rateLimit(req, 'orders', 20, 60_000);
    const body = await readJson(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length || items.length > 20) throw httpError(422, 'Your cart appears to be empty.');
    const idempotencyKey = clampStr(body.idempotencyKey, 100);
    const emailInput = clampStr(body.customer?.email, 254).toLowerCase();
    const duplicate = idempotencyKey
      ? db.orders.find((order) => order.idempotencyKey === idempotencyKey && order.customer.email === emailInput)
      : null;
    if (duplicate) return sendJson(res, 200, { order: publicOrder(duplicate), token: duplicate.token, duplicate: true });

    const { customer, shipping } = validateAddress(body);
    const account = currentCustomer(req);
    // Signed-in customers must clear the checks that apply to them before an
    // order is accepted; guests are unaffected, as before.
    if (account) requireFeature(account, 'checkout');
    const methodKey = clampStr(body.shippingMethod, 20) || 'standard';
    if (!SHIPPING_METHODS[methodKey]) throw httpError(422, 'Choose a valid shipping method.');

    const lineItems = [];
    let subtotal = 0;
    for (const item of items) {
      const product = db.products.find((entry) => entry.slug === clampStr(item.slug, 80));
      const qty = Number(item.qty);
      if (!product) throw httpError(422, 'A product in your cart is no longer available.');
      if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw httpError(422, `Choose a quantity between 1 and 10 for ${product.name}.`);
      if (product.stock < qty) throw httpError(409, `Only ${product.stock} left of ${product.name}.`);
      subtotal += product.price * qty;
      lineItems.push({
        slug: product.slug,
        name: product.name,
        price: product.price,
        // Cost is snapshotted so profit history stays correct after the admin
        // reprices the product. It is stripped from every customer-facing read.
        unitCost: Number.isFinite(product.baseCost) ? product.baseCost : null,
        qty,
        variant: clampStr(item.variant, 80) || (product.variants[0]?.options[0] ?? ''),
        image: photoPathFor(product) ? product.image : ''
      });
    }
    subtotal = round2(subtotal);

    const promo = calculatePromo(body.promoCode, subtotal, methodKey);
    const merchandiseTotal = round2(subtotal - promo.discount);
    const shipCost = shippingPrice(methodKey, merchandiseTotal, promo.shipping);
    const tax = 0;
    const total = round2(merchandiseTotal + shipCost + tax);
    if (total <= 0) throw httpError(422, 'Order total is not valid.');

    for (const line of lineItems) {
      const product = db.products.find((entry) => entry.slug === line.slug);
      product.stock -= line.qty;
      store.putProduct(product);
      line.image = photoPathFor(product) ? product.image : '';
    }

    const number = newOrderNumber();
    const token = crypto.randomBytes(24).toString('hex');
    const timestamp = now();
    const chosenPaymentMethod = clampStr(body.paymentMethod, 40);
    const paymentMethod = PAYMENT_METHODS.includes(chosenPaymentMethod) ? chosenPaymentMethod : 'Bank Transfer';
    const paymentStatus = COD_METHODS.has(paymentMethod) ? 'Payment on delivery' : 'Awaiting Payment';
    const paymentReference = clampStr(body.paymentReference, 80);
    const order = {
      id: `ord_${crypto.randomBytes(8).toString('hex')}`,
      number,
      token,
      idempotencyKey: idempotencyKey || null,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'Confirmed',
      paymentMethod,
      paymentStatus,
      paymentReference,
      paymentProof: [],
      proofReviewNote: '',
      customerId: account?.id || null,
      customer,
      shipping,
      items: lineItems,
      subtotal,
      discount: promo.discount,
      promoCode: promo.code,
      shippingMethod: methodKey,
      shippingCost: shipCost,
      tax,
      total,
      currency: 'USD',
      displayCurrency: currencyConfig().display,
      displayTotal: amountIn(currencyConfig().display, total),
      notes: clampStr(body.notes, 500),
      trackingNumber: null,
      statusHistory: [{ status: 'Confirmed', at: timestamp }],
      paymentHistory: [{ status: paymentStatus, at: timestamp }],
      restocked: false
    };
    store.putOrder(order);
    return sendJson(res, 201, { order: publicOrder(order), token, whatsapp: whatsappOrderUrl(order) });
  }

  const orderMatch = pathname.match(/^\/api\/orders\/(VLN-[A-Z0-9]{4}-[A-Z0-9]{4})$/i);
  if (req.method === 'GET' && orderMatch) {
    rateLimit(req, 'order-read', 60, 60_000);
    const token = clampStr(url.searchParams.get('token'), 80);
    const order = findOrder(orderMatch[1], null, token);
    if (!order) return sendJson(res, 404, { error: 'Order not found. Check your link or look it up with your email.' });
    return sendJson(res, 200, { order: publicOrder(order), whatsapp: whatsappOrderUrl(order) });
  }

  if (req.method === 'POST' && pathname === '/api/orders/lookup') {
    rateLimit(req, 'order-lookup', 10, 10 * 60_000);
    const body = await readJson(req);
    const number = clampStr(body.number, 20).toUpperCase();
    const email = clampStr(body.email, 254).toLowerCase();
    if (!/^VLN-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(number)) return sendJson(res, 422, { error: 'Enter a valid order number (e.g. VLN-AB12-CD34).' });
    if (!isEmail(email)) return sendJson(res, 422, { error: 'Enter the email used at checkout.' });
    const order = findOrder(number, email, null);
    if (!order) return sendJson(res, 404, { error: 'No order matches that number and email.' });
    return sendJson(res, 200, { order: publicOrder(order), token: order.token, whatsapp: whatsappOrderUrl(order) });
  }

  // ------------------------------------------------------------ payments

  if (req.method === 'GET' && pathname === '/api/payments') {
    return sendJson(res, 200, publicPayments());
  }

  // Customer uploads the payment slip / screenshot for an order they hold.
  const orderProofMatch = pathname.match(/^\/api\/orders\/(VLN-[A-Z0-9]{4}-[A-Z0-9]{4})\/proof$/i);
  if (req.method === 'POST' && orderProofMatch) {
    rateLimit(req, 'order-proof', 8, 10 * 60_000);
    const body = await readJson(req, 7_500_000);
    const bodyToken = clampStr(body.token, 80);
    const account = currentCustomer(req);
    const order = db.orders.find((entry) => entry.number === orderProofMatch[1].toUpperCase());
    if (!order) return sendJson(res, 404, { error: 'Order not found. Open it with the link we sent.' });
    const authorized = (bodyToken && safeEqual(order.token, bodyToken)) || Boolean(account && order.customerId === account.id);
    if (!authorized) return sendJson(res, 403, { error: 'Use the order link we sent, or sign in to upload a slip.' });
    if (order.status === 'Cancelled') return sendJson(res, 422, { error: 'This order was cancelled.' });
    if (order.paymentStatus === 'Paid') return sendJson(res, 422, { error: 'This order is already marked as paid.' });
    const saved = await saveImage(body.data, { directory: PROOFS_DIR, prefix: 'slip' });
    const proof = {
      id: `prf_${crypto.randomBytes(6).toString('hex')}`,
      ...saved,
      method: PAYMENT_METHODS.includes(clampStr(body.method, 40)) ? clampStr(body.method, 40) : order.paymentMethod,
      reference: clampStr(body.reference, 80),
      uploadedAt: now(),
      status: 'pending'
    };
    if (!Array.isArray(order.paymentProof)) order.paymentProof = [];
    order.paymentProof.push(proof);
    if (proof.reference) order.paymentReference = proof.reference;
    order.paymentStatus = 'Proof submitted';
    order.proofReviewNote = '';
    if (!order.paymentHistory) order.paymentHistory = [];
    order.paymentHistory.push({ status: 'Proof submitted', at: proof.uploadedAt });
    order.updatedAt = proof.uploadedAt;
    store.putOrder(order);
    notifyOrderProof(order, proof);
    return sendJson(res, 201, { order: publicOrder(order), proof, message: 'Slip received. We will confirm your payment shortly.' });
  }

  // ------------------------------------------------------------ customer accounts

  if (req.method === 'POST' && pathname === '/api/auth/register') {
    rateLimit(req, 'register', 6, 10 * 60_000);
    const body = await readJson(req, 8_000_000);
    if (clampStr(body.website, 20)) return sendJson(res, 201, { ok: true });

    // Accept either a single full name or the legacy first/last pair, so the
    // storefront form and any older integration both keep working.
    const fullName = clampStr(body.fullName, 120);
    let firstName = clampStr(body.firstName, 60);
    let lastName = clampStr(body.lastName, 60);
    if (fullName && !firstName) {
      const parts = fullName.split(/\s+/).filter(Boolean);
      firstName = parts.shift() || '';
      lastName = parts.join(' ');
    }
    if (!firstName && !lastName && fullName) {
      firstName = fullName;
      lastName = '';
    }
    const email = clampStr(body.email, 254).toLowerCase();
    const mobile = normaliseMobile(body.mobile ?? body.phone);
    const password = String(body.password ?? '');
    const confirmPassword = String(body.confirmPassword ?? body.confirmPasswordCheck ?? password);

    if (firstName.length < 2) return sendJson(res, 422, { error: 'Please enter your full name.' });
    if (lastName.length < 2 && !fullName) return sendJson(res, 422, { error: 'Please enter your surname.' });
    if (!isEmail(email)) return sendJson(res, 422, { error: 'Enter a valid email address.' });
    if (!mobile) {
      return sendJson(res, 422, { error: 'Enter a valid mobile number, for example 98765 43210 or +1 415 555 0132.' });
    }
    if (password.length < 10) return sendJson(res, 422, { error: 'Choose a password with at least 10 characters.' });
    if (password.length > 200) return sendJson(res, 422, { error: 'That password is too long.' });
    if (confirmPassword !== password) return sendJson(res, 422, { error: 'The two passwords do not match.' });
    if (db.customers.some((customer) => customer.email === email)) {
      return sendJson(res, 409, { error: 'An account with this email already exists. Try signing in.' });
    }
    if (db.customers.some((customer) => customer.phone === mobile)) {
      return sendJson(res, 409, { error: 'An account with this mobile number already exists. Try signing in.' });
    }
    // Optional profile picture — the field is collected at sign-up but never
    // published; it is written under data/private/profiles.
    const avatarName = body.profilePicture ? await savePrivateProfilePicture(body.profilePicture) : null;

    const timestamp = now();
    const customer = {
      id: `cust_${crypto.randomBytes(8).toString('hex')}`,
      firstName,
      lastName,
      email,
      phone: mobile,
      phoneCountry: mobileCountry(mobile),
      passwordHash: await hashPassword(password),
      marketingOptIn: Boolean(body.marketingOptIn),
      profilePicture: avatarName,
      emailVerifiedAt: '',
      phoneVerifiedAt: '',
      kycStatus: 'unverified',
      kycNote: '',
      sessionVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    store.putCustomer(customer);

    const dispatch = [];
    for (const [purpose, identifier, transport] of [
      ['email', email, 'email'],
      ['phone', mobile, 'sms']
    ]) {
      try {
        const result = await issueOtp({ purpose, identifier, channel: transport, displayName: firstName });
        // The code itself is only ever mirrored back when no provider is
        // configured and OTP_DEV_ECHO is set explicitly.
        dispatch.push({
          purpose,
          transport,
          sentVia: result.channel,
          delivered: result.delivered,
          error: result.error,
          expiresInSeconds: result.expiresInSeconds,
          resendAfterSeconds: result.resendAfterSeconds,
          ...(result.devCode ? { code: result.devCode, devMode: true } : {})
        });
      } catch (error) {
        if (error?.status !== 429) throw error;
        dispatch.push({ purpose, transport, sentVia: 'queued', delivered: false, error: error.message });
      }
    }

    // Documents may arrive with the sign-up; the customer can also upload them
    // later from the account page.
    let documentResult = null;
    if (body.document?.front || body.document?.back) {
      documentResult = await storeUploadedDocuments(customer, firstName, body.document);
    }
    const refreshed = refreshKycStatus(store.findCustomerById(customer.id));

    return sendJson(
      res,
      201,
      {
        customer: publicCustomer(refreshed),
        token: signCustomerToken(refreshed),
        verification: verificationPayload(refreshed),
        codes: dispatch,
        documents: documentResult ? { docType: documentResult.docType, uploaded: documentResult.uploaded } : null,
        message: 'Account created. Enter the two codes we sent to finish verifying your details.'
      },
      { 'Set-Cookie': customerCookie(req, signCustomerToken(refreshed), SESSION_TTL) }
    );
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    rateLimit(req, 'login', 10, 10 * 60_000);
    const body = await readJson(req);
    const email = clampStr(body.email, 254).toLowerCase();
    const password = String(body.password ?? '');
    const customer = db.customers.find((entry) => entry.email === email);
    const valid = customer ? await verifyPassword(password, customer.passwordHash) : false;
    if (!valid) {
      return sendJson(res, 401, { error: 'Email or password is not correct.' });
    }
    customer.lastLoginAt = now();
    store.putCustomer(customer);
    return sendJson(
      res,
      200,
      { customer: publicCustomer(customer), token: signCustomerToken(customer) },
      { 'Set-Cookie': customerCookie(req, signCustomerToken(customer), SESSION_TTL) }
    );
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': customerCookie(req, '', 0) });
  }

  if (req.method === 'GET' && pathname === '/api/auth/session') {
    const customer = currentCustomer(req);
    return sendJson(res, 200, {
      customer: customer ? publicCustomer(customer) : null,
      verification: customer ? verificationPayload(customer) : null
    });
  }

  // ------------------------------------------------------ verification (OTP + documents)

  if (req.method === 'POST' && pathname === '/api/auth/otp/request') {
    rateLimit(req, 'otp-request', 12, 10 * 60_000);
    const customer = requireCustomer(req);
    const body = await readJson(req);
    const purpose = clampStr(body.purpose, 20);
    if (!['email', 'phone'].includes(purpose)) return sendJson(res, 422, { error: 'Choose email or phone.' });
    const identifier = purpose === 'email' ? customer.email : customer.phone;
    if (!identifier) return sendJson(res, 422, { error: 'Add that contact detail to your account first.' });
    if (purpose === 'email' ? customer.emailVerifiedAt : customer.phoneVerifiedAt) {
      return sendJson(res, 422, { error: 'That detail is already verified.' });
    }
    const result = await issueOtp({
      purpose,
      identifier,
      channel: purpose === 'email' ? 'email' : 'sms',
      displayName: customer.firstName
    });
    const { devCode, ...safe } = result;
    return sendJson(res, 200, {
      ...safe,
      code: devCode,
      verification: verificationPayload(customer),
      message: result.delivered
        ? `We sent a 6-digit code to ${purpose === 'email' ? customer.email : customer.phone}.`
        : 'The code is queued in the store outbox. Configure email or SMS delivery so customers receive it.'
    });
  }

  if (req.method === 'POST' && pathname === '/api/auth/otp/verify') {
    rateLimit(req, 'otp-verify', 15, 10 * 60_000);
    const customer = requireCustomer(req);
    const body = await readJson(req);
    const purpose = clampStr(body.purpose, 20);
    if (!['email', 'phone'].includes(purpose)) return sendJson(res, 422, { error: 'Choose email or phone.' });
    const identifier = purpose === 'email' ? customer.email : customer.phone;
    verifyOtp({ purpose, identifier, code: body.code });
    const timestamp = now();
    const updated = {
      ...customer,
      [purpose === 'email' ? 'emailVerifiedAt' : 'phoneVerifiedAt']: timestamp,
      updatedAt: timestamp
    };
    store.putCustomer(updated);
    const refreshed = refreshKycStatus(updated);
    return sendJson(res, 200, {
      customer: publicCustomer(refreshed),
      verification: verificationPayload(refreshed),
      message: purpose === 'email' ? 'Email address verified.' : 'Mobile number verified.'
    });
  }

  if (req.method === 'GET' && pathname === '/api/account/verification') {
    const customer = requireCustomer(req);
    return sendJson(res, 200, { verification: verificationPayload(customer) });
  }

  if (req.method === 'POST' && pathname === '/api/account/verification/documents') {
    rateLimit(req, 'documents', 8, 10 * 60_000);
    const customer = requireCustomer(req);
    const body = await readJson(req, 15_000_000);
    const result = await storeUploadedDocuments(customer, `${customer.firstName} ${customer.lastName}`.trim(), body);
    const refreshed = store.findCustomerById(customer.id);
    return sendJson(res, 201, {
      documents: { docType: result.docType, uploaded: result.uploaded },
      verification: verificationPayload(refreshed),
      message: 'Documents received. An administrator will review them shortly.'
    });
  }

  const ownDocumentMatch = pathname.match(/^\/api\/account\/verification\/documents\/(doc_[a-f0-9]{16})$/);
  if (req.method === 'DELETE' && ownDocumentMatch) {
    const customer = requireCustomer(req);
    const document = store.getDocument(ownDocumentMatch[1]);
    if (!document || document.customerId !== customer.id) return sendJson(res, 404, { error: 'Document not found.' });
    // Only a review that has not happened yet can be withdrawn, so an
    // administrator's decision is never erased by the customer.
    if (document.status !== 'pending') {
      return sendJson(res, 422, { error: 'That document has already been reviewed. Contact support to remove it.' });
    }
    store.deleteDocument(document.id);
    const refreshed = refreshKycStatus(store.findCustomerById(customer.id));
    return sendJson(res, 200, {
      verification: verificationPayload(refreshed),
      message: 'Document withdrawn.'
    });
  }

  const ownDocumentViewMatch = pathname.match(/^\/api\/account\/verification\/documents\/(doc_[a-f0-9]{16})\/view$/);
  if (req.method === 'GET' && ownDocumentViewMatch) {
    const customer = requireCustomer(req);
    return streamPrivateDocument(res, ownDocumentViewMatch[1], customer.id);
  }

  if (req.method === 'GET' && pathname === '/api/account/avatar') {
    const customer = requireCustomer(req);
    if (!customer.profilePicture) return sendJson(res, 404, { error: 'No profile picture on this account.' });
    return streamPrivateFile(res, customer.profilePicture);
  }

  if (req.method === 'POST' && pathname === '/api/account/avatar') {
    rateLimit(req, 'avatar', 12, 10 * 60_000);
    const customer = requireCustomer(req);
    const body = await readJson(req, 8_000_000);
    const storedName = await savePrivateProfilePicture(body.profilePicture ?? body.data);
    if (!storedName) return sendJson(res, 422, { error: 'Choose an image to upload.' });
    const previous = customer.profilePicture;
    const updated = { ...customer, profilePicture: storedName, updatedAt: now() };
    store.putCustomer(updated);
    if (previous) store.deletePrivateFile(previous);
    return sendJson(res, 200, { customer: publicCustomer(updated), message: 'Profile picture updated.' });
  }

  if (req.method === 'GET' && pathname === '/api/account/orders') {
    rateLimit(req, 'account-orders', 60, 60_000);
    const customer = requireCustomer(req);
    // Only orders explicitly linked at checkout are disclosed. Matching by email
    // would let anyone who registers with an address read that person's orders.
    const orders = db.orders
      .filter((order) => order.customerId === customer.id)
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
    // The private token is only released to the signed-in owner so links to the
    // confirmation page keep working without weakening public order lookup.
    return sendJson(res, 200, { orders: orders.map((order) => ({ ...publicOrder(order), token: order.token })) });
  }

  if (req.method === 'PATCH' && pathname === '/api/account') {
    const customer = requireCustomer(req);
    const body = await readJson(req);
    if (body.firstName !== undefined) {
      const firstName = clampStr(body.firstName, 60);
      if (firstName.length < 2) return sendJson(res, 422, { error: 'Please enter your first name.' });
      customer.firstName = firstName;
    }
    if (body.lastName !== undefined) {
      const lastName = clampStr(body.lastName, 60);
      if (lastName.length < 2) return sendJson(res, 422, { error: 'Please enter your last name.' });
      customer.lastName = lastName;
    }
    let phoneChanged = false;
    if (body.phone !== undefined) {
      const phone = normaliseMobile(body.phone);
      if (!phone) return sendJson(res, 422, { error: 'Enter a valid mobile number, for example 98765 43210 or +1 415 555 0132.' });
      if (phone !== customer.phone) {
        if (db.customers.some((entry) => entry.id !== customer.id && entry.phone === phone)) {
          return sendJson(res, 409, { error: 'An account with this mobile number already exists.' });
        }
        customer.phone = phone;
        customer.phoneCountry = mobileCountry(phone);
        // The old number's proof does not carry over to the new one.
        customer.phoneVerifiedAt = '';
        phoneChanged = true;
      }
    }
    if (body.marketingOptIn !== undefined) customer.marketingOptIn = Boolean(body.marketingOptIn);
    customer.updatedAt = now();
    store.putCustomer(customer);
    const refreshed = phoneChanged ? refreshKycStatus(customer) : customer;
    return sendJson(res, 200, { customer: publicCustomer(refreshed), message: 'Profile updated.' });
  }

  if (req.method === 'POST' && pathname === '/api/account/password') {
    rateLimit(req, 'password-change', 10, 60 * 60_000);
    const customer = requireCustomer(req);
    const body = await readJson(req);
    const currentPassword = String(body.currentPassword ?? '');
    const newPassword = String(body.newPassword ?? '');
    if (!(await verifyPassword(currentPassword, customer.passwordHash))) {
      return sendJson(res, 401, { error: 'Your current password is not correct.' });
    }
    if (newPassword.length < 8) return sendJson(res, 422, { error: 'Use at least 8 characters for your new password.' });
    if (newPassword.length > 200) return sendJson(res, 422, { error: 'That password is too long.' });
    customer.passwordHash = await hashPassword(newPassword);
    customer.sessionVersion = (Number(customer.sessionVersion) || 1) + 1;
    customer.updatedAt = now();
    store.putCustomer(customer);
    return sendJson(
      res,
      200,
      { ok: true, token: signCustomerToken(customer), message: 'Password updated. Other devices have been signed out.' },
      { 'Set-Cookie': customerCookie(req, signCustomerToken(customer), SESSION_TTL) }
    );
  }

  // ------------------------------------------------------------ reseller store

  const STORE_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'suspended'];
  const STORE_SLUG_RESERVED = new Set(['shop', 'store', 'stores', 'product', 'admin', 'account', 'checkout', 'order', 'cart', 'contact', 'policies', 'api', 'login', 'register', 'support', 'new', 'sale']);

  function storeOwner(record) {
    return record ? db.customers.find((entry) => entry.id === record.customerId) || null : null;
  }

  // A store is visible only while the administrator has approved it and its
  // owner still passes the checks that unlock reseller access. Suspending a
  // customer's verification quietly takes the storefront offline with it.
  function storeIsLive(record) {
    if (!record || record.status !== 'approved') return false;
    const owner = storeOwner(record);
    return Boolean(owner && canUseFeature(owner, 'reseller'));
  }

  function publicStore(record, { includeReview = false } = {}) {
    if (!record) return null;
    const owner = storeOwner(record);
    return {
      id: record.id,
      slug: record.slug,
      name: record.name,
      tagline: record.tagline || '',
      about: record.about || '',
      contactEmail: record.contactEmail || '',
      status: record.status,
      live: storeIsLive(record),
      ownerName: owner ? `${owner.firstName} ${owner.lastName}` : '',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      approvedAt: record.approvedAt || null,
      reviewNote: includeReview ? record.reviewNote || '' : undefined
    };
  }

  function storeItem(entry) {
    const product = db.products.find((candidate) => candidate.slug === entry.slug);
    if (!product) return null;
    const price = Number.isFinite(entry.price) && entry.price > 0 ? entry.price : product.price;
    const photo = photoPathFor(product);
    return {
      ...withCurrency(stripCost({ ...product, price, stock: entry.qty })),
      image: photo ? versionedAsset(photo) : '',
      stock: entry.qty,
      inStock: entry.qty > 0,
      cardImage: versionedAsset(cardImageFor(product)),
      artwork: '',
      photoRequired: !photo,
      categoryName: categoryName(product.category),
      resellerPrice: price,
      published: Boolean(entry.published),
      updatedAt: entry.updatedAt
    };
  }

  function validateStoreProfile(body, customer, existing = null) {
    const name = clampStr(body.name, 70);
    if (name.length < 2) throw httpError(422, 'Give your store a name of at least two characters.');
    const requested = clampStr(body.slug, 80).toLowerCase();
    const slug = requested ? slugify(requested).slice(0, 40) : slugify(name).slice(0, 40);
    if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) {
      throw httpError(422, 'Use 3–40 letters, numbers or dashes for the store address.');
    }
    if (STORE_SLUG_RESERVED.has(slug)) throw httpError(422, 'That store address is reserved. Choose another.');
    const clash = store.findStoreBySlug(slug);
    if (clash && clash.id !== existing?.id) throw httpError(409, 'That store address is already taken.');
    const contactEmail = clampStr(body.contactEmail, 254).toLowerCase() || customer.email;
    if (!isEmail(contactEmail)) throw httpError(422, 'Enter a valid contact email for your store.');
    return {
      name,
      slug,
      tagline: clampStr(body.tagline, 120),
      about: clampStr(body.about, 1200),
      contactEmail
    };
  }

  if (req.method === 'GET' && pathname === '/api/account/store') {
    rateLimit(req, 'store-read', 60, 60_000);
    const customer = requireCustomer(req);
    const record = store.findStoreForCustomer(customer.id);
    const inventory = store.listInventory(customer.id)
      .map((entry) => ({ ...entry, product: storeItem(entry) }))
      .filter((entry) => entry.product);
    return sendJson(res, 200, {
      store: publicStore(record, { includeReview: true }),
      inventory,
      canReseller: canUseFeature(customer, 'reseller')
    });
  }

  if (req.method === 'POST' && pathname === '/api/account/store') {
    rateLimit(req, 'store-write', 20, 60_000);
    const customer = requireCustomer(req);
    const body = await readJson(req);
    const existing = store.findStoreForCustomer(customer.id);
    const profile = validateStoreProfile(body, customer, existing);
    const timestamp = now();
    // Editing a pending or rejected application returns it to draft so stale
    // details are never approved unseen. Approved and suspended stores keep
    // their state and simply update their public details.
    const nextStatus = existing
      ? ['pending', 'rejected'].includes(existing.status)
        ? 'draft'
        : existing.status
      : 'draft';
    const record = store.putStore({
      ...(existing || {}),
      id: existing?.id || `rst_${crypto.randomBytes(8).toString('hex')}`,
      customerId: customer.id,
      ...profile,
      status: nextStatus,
      reviewNote: nextStatus === 'draft' ? '' : existing?.reviewNote || '',
      createdAt: existing?.createdAt || timestamp
    });
    return sendJson(res, existing ? 200 : 201, {
      store: publicStore(record, { includeReview: true }),
      message: existing ? 'Store details saved.' : 'Store created. Submit it for review when you are ready.'
    });
  }

  if (req.method === 'POST' && pathname === '/api/account/store/submit') {
    rateLimit(req, 'store-submit', 10, 60_000);
    const customer = requireCustomer(req);
    requireFeature(customer, 'reseller');
    const existing = store.findStoreForCustomer(customer.id);
    if (!existing) throw httpError(422, 'Create your store details before submitting.');
    if (existing.status === 'approved') return sendJson(res, 200, { store: publicStore(existing, { includeReview: true }), message: 'Your store is already approved.' });
    if (existing.status === 'suspended') throw httpError(403, 'This store is suspended. Contact support before resubmitting.');
    const record = store.putStore({ ...existing, status: 'pending', reviewNote: '', submittedAt: now() });
    return sendJson(res, 200, { store: publicStore(record, { includeReview: true }), message: 'Store submitted. An administrator will review it shortly.' });
  }

  if (req.method === 'POST' && pathname === '/api/account/store/add') {
    rateLimit(req, 'store-add', 30, 60_000);
    const customer = requireCustomer(req);
    requireFeature(customer, 'reseller');
    const body = await readJson(req);
    const slug = clampStr(body.slug, 80);
    const qty = Math.min(Math.max(1, Number(body.qty) || 1), 100);
    const product = db.products.find((p) => p.slug === slug);
    if (!product) return sendJson(res, 404, { error: 'Product not found.' });
    if (product.stock < qty) return sendJson(res, 409, { error: `Only ${product.stock} units available in stock.` });
    const requestedPrice = body.price === undefined || body.price === '' ? product.price : Number(body.price);
    if (!Number.isFinite(requestedPrice) || requestedPrice < product.price) {
      return sendJson(res, 422, { error: `Your selling price cannot be below the wholesale price of ${formatMoney(product.price)}.` });
    }
    if (requestedPrice > 100000) return sendJson(res, 422, { error: 'That selling price is too high.' });

    const existing = store.getInventory(customer.id, slug);
    store.putInventory({
      ...(existing || {}),
      customerId: customer.id,
      slug,
      qty: (existing?.qty || 0) + qty,
      price: round2(requestedPrice),
      published: existing?.published || false,
      updatedAt: now()
    });
    product.stock -= qty;
    store.putProduct(product);
    const inventory = store.listInventory(customer.id)
      .map((entry) => ({ ...entry, product: storeItem(entry) }))
      .filter((entry) => entry.product);
    return sendJson(res, 200, { ok: true, inventory, message: `${qty} × ${product.name} added to your store.` });
  }

  const storeItemMatch = pathname.match(/^\/api\/account\/store\/items\/([a-z0-9-]+)$/);
  if (storeItemMatch) {
    const customer = requireCustomer(req);
    const slug = storeItemMatch[1];
    const entry = store.getInventory(customer.id, slug);
    const product = db.products.find((candidate) => candidate.slug === slug);
    if (!entry || !product) return sendJson(res, 404, { error: 'That product is not in your store.' });

    if (req.method === 'PATCH') {
      rateLimit(req, 'store-item', 60, 60_000);
      requireFeature(customer, 'reseller');
      const body = await readJson(req);
      const record = store.findStoreForCustomer(customer.id);
      let price = entry.price;
      if (body.price !== undefined) {
        const parsed = Number(body.price);
        if (!Number.isFinite(parsed) || parsed < product.price) {
          return sendJson(res, 422, { error: `Set a price at or above the wholesale price of ${formatMoney(product.price)}.` });
        }
        if (parsed > 100000) return sendJson(res, 422, { error: 'That selling price is too high.' });
        price = round2(parsed);
      }
      let published = entry.published;
      if (body.published !== undefined) {
        published = Boolean(body.published);
        if (published && record?.status !== 'approved') {
          return sendJson(res, 409, { error: 'Your store must be approved before items can be published.' });
        }
      }
      store.putInventory({ ...entry, price, published, updatedAt: now() });
      const updated = store.getInventory(customer.id, slug);
      return sendJson(res, 200, {
        item: { ...updated, product: storeItem(updated) },
        message: published ? `${product.name} is published on your storefront.` : 'Store item updated.'
      });
    }

    if (req.method === 'DELETE') {
      rateLimit(req, 'store-remove', 30, 60_000);
      requireFeature(customer, 'reseller');
      // Stock was reserved from the main catalogue when it was imported, so
      // removing it returns those unsold units to the shelf.
      const remaining = Number(entry.qty) || 0;
      if (remaining > 0) {
        product.stock += remaining;
        store.putProduct(product);
      }
      store.deleteInventory(customer.id, slug);
      return sendJson(res, 200, { ok: true, message: `${product.name} removed from your store.` });
    }
  }

  if (req.method === 'POST' && pathname === '/api/account/store/sell') {
    rateLimit(req, 'store-sell', 20, 60_000);
    const customer = requireCustomer(req);
    requireFeature(customer, 'reseller');
    const body = await readJson(req);
    const { customer: buyerCustomer, shipping } = validateAddress(body);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length || items.length > 20) throw httpError(422, 'Your cart appears to be empty.');

    const methodKey = clampStr(body.shippingMethod, 20) || 'standard';
    if (!SHIPPING_METHODS[methodKey]) throw httpError(422, 'Choose a valid shipping method.');

    const lineItems = [];
    let subtotal = 0;
    for (const item of items) {
      const slug = clampStr(item.slug, 80);
      const qty = Number(item.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw httpError(422, 'Invalid quantity for item.');
      const invEntry = store.getInventory(customer.id, slug);
      if (!invEntry || invEntry.qty < qty) throw httpError(409, 'Not enough stock in your store for this item.');
      const product = db.products.find((p) => p.slug === slug);
      if (!product) throw httpError(422, 'A product is no longer available.');
      const price = Number.isFinite(invEntry.price) && invEntry.price > 0 ? invEntry.price : product.price;
      subtotal += price * qty;
      lineItems.push({
        slug: product.slug,
        name: product.name,
        price,
        unitCost: Number.isFinite(product.baseCost) ? product.baseCost : null,
        qty,
        variant: clampStr(item.variant, 80) || (product.variants[0]?.options[0] ?? ''),
        image: photoPathFor(product) ? product.image : ''
      });
    }
    subtotal = round2(subtotal);

    const promo = body.promoCode ? calculatePromo(body.promoCode, subtotal, methodKey) : { code: null, discount: 0, shipping: null };
    const merchandiseTotal = round2(subtotal - promo.discount);
    const shipCost = shippingPrice(methodKey, merchandiseTotal, promo.shipping);
    const total = round2(merchandiseTotal + shipCost);
    if (total <= 0) throw httpError(422, 'Order total is not valid.');

    for (const line of lineItems) {
      const invEntry = store.getInventory(customer.id, line.slug);
      if (invEntry) {
        const remaining = invEntry.qty - line.qty;
        if (remaining <= 0) store.deleteInventory(customer.id, line.slug);
        else store.putInventory({ ...invEntry, qty: remaining, updatedAt: now() });
      }
    }

    const number = newOrderNumber();
    const token = crypto.randomBytes(24).toString('hex');
    const timestamp = now();
    const record = store.findStoreForCustomer(customer.id);
    const order = {
      id: `ord_${crypto.randomBytes(8).toString('hex')}`,
      number,
      token,
      idempotencyKey: clampStr(body.idempotencyKey, 100) || null,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'Confirmed',
      paymentMethod: 'Bank Transfer',
      paymentStatus: 'Awaiting Payment',
      customerId: null,
      resellerCustomerId: customer.id,
      storeId: record?.id || null,
      storeSlug: record?.slug || null,
      storeName: record?.name || null,
      salesChannel: 'reseller-store',
      customer: buyerCustomer,
      shipping,
      items: lineItems,
      subtotal,
      discount: promo.discount,
      promoCode: promo.code,
      shippingMethod: methodKey,
      shippingCost: shipCost,
      tax: 0,
      total,
      currency: 'USD',
      notes: clampStr(body.notes, 500),
      trackingNumber: null,
      statusHistory: [{ status: 'Confirmed', at: timestamp }],
      paymentHistory: [{ status: 'Awaiting Payment', at: timestamp }],
      restocked: false
    };
    store.putOrder(order);
    return sendJson(res, 201, { order: publicOrder(order), token });
  }

  if (req.method === 'GET' && pathname === '/api/account/store/orders') {
    rateLimit(req, 'store-orders', 30, 60_000);
    const customer = requireCustomer(req);
    const orders = db.orders
      .filter((o) => o.resellerCustomerId === customer.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJson(res, 200, { orders: orders.map((o) => ({ ...publicOrder(o), token: o.token })) });
  }

  // ------------------------------------------------------------ public storefront

  const publicStoreMatch = pathname.match(/^\/api\/stores\/([a-z0-9-]+)$/);
  if (req.method === 'GET' && publicStoreMatch) {
    rateLimit(req, 'store-public', 90, 60_000);
    const record = store.findStoreBySlug(publicStoreMatch[1]);
    if (!storeIsLive(record)) return sendJson(res, 404, { error: 'This store is not available.' });
    const items = store.listInventory(record.customerId)
      .filter((entry) => entry.published)
      .map(storeItem)
      .filter(Boolean);
    return sendJson(res, 200, {
      store: publicStore(record),
      products: items,
      shipping: { methods: SHIPPING_METHODS, freeThreshold: FREE_SHIPPING_THRESHOLD }
    });
  }

  const publicStoreOrderMatch = pathname.match(/^\/api\/stores\/([a-z0-9-]+)\/orders$/);
  if (req.method === 'POST' && publicStoreOrderMatch) {
    rateLimit(req, 'store-orders-public', 15, 60_000);
    const record = store.findStoreBySlug(publicStoreOrderMatch[1]);
    if (!storeIsLive(record)) return sendJson(res, 404, { error: 'This store is not available.' });
    const body = await readJson(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length || items.length > 20) throw httpError(422, 'Choose at least one product.');
    const idempotencyKey = clampStr(body.idempotencyKey, 100);
    const emailInput = clampStr(body.customer?.email, 254).toLowerCase();
    const duplicate = idempotencyKey
      ? db.orders.find((order) => order.idempotencyKey === idempotencyKey && order.customer?.email === emailInput)
      : null;
    if (duplicate) return sendJson(res, 200, { order: publicOrder(duplicate), token: duplicate.token, duplicate: true });

    const { customer: buyerCustomer, shipping } = validateAddress(body);
    const methodKey = clampStr(body.shippingMethod, 20) || 'standard';
    if (!SHIPPING_METHODS[methodKey]) throw httpError(422, 'Choose a valid shipping method.');

    const lineItems = [];
    let subtotal = 0;
    for (const item of items) {
      const slug = clampStr(item.slug, 80);
      const qty = Number(item.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw httpError(422, 'Choose a quantity between 1 and 20.');
      const entry = store.getInventory(record.customerId, slug);
      const product = db.products.find((candidate) => candidate.slug === slug);
      if (!entry || !entry.published || !product) throw httpError(422, 'A product in your bag is no longer available from this store.');
      if (entry.qty < qty) throw httpError(409, `Only ${entry.qty} left of ${product.name} at this store.`);
      const price = Number.isFinite(entry.price) && entry.price > 0 ? entry.price : product.price;
      subtotal += price * qty;
      lineItems.push({
        slug: product.slug,
        name: product.name,
        price,
        unitCost: Number.isFinite(product.baseCost) ? product.baseCost : null,
        qty,
        variant: clampStr(item.variant, 80) || (product.variants[0]?.options[0] ?? ''),
        image: photoPathFor(product) ? product.image : ''
      });
    }
    subtotal = round2(subtotal);

    const promo = body.promoCode ? calculatePromo(body.promoCode, subtotal, methodKey) : { code: null, discount: 0, shipping: null };
    const merchandiseTotal = round2(subtotal - promo.discount);
    const shipCost = shippingPrice(methodKey, merchandiseTotal, promo.shipping);
    const total = round2(merchandiseTotal + shipCost);
    if (total <= 0) throw httpError(422, 'Order total is not valid.');

    for (const line of lineItems) {
      const entry = store.getInventory(record.customerId, line.slug);
      store.putInventory({ ...entry, qty: entry.qty - line.qty, updatedAt: now() });
    }

    const number = newOrderNumber();
    const token = crypto.randomBytes(24).toString('hex');
    const timestamp = now();
    const order = {
      id: `ord_${crypto.randomBytes(8).toString('hex')}`,
      number,
      token,
      idempotencyKey: idempotencyKey || null,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'Confirmed',
      paymentMethod: 'Cash on delivery',
      paymentStatus: 'Payment on delivery',
      customerId: null,
      resellerCustomerId: record.customerId,
      storeId: record.id,
      storeSlug: record.slug,
      storeName: record.name,
      salesChannel: 'reseller-store',
      customer: buyerCustomer,
      shipping,
      items: lineItems,
      subtotal,
      discount: promo.discount,
      promoCode: promo.code,
      shippingMethod: methodKey,
      shippingCost: shipCost,
      tax: 0,
      total,
      currency: 'USD',
      displayCurrency: currencyConfig().display,
      displayTotal: amountIn(currencyConfig().display, total),
      notes: clampStr(body.notes, 500),
      trackingNumber: null,
      statusHistory: [{ status: 'Confirmed', at: timestamp }],
      paymentHistory: [{ status: 'Payment on delivery', at: timestamp }],
      restocked: false
    };
    store.putOrder(order);
    return sendJson(res, 201, {
      order: publicOrder(order),
      token,
      store: { slug: record.slug, name: record.name },
      whatsapp: whatsappOrderUrl(order)
    });
  }

  // ------------------------------------------------------------ admin stores

  if (req.method === 'GET' && pathname === '/api/admin/stores') {
    requireAdminRole(req);
    const records = store.listStores().map((record) => {
      const owner = storeOwner(record);
      const inventory = store.listInventory(record.customerId);
      return {
        ...publicStore(record, { includeReview: true }),
        owner: owner
          ? { id: owner.id, name: `${owner.firstName} ${owner.lastName}`, email: owner.email, kycStatus: owner.kycStatus || 'unverified' }
          : null,
        itemCount: inventory.length,
        publishedCount: inventory.filter((entry) => entry.published).length,
        unitCount: inventory.reduce((sum, entry) => sum + (Number(entry.qty) || 0), 0)
      };
    });
    return sendJson(res, 200, { stores: records });
  }

  const adminStoreMatch = pathname.match(/^\/api\/admin\/stores\/(rst_[a-f0-9]{16})$/);
  if (req.method === 'PATCH' && adminStoreMatch) {
    const staff = requireAdminRole(req);
    const record = store.listStores().find((entry) => entry.id === adminStoreMatch[1]);
    if (!record) return sendJson(res, 404, { error: 'Store not found.' });
    const body = await readJson(req);
    const action = clampStr(body.action, 20);
    const note = clampStr(body.note, 400);
    if (!['approve', 'reject', 'suspend', 'reinstate'].includes(action)) {
      return sendJson(res, 422, { error: 'Choose approve, reject, suspend or reinstate.' });
    }
    const owner = storeOwner(record);
    if (['approve', 'reinstate'].includes(action)) {
      if (!owner) return sendJson(res, 409, { error: 'The store owner account no longer exists.' });
      if (!canUseFeature(owner, 'reseller')) {
        return sendJson(res, 409, { error: 'The owner has not completed the verification required for reseller access.' });
      }
    }
    const timestamp = now();
    const next = {
      ...record,
      status: ['approve', 'reinstate'].includes(action) ? 'approved' : action === 'suspend' ? 'suspended' : 'rejected',
      reviewNote: note,
      reviewedAt: timestamp,
      reviewedBy: staff.username || 'admin'
    };
    if (next.status === 'approved' && !record.approvedAt) next.approvedAt = timestamp;
    const saved = store.putStore(next);
    return sendJson(res, 200, { store: publicStore(saved, { includeReview: true }), message: `Store ${next.status}.` });
  }

  // Admin: view reseller inventories
  if (req.method === 'GET' && pathname === '/api/admin/resellers') {
    requireAdminRole(req);
    const result = db.customers.map((c) => {
      const inventory = db.resellerInventory.filter((e) => e.customerId === c.id).map((entry) => {
        const product = db.products.find((p) => p.slug === entry.slug);
        return { ...entry, productName: product?.name || entry.slug };
      });
      return {
        customerId: c.id,
        name: `${c.firstName} ${c.lastName}`,
        email: c.email,
        inventoryCount: inventory.length,
        inventory
      };
    }).filter((r) => r.inventoryCount > 0);
    return sendJson(res, 200, { resellers: result });
  }

  // ------------------------------------------------------------ admin

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    rateLimit(req, 'admin-login', 6, 10 * 60_000);
    const body = await readJson(req);
    const username = clampStr(body.username, 100).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const adminUsername = String(process.env.ADMIN_USERNAME || db.settings.adminUsername || ADMIN_USERNAME).toLowerCase();
    const employee = db.staff.find((entry) => entry.username.toLowerCase() === username && entry.active !== false);
    const account = username === adminUsername
      ? { id: 'staff_admin', username: adminUsername, name: 'Store admin', role: 'admin', active: true }
      : employee;
    const passwordHash = account?.role === 'admin'
      ? process.env.ADMIN_PASSWORD_HASH || db.settings.adminPasswordHash || ''
      : account?.passwordHash || '';
    // ADMIN_PASSWORD (plaintext env) is the documented way to pin a fixed
    // admin password; it is compared in constant time and never stored.
    const envPasswordOk = account?.role === 'admin' && process.env.ADMIN_PASSWORD
      ? equalDigests(password, process.env.ADMIN_PASSWORD)
      : false;
    const passwordOk = envPasswordOk
      ? true
      : passwordHash ? await verifyPassword(password, passwordHash) : false;
    if (!account || !passwordOk) {
      return sendJson(res, 401, { error: 'Incorrect username or password.' });
    }
    const safe = publicStaff(account);
    return sendJson(res, 200, { token: signStaffToken(safe), user: safe, expiresIn: 12 * 60 * 60 });
  }

  // The staff event stream is opened by EventSource, which cannot send
  // headers, so it authenticates with the ticket minted below.
  if (pathname.startsWith('/api/admin/') && pathname !== '/api/admin/chat/stream') {
    req.staff = requireStaff(req);
    if (req.staff.role === 'employee' && !employeeCanAccess(req.method, pathname, req.staff)) {
      throw httpError(403, 'Your employee account only has access to customer support.');
    }
  }

  if (req.method === 'GET' && pathname === '/api/admin/session') {
    return sendJson(res, 200, { user: req.staff });
  }

  // ------------------------------------------------------------ sales channels

  const integrationMatch = pathname.match(/^\/api\/admin\/integrations\/(int_[a-f0-9]{16})(?:\/(test|import-products|export-products|sync-inventory|push-orders|jobs))?$/);

  function integrationOr404(id) {
    const record = store.getIntegration(id);
    if (!record) throw httpError(404, 'That sales channel no longer exists.');
    return record;
  }

  // Every channel action is recorded, successful or not, so the desk can see
  // what was tried and what the provider answered. Messages are already
  // scrubbed by the adapter of any credential it was given.
  async function runChannelJob(record, type, work) {
    const job = store.addIntegrationJob({ integrationId: record.id, type, status: 'running', message: `${type} started.` });
    try {
      const result = await work();
      const message = result?.message || `${type} completed.`;
      store.finishIntegrationJob(job.id, { status: 'success', message, detail: result?.detail ?? null });
      return { ...result, job: { ...job, status: 'success', message, finishedAt: now() } };
    } catch (error) {
      const message = error?.message || 'The channel request failed.';
      store.finishIntegrationJob(job.id, { status: 'error', message, detail: error?.detail ?? null });
      throw error;
    }
  }

  function markChannelTest(record, status) {
    return store.putIntegration({ ...record, lastTestAt: now(), lastTestStatus: status });
  }

  function importedCategorySlug(hint) {
    const categories = db.categories;
    if (!categories.length) return '';
    const text = clampStr(hint, 80).toLowerCase();
    const cleaned = slugify(text);
    const match = categories.find((category) => category.slug === cleaned
      || category.name.toLowerCase() === text
      || (text && (text.includes(category.name.toLowerCase()) || category.name.toLowerCase().includes(text))));
    return (match || categories.find((category) => category.slug === 'skincare') || categories[0]).slug;
  }

  function channelSummary(record) {
    const links = store.listIntegrationLinks(record.id);
    const lastJob = store.listIntegrationJobs({ integrationId: record.id, limit: 1 })[0] || null;
    return {
      ...channels.publicIntegration(record),
      lastTestAt: record.lastTestAt || '',
      lastTestStatus: record.lastTestStatus || '',
      linkCount: links.length,
      lastLinkedAt: links.reduce((latest, link) => (link.syncedAt > latest ? link.syncedAt : latest), ''),
      lastJob
    };
  }

  if (req.method === 'GET' && pathname === '/api/admin/integrations') {
    requireAdminRole(req);
    return sendJson(res, 200, {
      integrations: store.listIntegrations().map(channelSummary),
      providers: channels.describeProviders(),
      jobs: store.listIntegrationJobs({ limit: 20 })
    });
  }

  if (req.method === 'POST' && pathname === '/api/admin/integrations') {
    requireAdminRole(req);
    rateLimit(req, 'integration-write', 20, 60_000);
    const body = await readJson(req);
    const provider = clampStr(body.provider, 20);
    const name = clampStr(body.name, 60);
    if (!channels.PROVIDERS[provider]) throw httpError(422, 'Choose Shopify, WooCommerce or Supplier API.');
    if (name.length < 2) throw httpError(422, 'Give the channel a name of at least two characters.');
    const requestedId = clampStr(body.id, 40);
    const existing = requestedId ? integrationOr404(requestedId) : null;
    if (existing && existing.provider !== provider) throw httpError(422, 'Create a new channel to change its provider.');
    if (!existing && store.listIntegrations().length >= 20) throw httpError(409, 'Twenty channels is the current limit.');
    const existingConfig = existing ? channels.openConfig(existing) : null;
    const config = channels.normalizeConfig(provider, body.config || {}, existingConfig);
    const record = store.putIntegration({
      ...(existing || {}),
      id: existing?.id || `int_${crypto.randomBytes(8).toString('hex')}`,
      provider,
      name,
      active: body.active === undefined ? existing?.active !== false : Boolean(body.active),
      encryptedConfig: channels.sealConfig(config),
      lastTestAt: null,
      lastTestStatus: ''
    });
    return sendJson(res, existing ? 200 : 201, {
      integration: channelSummary(record),
      message: existing ? 'Channel credentials saved. Test the connection again.' : 'Sales channel created.'
    });
  }

  // The export dialog needs to know which products are already linked.
  if (req.method === 'GET' && pathname === '/api/admin/integrations/catalog') {
    requireAdminRole(req);
    return sendJson(res, 200, {
      products: db.products.map((product) => ({
        slug: product.slug,
        name: product.name,
        category: product.category,
        categoryName: categoryName(product.category),
        price: product.price,
        stock: product.stock,
        cardImage: cardImageFor(product),
        links: store.linksForSlug(product.slug).map((link) => ({
          integrationId: link.integrationId,
          externalId: link.externalId,
          externalSku: link.externalSku,
          syncedAt: link.syncedAt
        }))
      }))
    });
  }

  if (integrationMatch) {
    const record = integrationOr404(integrationMatch[1]);
    const action = integrationMatch[2] || '';

    if (req.method === 'DELETE' && !action) {
      requireAdminRole(req);
      store.deleteIntegration(record.id);
      return sendJson(res, 200, { ok: true, message: 'Sales channel removed. Local products and orders are untouched.' });
    }

    if (req.method === 'GET' && action === 'jobs') {
      requireAdminRole(req);
      return sendJson(res, 200, {
        integration: channelSummary(record),
        jobs: store.listIntegrationJobs({ integrationId: record.id, limit: 60 })
      });
    }

    if (req.method === 'POST' && action === 'test') {
      requireAdminRole(req);
      rateLimit(req, 'integration-test', 20, 60_000);
      try {
        const result = await runChannelJob(record, 'test', () => channels.testConnection(record));
        const saved = markChannelTest(record, 'success');
        return sendJson(res, 200, {
          ok: true,
          message: result.message,
          detail: result.detail,
          job: result.job,
          integration: channelSummary(saved)
        });
      } catch (error) {
        markChannelTest(record, 'error');
        throw error;
      }
    }

    if (req.method === 'POST' && action === 'import-products') {
      requireAdminRole(req);
      rateLimit(req, 'integration-import', 10, 60_000);
      if (!db.categories.length) throw httpError(422, 'Create a product category before importing.');
      const body = await readJson(req);
      const limit = Math.min(Math.max(Number(body.limit) || 40, 1), 100);
      const result = await runChannelJob(record, 'import-products', async () => {
        const rows = (await channels.importChannelProducts(record)).slice(0, limit);
        const bySlug = new Map(db.products.map((product) => [product.slug, product]));
        const links = store.listIntegrationLinks(record.id);
        const byExternal = new Map(links.map((link) => [link.externalId, link]));
        const linkedSlugs = new Map(links.map((link) => [link.slug, link]));
        let created = 0;
        let updated = 0;
        let skipped = 0;
        const failures = [];
        for (const row of rows) {
          try {
            if (String(row.name || '').trim().length < 2) throw new Error('The channel returned a product without a usable name.');
            const prior = byExternal.get(row.externalId);
            let slug = prior?.slug || slugify(row.name).slice(0, 50) || `channel-${row.externalId}`;
            const conflicting = linkedSlugs.get(slug);
            if (!prior && conflicting && conflicting.externalId !== row.externalId) {
              slug = `${slug.slice(0, 42)}-${String(row.externalId).slice(-4)}`;
            }
            let product = bySlug.get(slug);
            const price = Number.isFinite(row.price) && row.price >= 1 ? round2(row.price) : DEFAULT_BASE_COST + DEFAULT_PROFIT;
            if (product) {
              const next = {
                ...product,
                stock: Math.max(0, Math.floor(Number(row.stock) || 0)),
                price,
                priceMode: 'manual',
                updatedAt: now()
              };
              if (Number.isFinite(next.baseCost)) next.profit = round2(Math.max(0, price - next.baseCost));
              store.putProduct(next);
              bySlug.set(slug, next);
              updated += 1;
            } else {
              const baseCost = Number.isFinite(row.cost) && row.cost >= 0 ? round2(row.cost) : DEFAULT_BASE_COST;
              product = {
                id: slug,
                slug,
                name: String(row.name).slice(0, 90),
                category: importedCategorySlug(row.categoryHint),
                baseCost,
                profit: round2(Math.max(0, price - baseCost)),
                price,
                compareAt: null,
                badge: null,
                rating: 5,
                reviewCount: 0,
                stock: Math.max(0, Math.floor(Number(row.stock) || 0)),
                featured: false,
                isNew: true,
                short: String(row.short || '').slice(0, 220),
                description: String(row.description || `${row.name} imported from ${channels.PROVIDERS[record.provider].label}.`).slice(0, 2000),
                image: row.image || '/images/hero-cosmetics.jpg',
                details: [],
                specs: [],
                variants: [],
                priceMode: 'manual',
                createdAt: now(),
                updatedAt: now()
              };
              store.putProduct(product);
              bySlug.set(slug, product);
              created += 1;
            }
            store.putIntegrationLink({
              integrationId: record.id,
              slug,
              externalId: row.externalId,
              externalVariant: row.externalVariant,
              externalSku: row.externalSku,
              meta: { importedAt: now() },
              syncedAt: now()
            });
          } catch (error) {
            skipped += 1;
            failures.push({ externalId: row.externalId, name: row.name, error: error.message });
          }
        }
        return {
          message: `${created} created, ${updated} updated, ${skipped} skipped.`,
          detail: { created, updated, skipped, failures: failures.slice(0, 20) }
        };
      });
      return sendJson(res, 200, { ok: true, ...result, integration: channelSummary(store.getIntegration(record.id)) });
    }

    if (req.method === 'POST' && action === 'export-products') {
      requireAdminRole(req);
      rateLimit(req, 'integration-export', 10, 60_000);
      const body = await readJson(req);
      const slugs = [...new Set(Array.isArray(body.slugs) ? body.slugs.map((slug) => clampStr(slug, 80)).filter(Boolean) : [])].slice(0, 25);
      if (!slugs.length) throw httpError(422, 'Choose at least one product to export.');
      const result = await runChannelJob(record, 'export-products', async () => {
        const savedSlugs = [];
        const failures = [];
        for (const slug of slugs) {
          const product = db.products.find((entry) => entry.slug === slug);
          if (!product) {
            failures.push({ slug, error: 'Product not found.' });
            continue;
          }
          const link = store.getIntegrationLink(record.id, slug);
          try {
            const pushed = await channels.exportChannelProduct(record, product, { price: product.price, stock: product.stock, link });
            store.putIntegrationLink({
              integrationId: record.id,
              slug,
              externalId: pushed.externalId,
              externalVariant: pushed.externalVariant,
              externalSku: pushed.externalSku,
              meta: { ...(link?.meta || {}), ...(pushed.meta || {}) },
              syncedAt: now()
            });
            savedSlugs.push(slug);
          } catch (error) {
            failures.push({ slug, error: error.message });
          }
        }
        if (!savedSlugs.length) {
          throw new channels.IntegrationError(`No products were exported. ${failures[0]?.error || ''}`.trim(), { status: 502, detail: { failures } });
        }
        return {
          message: `${savedSlugs.length} exported, ${failures.length} failed.`,
          detail: { exported: savedSlugs, failures }
        };
      });
      return sendJson(res, 200, { ok: true, ...result, integration: channelSummary(store.getIntegration(record.id)) });
    }

    if (req.method === 'POST' && action === 'sync-inventory') {
      requireAdminRole(req);
      rateLimit(req, 'integration-sync', 20, 60_000);
      const body = await readJson(req);
      const requested = Array.isArray(body.slugs) ? body.slugs.map((slug) => clampStr(slug, 80)).filter(Boolean) : [];
      const links = store.listIntegrationLinks(record.id)
        .filter((link) => !requested.length || requested.includes(link.slug))
        .slice(0, 50);
      if (!links.length) throw httpError(422, 'Export products to this channel before syncing stock.');
      const result = await runChannelJob(record, 'sync-inventory', async () => {
        const synced = [];
        const failures = [];
        for (const link of links) {
          const product = db.products.find((entry) => entry.slug === link.slug);
          if (!product) {
            failures.push({ slug: link.slug, error: 'The local product was deleted.' });
            continue;
          }
          try {
            const pushed = await channels.pushChannelInventory(record, link, { price: product.price, stock: product.stock });
            store.putIntegrationLink({ ...link, meta: { ...(link.meta || {}), ...(pushed.meta || {}) }, syncedAt: now() });
            synced.push({ slug: link.slug, updated: pushed.updated });
          } catch (error) {
            failures.push({ slug: link.slug, error: error.message });
          }
        }
        if (!synced.length) {
          throw new channels.IntegrationError(`No stock was synced. ${failures[0]?.error || ''}`.trim(), { status: 502, detail: { failures } });
        }
        return { message: `${synced.length} synced, ${failures.length} failed.`, detail: { synced, failures } };
      });
      return sendJson(res, 200, { ok: true, ...result, integration: channelSummary(store.getIntegration(record.id)) });
    }

    if (req.method === 'POST' && action === 'push-orders') {
      requireAdminRole(req);
      rateLimit(req, 'integration-orders', 20, 60_000);
      const body = await readJson(req);
      const numbers = [...new Set(Array.isArray(body.numbers) ? body.numbers.map((number) => clampStr(number, 30)).filter(Boolean) : [])].slice(0, 20);
      if (!numbers.length) throw httpError(422, 'Choose at least one order.');
      const links = new Map(store.listIntegrationLinks(record.id).map((link) => [link.slug, link]));
      if (!links.size) throw httpError(422, 'Export products to this channel before sending orders.');
      const result = await runChannelJob(record, 'push-orders', async () => {
        const pushed = [];
        const failures = [];
        for (const number of numbers) {
          const order = db.orders.find((entry) => entry.number === number);
          if (!order) {
            failures.push({ number, error: 'Order not found.' });
            continue;
          }
          if (order.status === 'Cancelled') {
            failures.push({ number, error: 'Cancelled orders are not sent to a fulfilment channel.' });
            continue;
          }
          const already = order.integrationOrders?.[record.id];
          if (already?.externalId) {
            pushed.push({ number, externalId: already.externalId, duplicate: true });
            continue;
          }
          try {
            const remote = await channels.pushChannelOrder(record, order, links);
            store.putOrder({
              ...order,
              integrationOrders: {
                ...(order.integrationOrders || {}),
                [record.id]: {
                  provider: record.provider,
                  externalId: remote.externalId,
                  externalName: remote.externalName,
                  pushedAt: now()
                }
              },
              updatedAt: now()
            });
            pushed.push({ number, externalId: remote.externalId, externalName: remote.externalName });
          } catch (error) {
            failures.push({ number, error: error.message });
          }
        }
        if (!pushed.length) {
          throw new channels.IntegrationError(`No orders were sent. ${failures[0]?.error || ''}`.trim(), { status: 502, detail: { failures } });
        }
        return { message: `${pushed.length} sent, ${failures.length} failed.`, detail: { pushed, failures } };
      });
      return sendJson(res, 200, { ok: true, ...result, integration: channelSummary(store.getIntegration(record.id)) });
    }

    throw httpError(404, 'Unknown channel action.');
  }

  if (req.method === 'GET' && pathname === '/api/admin/staff') {
    requireAdminRole(req);
    return sendJson(res, 200, {
      staff: db.staff.map(publicStaff).sort((left, right) => left.name.localeCompare(right.name))
    });
  }

  if (req.method === 'POST' && pathname === '/api/admin/staff') {
    requireAdminRole(req);
    const body = await readJson(req);
    const name = clampStr(body.name, 80);
    const username = clampStr(body.username, 40).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (name.length < 2) return sendJson(res, 422, { error: 'Employee name must be at least 2 characters.' });
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return sendJson(res, 422, { error: 'Username must be 3–40 letters, numbers, dots, dashes or underscores.' });
    if (password.length < 10) return sendJson(res, 422, { error: 'Password must be at least 10 characters.' });
    const adminUsername = String(process.env.ADMIN_USERNAME || db.settings.adminUsername || ADMIN_USERNAME).toLowerCase();
    if (username === adminUsername || db.staff.some((entry) => entry.username.toLowerCase() === username)) {
      return sendJson(res, 409, { error: 'That username is already in use.' });
    }
    const staff = {
      id: `staff_${crypto.randomBytes(8).toString('hex')}`,
      username,
      name,
      role: 'employee',
      active: true,
      permissions: defaultStaffPermissions(body.permissions),
      chatScope: body.chatScope === 'assigned' ? 'assigned' : 'all',
      passwordHash: await hashPassword(password),
      createdAt: now()
    };
    store.putStaff(staff);
    return sendJson(res, 201, { staff: publicStaff(staff) });
  }

  const staffMatch = pathname.match(/^\/api\/admin\/staff\/(staff_[a-f0-9]{16})$/);
  if (staffMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
    requireAdminRole(req);
    const entry = db.staff.find((item) => item.id === staffMatch[1]);
    if (!entry) return sendJson(res, 404, { error: 'Employee not found.' });
    if (req.method === 'DELETE') {
      store.deleteStaff(entry.id);
      return sendJson(res, 200, { ok: true });
    }
    const body = await readJson(req);
    if (body.name !== undefined) {
      const name = clampStr(body.name, 80);
      if (name.length < 2) return sendJson(res, 422, { error: 'Employee name must be at least 2 characters.' });
      entry.name = name;
    }
    if (body.active !== undefined) entry.active = Boolean(body.active);
    if (body.permissions !== undefined) entry.permissions = defaultStaffPermissions(body.permissions, entry.permissions);
    if (body.chatScope !== undefined) entry.chatScope = body.chatScope === 'assigned' ? 'assigned' : 'all';
    if (body.password !== undefined) {
      if (typeof body.password !== 'string' || body.password.length < 10) {
        return sendJson(res, 422, { error: 'Password must be at least 10 characters.' });
      }
      entry.passwordHash = await hashPassword(body.password);
    }
    store.putStaff(entry);
    return sendJson(res, 200, { staff: publicStaff(entry) });
  }

  if (req.method === 'GET' && pathname === '/api/admin/overview') {
    const active = db.orders.filter((order) => order.status !== 'Cancelled');
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = active.filter((order) => new Date(order.createdAt).getTime() >= cutoff);
    const revenue30 = round2(recent.reduce((sum, order) => sum + order.total, 0));
    const units = new Map();
    for (const order of active) {
      for (const item of order.items) units.set(item.slug, (units.get(item.slug) || 0) + item.qty);
    }
    const topProducts = [...units.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([slug, count]) => ({ slug, name: db.products.find((product) => product.slug === slug)?.name || slug, units: count }));
    const report = store.profitReport({});
    const report30 = store.profitReport({ from: new Date(cutoff).toISOString() });
    const verification = {
      pending: db.customers.filter((customer) => customer.kycStatus === 'pending').length,
      approved: db.customers.filter((customer) => customer.kycStatus === 'approved').length,
      rejected: db.customers.filter((customer) => customer.kycStatus === 'rejected').length,
      documents: db.customers.reduce((sum, customer) => sum + store.documentsFor(customer.id).filter((document) => document.status === 'pending').length, 0)
    };
    return sendJson(res, 200, {
      stats: {
        revenue30,
        orders30: recent.length,
        aov30: recent.length ? round2(revenue30 / recent.length) : 0,
        profit30: round2(report30.totals.profit),
        profitAllTime: round2(report.totals.profit),
        untrackedRevenue: round2(report.totals.untrackedRevenue),
        allOrders: db.orders.length,
        lowStock: db.products.filter((product) => product.stock <= 8).length,
        openTickets: db.tickets.filter((ticket) => ticket.status === 'open').length,
        unreadTickets: store.unreadTotals().admin,
        subscribers: db.subscribers.length,
        customers: db.customers.length
      },
      verification,
      recentOrders: db.orders.slice(-6).reverse().map(adminOrder),
      lowStockProducts: db.products.filter((product) => product.stock <= 8).map(adminProduct),
      topProducts,
      productsCount: db.products.length
    });
  }

  if (req.method === 'GET' && pathname === '/api/admin/orders') {
    return sendJson(res, 200, { orders: [...db.orders].reverse().map(adminOrder) });
  }

  // Sales and margin report. Costs come from the snapshot taken when each
  // order was placed, so repricing a product never rewrites history.
  if (req.method === 'GET' && pathname === '/api/admin/reports/profit') {
    const query = new URL(req.url, 'http://localhost').searchParams;
    const range = clampStr(query.get('range'), 20) || '30';
    const presetDays = { 7: 7, 30: 30, 90: 90, 365: 365, all: null }[range];
    if (presetDays === undefined) return sendJson(res, 422, { error: 'Use range 7, 30, 90, 365 or all.' });
    const from = presetDays === null ? null : new Date(Date.now() - presetDays * 24 * 60 * 60 * 1000).toISOString();
    const to = null;
    const report = store.profitReport({ from, to });
    const expenses = expenseTotals(expenseList(), { from, to });
    const orders = db.orders.filter((order) => order.status !== 'Cancelled');
    const inRange = orders.filter((order) => (!from || new Date(order.createdAt) >= new Date(from)) && (!to || new Date(order.createdAt) <= new Date(to)));
    const currency = currencyConfig();
    const byDay = new Map();
    for (const order of inRange) {
      const day = String(order.createdAt).slice(0, 10);
      const bucket = byDay.get(day) || { day, orders: 0, revenue: 0, profit: 0 };
      bucket.orders += 1;
      bucket.revenue += order.total;
      const gross = (order.items || []).reduce((sum, item) => sum + (item.price || 0) * (item.qty || 0), 0);
      const scale = gross > 0 ? Math.max(0, gross - (order.discount || 0)) / gross : 1;
      for (const item of order.items || []) {
        if (Number.isFinite(item.unitCost)) {
          bucket.profit += ((item.price || 0) * (item.qty || 0) - item.unitCost * (item.qty || 0)) * scale;
        }
      }
      byDay.set(day, bucket);
    }
    const paymentMix = new Map();
    for (const order of inRange) {
      paymentMix.set(order.paymentMethod, (paymentMix.get(order.paymentMethod) || 0) + order.total);
    }
    return sendJson(res, 200, {
      range: presetDays === null ? 'all' : `${presetDays}d`,
      from,
      totals: {
        ...report.totals,
        revenue: round2(report.totals.revenue),
        cost: round2(report.totals.cost),
        profit: round2(report.totals.profit),
        margin: report.totals.trackedRevenue ? round2((report.totals.profit / report.totals.trackedRevenue) * 100) : 0,
        orders: inRange.length,
        aov: inRange.length ? round2(report.totals.revenue / inRange.length) : 0,
        shippingCollected: round2(inRange.reduce((sum, order) => sum + (order.shippingCost || 0), 0)),
        discountsGiven: round2(inRange.reduce((sum, order) => sum + (order.discount || 0), 0))
      },
      // Gross margin is product-only; net margin is after the recorded
      // operating expenses for the same window.
      expenses: { ...expenses, entries: expenseList().length },
      netProfit: round2(report.totals.profit - expenses.total),
      products: report.products.map((row) => {
        const product = db.products.find((entry) => entry.slug === row.slug);
        return {
          slug: row.slug,
          name: row.name || product?.name || row.slug,
          units: row.units,
          revenue: round2(row.revenue),
          cost: row.tracked ? round2(row.cost) : null,
          profit: row.tracked ? round2(row.profit) : null,
          margin: row.tracked && row.revenue ? round2((row.profit / row.revenue) * 100) : null,
          currentPrice: product?.price ?? null,
          currentBaseCost: product?.baseCost ?? null,
          currentProfit: product?.profit ?? null,
          stock: product?.stock ?? null
        };
      }),
      daily: [...byDay.values()]
        .sort((left, right) => left.day.localeCompare(right.day))
        .map((row) => ({ ...row, revenue: round2(row.revenue), profit: round2(row.profit) })),
      paymentMix: [...paymentMix.entries()].map(([method, total]) => ({ method, total: round2(total) })),
      currency
    });
  }

  // Operating expenses are entered by hand (packaging, courier contracts,
  // advertising) and never mixed into product margin.
  if (req.method === 'GET' && pathname === '/api/admin/expenses') {
    return sendJson(res, 200, { expenses: expenseList(), totals: expenseTotals(expenseList()) });
  }

  if (req.method === 'POST' && pathname === '/api/admin/expenses') {
    const body = await readJson(req);
    const label = clampStr(body.label, 80);
    const amount = round2(Math.abs(Number(body.amount)));
    if (label.length < 2) return sendJson(res, 422, { error: 'Name the expense.' });
    if (!Number.isFinite(amount) || amount <= 0) return sendJson(res, 422, { error: 'Enter an amount greater than zero.' });
    const period = ['monthly', 'one-time'].includes(clampStr(body.period, 20)) ? clampStr(body.period, 20) : 'monthly';
    const entry = {
      id: `exp_${crypto.randomBytes(6).toString('hex')}`,
      label,
      amount,
      period,
      date: clampStr(body.date, 10) || now().slice(0, 10),
      note: clampStr(body.note, 200),
      createdAt: now()
    };
    db.settings.expenses = [...expenseList(), entry].slice(-400);
    await persist();
    return sendJson(res, 201, { expense: entry, expenses: expenseList(), totals: expenseTotals(db.settings.expenses) });
  }

  const expenseMatch = pathname.match(/^\/api\/admin\/expenses\/(exp_[a-f0-9]{12})$/);
  if (req.method === 'DELETE' && expenseMatch) {
    db.settings.expenses = expenseList().filter((entry) => entry.id !== expenseMatch[1]);
    await persist();
    return sendJson(res, 200, { expenses: db.settings.expenses, totals: expenseTotals(db.settings.expenses) });
  }

  const adminOrderMatch = pathname.match(/^\/api\/admin\/orders\/(VLN-[A-Z0-9]{4}-[A-Z0-9]{4})$/);
  if (req.method === 'PATCH' && adminOrderMatch) {
    const order = db.orders.find((entry) => entry.number === adminOrderMatch[1]);
    if (!order) return sendJson(res, 404, { error: 'Order not found' });
    const body = await readJson(req);
    if (body.status !== undefined) {
      const status = clampStr(body.status, 20);
      if (!ORDER_STATUSES.includes(status)) return sendJson(res, 422, { error: 'Invalid order status.' });
      if (status !== order.status) {
        if (status === 'Cancelled' && !order.restocked) {
          if (order.resellerCustomerId) {
            // Reseller stock was already reserved out of the main catalogue
            // when it was imported, so a cancellation returns it there.
            for (const item of order.items) {
              const entry = store.getInventory(order.resellerCustomerId, item.slug);
              if (entry) {
                store.putInventory({ ...entry, qty: (Number(entry.qty) || 0) + item.qty, updatedAt: now() });
              }
            }
          } else {
            for (const item of order.items) {
              const product = db.products.find((entry) => entry.slug === item.slug);
              if (product) {
                product.stock += item.qty;
                store.putProduct(product);
              }
            }
          }
          order.restocked = true;
          order.paymentStatus = 'Cancelled — no payment due';
          if (!order.paymentHistory) order.paymentHistory = [];
          order.paymentHistory.push({ status: 'Cancelled — no payment due', at: now() });
        }
        order.status = status;
        order.statusHistory.push({ status, at: now() });
      }
    }
    if (body.paymentStatus !== undefined) {
      const paymentStatus = clampStr(body.paymentStatus, 40);
      if (!PAYMENT_STATUSES.includes(paymentStatus)) return sendJson(res, 422, { error: 'Invalid payment status.' });
      if (paymentStatus !== order.paymentStatus) {
        order.paymentStatus = paymentStatus;
        if (!order.paymentHistory) order.paymentHistory = [];
        order.paymentHistory.push({ status: paymentStatus, at: now() });
      }
    }
    if (body.trackingNumber !== undefined) {
      order.trackingNumber = clampStr(body.trackingNumber, 80) || null;
    }
    if (body.paymentReference !== undefined) {
      order.paymentReference = clampStr(body.paymentReference, 80);
    }
    // Accept or reject the latest payment slip; accepting marks the order paid.
    if (body.proofDecision !== undefined) {
      const decision = clampStr(body.proofDecision, 20);
      if (!['accepted', 'rejected'].includes(decision)) return sendJson(res, 422, { error: 'Invalid slip decision.' });
      const proof = latestProof(order);
      if (!proof) return sendJson(res, 422, { error: 'No payment slip has been uploaded for this order.' });
      proof.status = decision;
      proof.reviewedAt = now();
      order.proofReviewNote = clampStr(body.proofNote, 300);
      const nextStatus = decision === 'accepted' ? 'Paid' : 'Awaiting Payment';
      if (order.paymentStatus !== nextStatus) {
        order.paymentStatus = nextStatus;
        if (!order.paymentHistory) order.paymentHistory = [];
        order.paymentHistory.push({ status: nextStatus, at: now() });
      }
      await notifyProofDecision(order, proof, nextStatus);
    }
    order.updatedAt = now();
    store.putOrder(order);
    return sendJson(res, 200, { order: adminOrder(order) });
  }

  if (req.method === 'GET' && pathname === '/api/admin/products') {
    return sendJson(res, 200, { products: db.products.map(adminProduct), categories: db.categories });
  }

  if (req.method === 'POST' && pathname === '/api/admin/products') {
    const body = await readJson(req);
    const payload = productPayload(body);
    let slug = payload.slug;
    let counter = 2;
    while (db.products.some((product) => product.slug === slug)) slug = `${payload.slug}-${counter++}`;
    payload.slug = slug;
    payload.id = slug;
    store.putProduct(payload);
    return sendJson(res, 201, { product: adminProduct(payload) });
  }

  const adminProductMatch = pathname.match(/^\/api\/admin\/products\/([a-z0-9-]+)$/);
  if (adminProductMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const existing = db.products.find((product) => product.slug === adminProductMatch[1]);
    if (!existing) return sendJson(res, 404, { error: 'Product not found' });
    if (req.method === 'DELETE') {
      store.deleteProduct(existing.slug);
      return sendJson(res, 200, { ok: true });
    }
    const body = await readJson(req);
    const updated = productPayload({ ...existing, ...body }, existing);
    store.putProduct(updated);
    return sendJson(res, 200, { product: adminProduct(updated) });
  }

  if (req.method === 'POST' && pathname === '/api/admin/uploads') {
    const body = await readJson(req, 12_000_000);
    let base64 = String(body.data || '');
    if (base64.startsWith('data:')) base64 = base64.slice(base64.indexOf(',') + 1);
    if (!base64) return sendJson(res, 422, { error: 'Choose an image to upload.' });
    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return sendJson(res, 422, { error: 'That image could not be read.' });
    }
    if (buffer.length < 128) return sendJson(res, 422, { error: 'That image appears to be empty.' });
    if (buffer.length > UPLOAD_MAX_BYTES) return sendJson(res, 413, { error: 'Images must be 5 MB or smaller.' });
    // The browser's declared MIME is unreliable on Android (empty, image/jpg,
    // or HEIC for a JPEG camera roll). Trust the bytes instead.
    const mime = sniffImage(buffer);
    if (!mime) {
      if (looksLikeHeif(buffer)) {
        return sendJson(res, 422, { error: 'HEIC/HEIF photos are not supported. Export the photo as JPEG and upload it again.' });
      }
      return sendJson(res, 422, { error: 'Upload a JPEG, PNG or WebP image.' });
    }
    const extension = IMAGE_EXTENSIONS[mime];
    const filename = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${extension}`;
    await fsp.mkdir(UPLOADS_DIR, { recursive: true });
    const absolutePath = path.join(UPLOADS_DIR, filename);
    // Write to a temporary name first so a crashed upload never leaves a
    // truncated file that the static handler would happily serve.
    const temporary = `${absolutePath}.part`;
    await fsp.writeFile(temporary, buffer);
    await fsp.rename(temporary, absolutePath);
    const publicPath = `/images/uploads/${filename}`;
    assetVersionCache.delete(publicPath);
    return sendJson(res, 201, {
      path: publicPath,
      mime,
      bytes: buffer.length,
      message: 'Image uploaded. Save the product to publish it.'
    });
  }

  if (req.method === 'GET' && pathname === '/api/admin/customers') {
    return sendJson(res, 200, {
      customers: db.customers
        .map(adminCustomer)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    });
  }

  const adminCustomerMatch = pathname.match(/^\/api\/admin\/customers\/(cust_[a-f0-9]{16})$/);
  if (req.method === 'DELETE' && adminCustomerMatch) {
    const customer = store.findCustomerById(adminCustomerMatch[1]);
    if (!customer) return sendJson(res, 404, { error: 'Customer not found' });
    // Orders are kept for records; only the account link is removed.
    for (const order of db.orders) {
      if (order.customerId === customer.id) {
        order.customerId = null;
        store.putOrder(order);
      }
    }
    store.deleteCustomer(customer.id);
    return sendJson(res, 200, { ok: true });
  }

  // ---------------------------------------------------- admin: verification desk

  if (req.method === 'GET' && pathname === '/api/admin/verification') {
    const cfg = kycConfig();
    const rows = db.customers
      .map((customer) => {
        const state = verificationState(customer);
        return {
          id: customer.id,
          name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
          email: customer.email,
          phone: customer.phone || '',
          status: customer.kycStatus || 'unverified',
          emailVerified: state.emailVerified,
          phoneVerified: state.phoneVerified,
          documentCount: state.documents.length,
          documentsPending: state.docsPending,
          reviewedBy: customer.kycReviewedBy || '',
          reviewedAt: customer.kycReviewedAt || '',
          note: customer.kycNote || '',
          createdAt: customer.createdAt,
          lastLoginAt: customer.lastLoginAt || ''
        };
      })
      .sort((left, right) => {
        const rank = (row) => (row.documentsPending ? 0 : row.status === 'pending' ? 1 : row.status === 'rejected' ? 2 : 3);
        return rank(left) - rank(right) || new Date(right.createdAt) - new Date(left.createdAt);
      });
    return sendJson(res, 200, {
      queue: rows.filter((row) => row.documentsPending || ['pending', 'rejected'].includes(row.status) || !row.emailVerified || !row.phoneVerified),
      customers: rows,
      counts: {
        total: rows.length,
        approved: rows.filter((row) => row.status === 'approved').length,
        pending: rows.filter((row) => row.status === 'pending').length,
        unverified: rows.filter((row) => row.status === 'unverified').length,
        rejected: rows.filter((row) => row.status === 'rejected').length,
        awaitingDocuments: rows.filter((row) => row.documentsPending).length
      },
      policy: cfg,
      providers: deliveryMode()
    });
  }

  const adminVerificationMatch = pathname.match(/^\/api\/admin\/verification\/(cust_[a-f0-9]{16})$/);
  if (req.method === 'PATCH' && adminVerificationMatch) {
    // Identity decisions stay with administrators.
    const staff = requireAdminRole(req);
    const customer = store.findCustomerById(adminVerificationMatch[1]);
    if (!customer) return sendJson(res, 404, { error: 'Customer not found.' });
    const body = await readJson(req);
    const status = clampStr(body.status, 20);
    if (!KYC_STATUSES.includes(status)) return sendJson(res, 422, { error: 'Choose pending, approved or rejected.' });
    const updated = applyKycDecision(customer, status, { reviewedBy: staff.username || staff.name, note: body.note });
    if (status === 'approved' || status === 'rejected') {
      const decisionNote = clampStr(body.note, 400);
      for (const document of store.documentsFor(customer.id)) {
        if (document.status !== 'pending') continue;
        store.putDocument({
          ...document,
          status: status === 'approved' ? 'accepted' : 'rejected',
          note: decisionNote,
          reviewedBy: staff.username || staff.name,
          reviewedAt: now()
        });
      }
    }
    const refreshed = store.findCustomerById(customer.id);
    // The customer is told the outcome in their account page and by email when
    // SMTP is configured; the message never carries document contents.
    if (status === 'approved' || status === 'rejected') {
      sendVerificationEmail({
        to: refreshed.email,
        subject: status === 'approved' ? 'Your VELUNE account is verified' : 'Action needed on your VELUNE verification',
        text:
          status === 'approved'
            ? `Hi ${refreshed.firstName},\n\nYour VELUNE account is now fully verified. Wholesale and reseller features are unlocked.\n\nThank you for your patience.`
            : `Hi ${refreshed.firstName},\n\nWe could not approve your verification: ${clampStr(body.note, 300) || 'the documents were not readable.'}\n\nPlease sign in to velune and upload a clearer copy. Your account details remain private.`
      }).catch(() => {});
    }
    return sendJson(res, 200, {
      customer: adminCustomer(refreshed),
      verification: verificationPayload(refreshed),
      message: status === 'approved' ? 'Customer approved.' : status === 'rejected' ? 'Verification rejected.' : 'Moved back to pending.'
    });
  }

  const adminDocumentViewMatch = pathname.match(/^\/api\/admin\/verification\/(cust_[a-f0-9]{16})\/documents\/(doc_[a-f0-9]{16})$/);
  if (req.method === 'GET' && adminDocumentViewMatch) {
    requireAdminRole(req);
    return streamPrivateDocument(res, adminDocumentViewMatch[2], adminDocumentViewMatch[1]);
  }

  const adminAvatarMatch = pathname.match(/^\/api\/admin\/verification\/(cust_[a-f0-9]{16})\/avatar$/);
  if (req.method === 'GET' && adminAvatarMatch) {
    requireAdminRole(req);
    const customer = store.findCustomerById(adminAvatarMatch[1]);
    if (!customer?.profilePicture) return sendJson(res, 404, { error: 'No profile picture on this account.' });
    return streamPrivateFile(res, customer.profilePicture);
  }

  const adminDocumentDecisionMatch = pathname.match(/^\/api\/admin\/documents\/(doc_[a-f0-9]{16})$/);
  if (req.method === 'PATCH' && adminDocumentDecisionMatch) {
    const staff = requireAdminRole(req);
    const document = store.getDocument(adminDocumentDecisionMatch[1]);
    if (!document) return sendJson(res, 404, { error: 'Document not found.' });
    const body = await readJson(req);
    const status = clampStr(body.status, 20);
    if (!['pending', 'accepted', 'rejected'].includes(status)) return sendJson(res, 422, { error: 'Choose pending, accepted or rejected.' });
    store.putDocument({
      ...document,
      status,
      note: clampStr(body.note, 400),
      reviewedBy: staff.username || staff.name,
      reviewedAt: now()
    });
    const customer = store.findCustomerById(document.customerId);
    const refreshed = customer ? refreshKycStatus(customer) : null;
    return sendJson(res, 200, {
      document: { ...document, status, note: clampStr(body.note, 400) },
      verification: refreshed ? verificationPayload(refreshed) : null,
      message: 'Document review saved.'
    });
  }

  // Privacy retention: an administrator can purge a customer's documents.
  if (req.method === 'DELETE' && adminVerificationMatch) {
    requireAdminRole(req);
    const customer = store.findCustomerById(adminVerificationMatch[1]);
    if (!customer) return sendJson(res, 404, { error: 'Customer not found.' });
    const removed = store.documentsFor(customer.id);
    for (const document of removed) store.deleteDocument(document.id);
    if (customer.profilePicture) {
      store.deletePrivateFile(customer.profilePicture);
      store.putCustomer({ ...customer, profilePicture: '' });
    }
    return sendJson(res, 200, {
      removed: removed.length,
      message: `${removed.length} document file(s) deleted. Identity decisions were not changed.`
    });
  }

  // ---------------------------------------------------- admin: delivery log

  if (req.method === 'GET' && pathname === '/api/admin/delivery') {
    requireAdminRole(req);
    return sendJson(res, 200, {
      outbox: store.listOutbox(60),
      providers: deliveryMode(),
      message: deliveryMode().live
        ? 'Provider credentials detected — codes are sent live.'
        : 'No SMTP or SMS provider configured. Codes are recorded here only; set the credentials listed in README to send them to customers.'
    });
  }

  if (req.method === 'GET' && pathname === '/api/admin/settings') {
    return sendJson(res, 200, { settings: adminSettings(), categories: db.categories });
  }

  if (req.method === 'PATCH' && pathname === '/api/admin/settings') {
    const body = await readJson(req);
    const updates = {};
    if (body.supportEmail !== undefined) {
      const email = clampStr(body.supportEmail, 254).toLowerCase();
      if (!isEmail(email)) return sendJson(res, 422, { error: 'Enter a valid support email address.' });
      updates.supportEmail = email;
    }
    if (body.whatsapp !== undefined) {
      const digits = digitsOnly(body.whatsapp);
      if (digits && (digits.length < 7 || digits.length > 15)) {
        return sendJson(res, 422, { error: 'WhatsApp needs 7–15 digits including the country code.' });
      }
      updates.whatsapp = digits;
    }
    if (body.telegram !== undefined) {
      const handle = telegramHandle(body.telegram);
      if (handle && !/^[A-Za-z0-9_]{3,32}$/.test(handle)) {
        return sendJson(res, 422, { error: 'Telegram usernames use 3–32 letters, numbers or underscores.' });
      }
      updates.telegram = handle;
    }
    if (body.hours !== undefined) {
      const hours = clampStr(body.hours, 120);
      if (!hours) return sendJson(res, 422, { error: 'Support hours cannot be empty.' });
      updates.hours = hours;
    }
    if (body.responseTime !== undefined) {
      const responseTime = clampStr(body.responseTime, 120);
      if (!responseTime) return sendJson(res, 422, { error: 'Response time cannot be empty.' });
      updates.responseTime = responseTime;
    }
    if (body.announcement !== undefined) {
      const announcement = clampStr(body.announcement, 160);
      if (!announcement) return sendJson(res, 422, { error: 'Announcement cannot be empty.' });
      updates.announcement = announcement;
    }
    if (body.payments !== undefined) updates.payments = normalisePayments(body.payments);
    if (body.currency !== undefined) updates.currency = normaliseCurrencySettings(body.currency);
    if (body.kyc !== undefined) updates.kyc = normaliseKycSettings(body.kyc);
    Object.assign(db.settings, updates, { updatedAt: now() });
    await persist();
    return sendJson(res, 200, { settings: adminSettings(), message: 'Store settings saved.' });
  }

  if (req.method === 'POST' && pathname === '/api/admin/categories') {
    const body = await readJson(req);
    const name = clampStr(body.name, 40);
    if (name.length < 2) return sendJson(res, 422, { error: 'Category name must be at least 2 characters.' });
    const slug = slugify(name);
    if (!slug) return sendJson(res, 422, { error: 'Use letters or numbers in the category name.' });
    if (db.categories.some((category) => category.slug === slug)) {
      return sendJson(res, 409, { error: 'A category with that name already exists.' });
    }
    const category = { slug, name, line: clampStr(body.line, 80) };
    store.putCategory(category);
    return sendJson(res, 201, { category, categories: db.categories });
  }

  const adminCategoryMatch = pathname.match(/^\/api\/admin\/categories\/([a-z0-9-]+)$/);
  if (adminCategoryMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const category = db.categories.find((entry) => entry.slug === adminCategoryMatch[1]);
    if (!category) return sendJson(res, 404, { error: 'Category not found' });
    if (req.method === 'DELETE') {
      if (db.categories.length <= 1) return sendJson(res, 409, { error: 'Keep at least one category.' });
      if (db.products.some((product) => product.category === category.slug)) {
        return sendJson(res, 409, { error: 'Move or delete the products in this category first.' });
      }
      store.deleteCategory(category.slug);
      return sendJson(res, 200, { ok: true, categories: db.categories });
    }
    const body = await readJson(req);
    if (body.name !== undefined) {
      const name = clampStr(body.name, 40);
      if (name.length < 2) return sendJson(res, 422, { error: 'Category name must be at least 2 characters.' });
      category.name = name;
    }
    if (body.line !== undefined) category.line = clampStr(body.line, 80);
    store.putCategory(category);
    return sendJson(res, 200, { category, categories: db.categories });
  }

  if (req.method === 'GET' && pathname === '/api/admin/tickets') {
    return sendJson(res, 200, { tickets: [...db.tickets].reverse() });
  }

  const ticketMatch = pathname.match(/^\/api\/admin\/tickets\/(T-[A-F0-9]+)$/);
  if (req.method === 'PATCH' && ticketMatch) {
    const ticket = conversationById(ticketMatch[1]);
    if (!ticket) return sendJson(res, 404, { error: 'Ticket not found' });
    requireConversationScope(req.staff, ticket);
    const body = await readJson(req);
    if (body.status !== undefined) {
      const status = clampStr(body.status, 20);
      if (!['open', 'resolved'].includes(status)) return sendJson(res, 422, { error: 'Invalid ticket status.' });
      ticket.status = status;
      ticket.updatedAt = now();
      if (status === 'resolved') ticket.unread = { admin: 0, customer: 0 };
      store.putConversation(ticket);
      emitChat(ticket.id, 'updated', { conversation: conversationSummary(ticket) });
      broadcastUnread();
    }
    // Support staff reply — stored as a normal chat message so history,
    // unread counts and the live thread all agree.
    if (body.replyText !== undefined && clampStr(body.replyText, 2000).length > 0) {
      await appendMessage(ticket, makeMessage('employee', req.staff.name, clampStr(body.replyText, 2000), {
        paymentInfo: paymentInfoFrom(body.paymentInfo)
      }));
    }
    if (body.adminNotes !== undefined) {
      ticket.adminNotes = clampStr(body.adminNotes, 1000);
      ticket.updatedAt = now();
      store.putConversation(ticket);
    }
    return sendJson(res, 200, { ticket: conversationSummary(ticket) });
  }

  // Admin: GET single ticket with full thread
  const adminTicketGetMatch = pathname.match(/^\/api\/admin\/tickets\/(T-[A-F0-9]+)$/);
  if (req.method === 'GET' && adminTicketGetMatch) {
    const ticket = conversationById(adminTicketGetMatch[1]);
    if (!ticket) return sendJson(res, 404, { error: 'Ticket not found' });
    requireConversationScope(req.staff, ticket);
    if (ticket.unread?.admin) {
      ticket.unread.admin = 0;
      store.putConversation(ticket);
      broadcastUnread();
    }
    return sendJson(res, 200, { ticket });
  }

  // Public: customer reads thread by ticket ID + phone
  const ticketReadMatch = pathname.match(/^\/api\/support\/ticket\/(T-[A-F0-9]+)$/);
  if (req.method === 'GET' && ticketReadMatch) {
    rateLimit(req, 'ticket-read', 20, 60_000);
    const phone = clampStr(url.searchParams.get('phone'), 30);
    if (!phone || phone.length < 7) return sendJson(res, 422, { error: 'Provide your phone number.' });
    const ticket = conversationById(ticketReadMatch[1]);
    if (!ticket || ticket.phone !== phone) return sendJson(res, 404, { error: 'Chat not found. Check your Chat ID and phone number.' });
    // Threads opened through the old phone-only ticket form carry no visitor ID,
    // so the widget can never resolve them and agent replies sit unread in the
    // database. Phone already proved this is the customer, so claim the thread.
    const boundTo = visitorIdOf(url.searchParams.get('visitorId'));
    if (boundTo && ticket.visitorId !== boundTo) {
      ticket.visitorId = boundTo;
      ticket.updatedAt = now();
      store.putConversation(ticket);
    }
    const { adminNotes, ...safeTicket } = ticket;
    return sendJson(res, 200, { ticket: safeTicket });
  }

  // ── live chat (admin desk) ─────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/admin/chat') {
    const conversations = visibleConversations(req.staff)
      .map(conversationSummary)
      .sort((left, right) => new Date(right.lastMessageAt || 0) - new Date(left.lastMessageAt || 0));
    return sendJson(res, 200, {
      conversations,
      online: [...presenceByConversation.keys()],
      payments: publicPayments(),
      support: supportStatus(),
      unreadAdmin: store.unreadTotals().admin,
      staff: { id: req.staff.id, name: req.staff.name, role: req.staff.role }
    });
  }

  if (req.method === 'POST' && pathname === '/api/admin/chat/stream-ticket') {
    return sendJson(res, 200, { token: issueSseTicket({ staff: req.staff }) });
  }

  const adminTypingMatch = pathname.match(/^\/api\/admin\/chat\/(T-[A-F0-9]+)\/typing$/);
  if (req.method === 'POST' && adminTypingMatch) {
    const conversation = conversationById(adminTypingMatch[1]);
    if (!conversation) return sendJson(res, 404, { error: 'Chat not found' });
    const body = await readJson(req);
    sseBroadcast(`chat:${conversation.id}`, 'typing', { typing: Boolean(body.typing), from: 'employee' });
    return sendJson(res, 200, { ok: true });
  }

  const adminChatMatch = pathname.match(/^\/api\/admin\/chat\/(T-[A-F0-9]+)$/);
  if (req.method === 'GET' && adminChatMatch) {
    const conversation = conversationById(adminChatMatch[1]);
    if (!conversation) return sendJson(res, 404, { error: 'Chat not found' });
    requireConversationScope(req.staff, conversation);
    const order = conversation.orderNumber
      ? db.orders.find((entry) => entry.number.toUpperCase() === conversation.orderNumber.toUpperCase())
      : null;
    const customer = conversation.customerId ? store.findCustomerById(conversation.customerId) : null;
    // Opening the thread is the desk reading it, so the badge clears server-side.
    if (conversation.unread?.admin) {
      conversation.unread.admin = 0;
      store.putConversation(conversation);
      emitChat(conversation.id, 'read', { side: 'admin' });
      broadcastUnread();
    }
    return sendJson(res, 200, {
      conversation,
      customerOnline: customerIsOnline(conversation.id),
      customer: customer ? adminCustomer(customer) : null,
      order: order ? publicOrder(order) : null,
      payments: paymentDetailsForAdmin()
    });
  }

  if (req.method === 'PATCH' && adminChatMatch) {
    const conversation = conversationById(adminChatMatch[1]);
    if (!conversation) return sendJson(res, 404, { error: 'Chat not found' });
    requireConversationScope(req.staff, conversation);
    const body = await readJson(req);
    const text = clampStr(body.text, CHAT_TEXT_MAX);
    const attachment = attachmentFrom(body.attachment);
    const paymentInfo = paymentInfoFrom(body.paymentInfo);
    const nextStatus = body.status === undefined ? null : clampStr(body.status, 20);
    if (nextStatus !== null && !['open', 'resolved'].includes(nextStatus)) return sendJson(res, 422, { error: 'Invalid chat status.' });
    let changed = false;

    // The reply is appended before the status change: closing a thread must not
    // swallow the answer sent in the same action.
    let message = null;
    if (text || attachment || paymentInfo) {
      message = makeMessage('employee', req.staff.name, text || 'Payment details sent.', {
        attachment,
        paymentInfo,
        orderNumber: conversation.orderNumber || undefined
      });
      await appendMessage(conversation, message, { reopen: true });
      typingByConversation.delete(conversation.id);
    }

    if (nextStatus !== null) {
      conversation.status = nextStatus;
      conversation.updatedAt = now();
      if (nextStatus === 'resolved') {
        conversation.unread = conversation.unread || { admin: 0, customer: 0 };
        conversation.unread.admin = 0;
        // The visitor still has the closing message to read, so their badge survives it.
        if (!message) conversation.unread.customer = 0;
      }
      changed = true;
      sseBroadcast(`chat:${conversation.id}`, 'status', { status: nextStatus });
      emitChat(conversation.id, 'updated', { conversation: conversationSummary(conversation) });
    }

    if (body.assignedStaffId !== undefined) {
      const target = clampStr(body.assignedStaffId, 40);
      if (target && !db.staff.some((entry) => entry.id === target)) return sendJson(res, 422, { error: 'Choose a current employee.' });
      conversation.assignedStaffId = target || null;
      conversation.updatedAt = now();
      changed = true;
      emitChat(conversation.id, 'updated', { conversation: conversationSummary(conversation) });
    }

    if (body.adminNotes !== undefined) {
      conversation.adminNotes = clampStr(body.adminNotes, 2000);
      conversation.updatedAt = now();
      changed = true;
      emitChat(conversation.id, 'updated', { conversation: conversationSummary(conversation) });
    }

    if (body.read === true && conversation.unread?.admin) {
      conversation.unread.admin = 0;
      changed = true;
      emitChat(conversation.id, 'read', { side: 'admin' });
    }

    if (changed) {
      store.putConversation(conversation);
      broadcastUnread();
    }
    return sendJson(res, 200, { ok: true, message, conversation: conversationSummary(conversation) });
  }

  // An administrator can remove a whole conversation, thread included.
  if (req.method === 'DELETE' && adminChatMatch) {
    requireAdminRole(req);
    const conversation = conversationById(adminChatMatch[1]);
    if (!conversation) return sendJson(res, 404, { error: 'Chat not found.' });
    for (const message of messagesOf(conversation)) {
      const removed = deleteStoredAttachment(message);
      if (removed) await removed;
    }
    store.deleteConversation(conversation.id);
    emitChat(conversation.id, 'conversation-deleted', { conversationId: conversation.id });
    broadcastUnread();
    return sendJson(res, 200, { ok: true });
  }

  const messageDeleteMatch = pathname.match(/^\/api\/admin\/chat\/(T-[A-F0-9]+)\/messages\/([^/]+)$/);
  if (req.method === 'DELETE' && messageDeleteMatch) {
    requireMessageModeration(req.staff);
    const conversation = conversationById(messageDeleteMatch[1]);
    if (!conversation) return sendJson(res, 404, { error: 'Chat not found.' });
    requireConversationScope(req.staff, conversation);
    const messageId = clampStr(decodeURIComponent(messageDeleteMatch[2]), 80);
    const removed = store.deleteMessage(messageId);
    if (!removed) return sendJson(res, 404, { error: 'Message not found.' });
    const attachmentPath = removed.attachment?.path || '';
    const localPath = uploadLocalPath(attachmentPath);
    if (localPath) await fsp.unlink(localPath).catch(() => {});
    conversation.thread = messagesFor(conversation.id);
    const lastMessage = lastMessageOf(conversation);
    conversation.lastMessageAt = lastMessage?.at || conversation.createdAt;
    conversation.updatedAt = now();
    store.putConversation(conversation);
    emitChat(conversation.id, 'message-deleted', {
      messageId,
      conversation: conversationSummary(conversation)
    });
    return sendJson(res, 200, { ok: true, messageId, conversation: conversationSummary(conversation) });
  }

  if (pathname === '/api/admin/chat/stream' && req.method === 'GET') {
    const ticket = readSseToken(url.searchParams.get('sset'));
    if (!ticket?.staff || !['admin', 'employee'].includes(ticket.staff.role)) {
      return sendJson(res, 401, { error: 'Live chat ticket is not valid. Sign in again.' });
    }
    // Agents limited to their assigned threads get a private desk channel, so
    // they never receive another agent's conversations.
    const scoped = ticket.staff.role === 'employee' && ticket.staff.chatScope === 'assigned';
    const channel = scoped ? `admin:chat:staff:${ticket.staff.id}` : 'admin:chat';
    const clients = openSse(req, res, channel, { maxClients: 8 });
    if (scoped) scopedDesks.set(ticket.staff.id, clients);
    adminWatchers += 1;
    broadcastPresence();
    sseWrite(res, 'hello', {
      conversations: visibleConversations(ticket.staff).map(conversationSummary)
        .sort((left, right) => new Date(right.lastMessageAt || 0) - new Date(left.lastMessageAt || 0)),
      online: [...presenceByConversation.keys()],
      support: supportStatus()
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/subscribers') {
    return sendJson(res, 200, { subscribers: [...db.subscribers].reverse() });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// ---------------------------------------------------------------- static + SEO

async function serveStatic(req, res, pathname) {
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  if (relative.includes('\0')) return sendText(res, 400, 'Bad request');
  let filePath;
  if (UPLOADS_DIR !== DEFAULT_UPLOADS_DIR && relative.startsWith(UPLOADS_URL_PREFIX)) {
    filePath = path.resolve(UPLOADS_DIR, `.${relative.slice('/images/uploads'.length)}`);
    if (!filePath.startsWith(UPLOADS_DIR + path.sep)) return sendText(res, 403, 'Forbidden');
  } else {
    filePath = path.resolve(PUBLIC_DIR, `.${relative}`);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, 'Forbidden');
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const etag = `"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }
  const ext = path.extname(filePath).toLowerCase();
  const isAsset = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico', '.woff2'].includes(ext);
  const cache = isAsset ? 'public, max-age=604800' : 'public, max-age=300, must-revalidate';
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cache,
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString()
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath)
    .on('error', () => res.end())
    .pipe(res);
  return true;
}

async function serveSitemap(req, res) {
  const base = baseUrl(req);
  const staticPaths = ['/', '/shop', '/contact', '/policies'];
  const urls = [
    ...staticPaths.map((entry) => ({ loc: base + entry, priority: entry === '/' ? '1.0' : '0.7' })),
    ...db.products.map((product) => ({ loc: `${base}/product/${product.slug}`, priority: '0.8' }))
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((entry) => `  <url><loc>${escapeHtml(entry.loc)}</loc><changefreq>weekly</changefreq><priority>${entry.priority}</priority></url>`)
    .join('\n')}\n</urlset>`;
  sendText(res, 200, xml, MIME['.xml'], { 'Cache-Control': 'public, max-age=3600' });
}

function serveRobots(req, res) {
  const base = baseUrl(req);
  const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /account\nDisallow: /checkout\nDisallow: /order\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`;
  sendText(res, 200, body, MIME['.txt'], { 'Cache-Control': 'public, max-age=3600' });
}

// ---------------------------------------------------------------- router

const PAGE_META = {
  shop: {
    view: 'shop.html',
    title: 'Shop All — VELUNE',
    description: 'Skincare, makeup, haircare, perfume and tools. Barrier-led formulas, honest ingredient lists and a deliberately concise catalogue.',
    path: '/shop',
    ogImage: '/images/editorial/ingredients.jpg',
    scripts: '<script src="/js/shop.js" defer></script>'
  },
  checkout: {
    view: 'checkout.html',
    title: 'Secure Checkout — VELUNE',
    description: 'Complete your VELUNE order.',
    path: '/checkout',
    ogImage: '/images/hero-cosmetics.jpg',
    robots: 'noindex, nofollow',
    scripts: '<script src="/js/checkout.js" defer></script>'
  },
  order: {
    view: 'order.html',
    title: 'Order Tracking — VELUNE',
    description: 'Track your VELUNE order.',
    path: '/order',
    ogImage: '/images/hero-cosmetics.jpg',
    robots: 'noindex, nofollow',
    scripts: '<script src="/js/order.js" defer></script>'
  },
  contact: {
    view: 'contact.html',
    title: 'Contact & Client Care — VELUNE',
    description: 'Reach VELUNE client care by email, WhatsApp or Telegram. Order help, returns and product questions.',
    path: '/contact',
    ogImage: '/images/editorial/formulation.jpg',
    scripts: '<script src="/js/contact.js" defer></script>'
  },
  account: {
    view: 'account.html',
    title: 'Your Account — VELUNE',
    description: 'Sign in to your VELUNE account.',
    path: '/account',
    ogImage: '/images/hero-cosmetics.jpg',
    robots: 'noindex, nofollow',
    scripts: '<script src="/js/account.js" defer></script>'
  },
  policies: {
    view: 'policies.html',
    title: 'Shipping, Returns & Policies — VELUNE',
    description: 'Shipping timelines, returns, privacy, terms and support details for VELUNE.',
    path: '/policies',
    ogImage: '/images/editorial/formulation.jpg',
    scripts: ''
  },
  admin: {
    view: 'admin.html',
    title: 'VELUNE Admin',
    description: 'Store operations.',
    path: '/admin',
    ogImage: '/images/hero-cosmetics.jpg',
    robots: 'noindex, nofollow',
    scripts: '<script src="/js/img-fallback.js" defer></script><script src="/js/admin.js" defer></script>'
  }
};

async function handle(req, res) {
  securityHeaders(req, res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  res.on('finish', () => {
    if (IS_PROD) console.log(`${req.method} ${pathname} ${res.statusCode}`);
  });

  if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD, POST, PATCH, DELETE');
    return sendText(res, 405, 'Method not allowed');
  }

  if (pathname.startsWith('/api/')) {
    try {
      return await handleApi(req, res, url);
    } catch (error) {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message, code: error.code });
      if (error instanceof channels.IntegrationError) {
        return sendJson(res, error.status || 502, { error: error.message, code: 'integration_error' });
      }
      console.error('[api]', error);
      return sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');

  if (pathname === '/sitemap.xml') return serveSitemap(req, res);
  if (pathname === '/robots.txt') return serveRobots(req, res);

  // Hosting platforms sometimes probe the conventional static entry point.
  if (pathname === '/index.html') {
    res.writeHead(308, { Location: '/' });
    return res.end();
  }

  if (pathname === '/') {
    return servePage(req, res, 'home.html', {
      title: 'VELUNE — Skin-first skincare, colour and fragrance',
      description: 'A concise cosmetics catalogue built around barrier care, honest ingredients and textures that feel as good as they look. Free U.S. shipping over $150.',
      path: '/',
      ogImage: '/images/hero-cosmetics.jpg',
      scripts: '<script src="/js/home.js" defer></script>',
      jsonld: [
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'VELUNE',
          url: baseUrl(req),
          logo: `${baseUrl(req)}/favicon.svg`,
          email: db.settings.supportEmail
        },
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: 'VELUNE',
          url: baseUrl(req)
        }
      ]
    });
  }

  if (pathname === '/shop') return servePage(req, res, PAGE_META.shop.view, PAGE_META.shop);
  if (pathname === '/checkout') return servePage(req, res, PAGE_META.checkout.view, PAGE_META.checkout);
  if (pathname === '/order') return servePage(req, res, PAGE_META.order.view, PAGE_META.order);
  if (pathname === '/contact') return servePage(req, res, PAGE_META.contact.view, PAGE_META.contact);
  if (pathname === '/account' || pathname === '/login' || pathname === '/register') {
    return servePage(req, res, PAGE_META.account.view, PAGE_META.account);
  }
  if (pathname === '/policies') return servePage(req, res, PAGE_META.policies.view, PAGE_META.policies);
  if (pathname === '/admin') return servePage(req, res, PAGE_META.admin.view, PAGE_META.admin);

  const storefrontMatch = pathname.match(/^\/store\/([a-z0-9-]+)$/);
  if (storefrontMatch) {
    const record = store.findStoreBySlug(storefrontMatch[1]);
    const owner = record ? db.customers.find((entry) => entry.id === record.customerId) : null;
    const live = record?.status === 'approved' && owner && canUseFeature(owner, 'reseller');
    if (!live) return notFound(req, res);
    const items = store.listInventory(record.customerId)
      .filter((entry) => entry.published)
      .map((entry) => {
        const product = db.products.find((candidate) => candidate.slug === entry.slug);
        if (!product) return null;
        const price = Number.isFinite(entry.price) && entry.price > 0 ? entry.price : product.price;
        return { product, entry, price };
      })
      .filter(Boolean);
    const itemMarkup = items.length
      ? items
          .map(({ product, entry, price }) => {
            const photo = cardImageFor(product);
            return `<article class="store-product" data-store-item data-slug="${escapeHtml(product.slug)}" data-price="${price}" data-stock="${entry.qty}">
            <div class="store-product__media${photo ? '' : ' store-product__media--pending'}">${
              photo
                ? `<img src="${escapeHtml(versionedAsset(photo))}" alt="${escapeHtml(product.name)}" width="400" height="500" loading="lazy" decoding="async">`
                : '<span class="photo-pending__short">Photo coming soon</span>'
            }</div>
            <div class="store-product__body">
              <span class="store-product__category">${escapeHtml(categoryName(product.category))}</span>
              <h3>${escapeHtml(product.name)}</h3>
              <p>${escapeHtml(product.short)}</p>
              <div class="store-product__foot">
                <strong>${escapeHtml(formatMoney(price, requestedCurrency(req)))}</strong>
                ${entry.qty > 0
                  ? `<div class="store-product__buy"><label class="visually-hidden" for="qty-${escapeHtml(product.slug)}">Quantity</label><input id="qty-${escapeHtml(product.slug)}" type="number" min="1" max="${Math.min(entry.qty, 20)}" value="1" data-store-qty><button class="btn btn--small" type="button" data-store-add>Add</button></div>`
                  : '<span class="store-product__sold">Sold out</span>'}
              </div>
            </div>
          </article>`;
          })
          .join('\n')
      : '<div class="empty-state"><h2>Nothing published yet.</h2><p>This store is still setting up its shelves. Check back soon.</p></div>';
    const firstPhoto = items.find(({ product }) => photoPathFor(product));
    const storeJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Store',
      name: record.name,
      description: record.tagline || record.about,
      url: `${baseUrl(req)}/store/${record.slug}`,
      email: record.contactEmail,
      parentOrganization: { '@type': 'Organization', name: 'VELUNE' }
    };
    return servePage(req, res, 'store.html', {
      title: `${record.name} — VELUNE`,
      description: record.tagline || record.about || `Shop ${record.name} on VELUNE.`,
      path: `/store/${record.slug}`,
      ogImage: firstPhoto ? versionedAsset(firstPhoto.product.image) : '/images/hero-cosmetics.jpg',
      scripts: '<script src="/js/store-page.js" defer></script>',
      tokens: {
        '{{STORE_NAME}}': escapeHtml(record.name),
        '{{STORE_TAGLINE}}': escapeHtml(record.tagline || 'An independent beauty edit, fulfilled by VELUNE.'),
        '{{STORE_ABOUT}}': escapeHtml(record.about || ''),
        '{{STORE_SLUG}}': escapeHtml(record.slug),
        '{{STORE_CONTACT_EMAIL}}': escapeHtml(record.contactEmail || ''),
        '{{STORE_ITEM_COUNT}}': String(items.length),
        '{{STORE_ITEMS}}': itemMarkup
      },
      jsonld: storeJsonLd
    });
  }

  const productMatch = pathname.match(/^\/product\/([a-z0-9-]+)$/);
  if (productMatch) {
    const product = db.products.find((entry) => entry.slug === productMatch[1]);
    if (!product) return notFound(req, res);
    const base = baseUrl(req);
    const badge = product.stock < 1 ? 'Sold out' : product.badge || '';
    const badgeMarkup = badge
      ? `<span class="product-badge${product.stock < 1 ? ' product-badge--sold' : ''}">${escapeHtml(badge)}</span>`
      : '';
    const priceText = moneyFor(req, product.price);
    const compareMarkup =
      product.compareAt && product.compareAt > product.price
        ? ` <s>${moneyFor(req, product.compareAt)}</s> <span class="save">Save ${Math.round((1 - product.price / product.compareAt) * 100)}%</span>`
        : '';
    const variantsMarkup = (product.variants || [])
      .map(
        (variant) => `<div class="variant-group" data-variant-group data-variant-name="${escapeHtml(variant.name)}">
          <div class="variant-label">${escapeHtml(variant.name)}: <strong data-variant-value>${escapeHtml(variant.options[0] || '')}</strong></div>
          <div class="variant-options">
            ${variant.options
              .map(
                (option, index) =>
                  `<button type="button" class="variant-btn${index === 0 ? ' is-selected' : ''}" data-variant-option="${escapeHtml(option)}">${escapeHtml(option)}</button>`
              )
              .join('')}
          </div>
        </div>`
      )
      .join('');
    const stockText =
      product.stock < 1 ? 'Out of stock — check back soon' : product.stock <= 5 ? `Only ${product.stock} left` : 'In stock — ready to ship';
    const stockClass = product.stock < 1 ? 'is-out' : product.stock <= 5 ? 'is-low' : '';
    const photo = photoPathFor(product);
    const photoUrl = photo ? versionedAsset(photo) : '';
    const cardUrl = photo ? versionedAsset(cardImageFor(product)) : '';
    // Vector packshots are no longer shown. A SKU without an owner-supplied
    // photograph is marked as awaiting photography rather than illustrated.
    const mediaMarkup = photoUrl
      ? `<img src="${escapeHtml(photoUrl)}" srcset="${escapeHtml(cardUrl)} 400w, ${escapeHtml(photoUrl)} 800w"
                 sizes="(min-width: 921px) 52vw, 100vw" alt="${escapeHtml(product.name)}" width="800" height="1000"
                 data-fallback-src="" decoding="async" fetchpriority="high" data-pdp-image>`
      : `<div class="pdp-media__pending" data-pdp-placeholder role="img" aria-label="${escapeHtml(product.name)} — photo coming soon">
                 <span class="pdp-media__eyebrow">Studio photography</span>
                 <strong>Photo coming soon</strong>
                 <span>This piece is awaiting its official product photograph.</span>
               </div>`;
    return servePage(req, res, 'product.html', {
      title: `${product.name} — VELUNE`,
      description: product.short || product.description.slice(0, 150),
      path: `/product/${product.slug}`,
      ogImage: photoUrl || '/images/hero-cosmetics.jpg',
      ogType: 'product',
      scripts: '<script src="/js/product.js" defer></script>',
      tokens: {
        '{{PRODUCT_NAME}}': escapeHtml(product.name),
        '{{PRODUCT_CATEGORY}}': escapeHtml(categoryName(product.category)),
        '{{PRODUCT_CATEGORY_SLUG}}': escapeHtml(product.category),
        '{{PRODUCT_MEDIA}}': mediaMarkup,
        '{{PRODUCT_CARD_IMAGE}}': escapeHtml(cardUrl),
        '{{PRODUCT_IMAGE}}': escapeHtml(photoUrl),
        '{{PRODUCT_ARTWORK}}': '',
        '{{PRODUCT_PRICE}}': priceText + compareMarkup,
        '{{PRODUCT_SHORT}}': escapeHtml(product.short),
        '{{PRODUCT_DESCRIPTION}}': escapeHtml(product.description),
        '{{PRODUCT_DETAILS}}': product.details.map((line) => `<li>${escapeHtml(line)}</li>`).join(''),
        '{{PRODUCT_SPECS}}': product.specs
          .map((spec) => `<tr><td>${escapeHtml(spec.k)}</td><td>${escapeHtml(spec.v)}</td></tr>`)
          .join(''),
        '{{PRODUCT_VARIANTS}}': variantsMarkup,
        '{{PRODUCT_STOCK_TEXT}}': escapeHtml(stockText),
        '{{PRODUCT_STOCK_CLASS}}': stockClass,
        '{{PRODUCT_BADGE}}': badgeMarkup,
        '{{PRODUCT_RATING}}': Number(product.rating).toFixed(1),
        '{{PRODUCT_REVIEWS}}': String(product.reviewCount),
        '{{PRODUCT_SKU}}': escapeHtml(product.id)
      },
      jsonld: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        image: photoUrl ? [base + photoUrl] : undefined,
        description: product.short,
        sku: product.id,
        brand: { '@type': 'Brand', name: 'VELUNE' },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: product.rating,
          reviewCount: product.reviewCount
        },
        offers: {
          '@type': 'Offer',
          url: `${base}/product/${product.slug}`,
          priceCurrency: 'USD',
          price: product.price.toFixed(2),
          availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          itemCondition: 'https://schema.org/NewCondition'
        }
      }
    });
  }

  if (pathname === '/favicon.ico' && !fs.existsSync(path.join(PUBLIC_DIR, 'favicon.ico'))) {
    res.writeHead(302, { Location: '/favicon.svg' });
    return res.end();
  }

  const served = await serveStatic(req, res, pathname);
  if (served) return;

  return notFound(req, res);
}

const server = http.createServer((req, res) => {
  res.acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  handle(req, res).catch((error) => {
    console.error('[fatal]', error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
    else res.end();
  });
});

// Create the persistent directories up front so a missing or read-only volume
// surfaces in the startup log and the health check, not the first upload.
for (const directory of [UPLOADS_DIR, PROOFS_DIR, store.PRIVATE_DIR]) {
  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch (error) {
    console.error(`[storage] cannot create ${directory}: ${error.message}`);
  }
}

// The storefront is rendered from disk on every request, so a deploy that
// omits views/ answers 404 on / with no other clue. Check the entry points at
// boot and point at the real cause (wrong root/publish directory, or a Static
// Site deploy that never runs this server).
const REQUIRED_FRONTEND_FILES = [
  'views/home.html',
  'views/partials/header.html',
  'views/partials/footer.html',
  'public/css/styles.css',
  'public/favicon.svg'
];
const missingFrontendFiles = REQUIRED_FRONTEND_FILES.filter(
  (relative) => !fs.existsSync(path.join(__dirname, relative))
);
if (missingFrontendFiles.length) {
  console.error(
    `[startup] missing frontend files under ${__dirname}: ${missingFrontendFiles.join(', ')}\n` +
    '          GET / will return 404 until these are deployed. This app is server-rendered:\n' +
    '          run it as a Node web service (npm start) with the repository root as the\n' +
    '          root directory, not as a static site.'
  );
}

ensureAdminCredentials().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`\n  VELUNE is running at http://localhost:${PORT}`);
    console.log(`  Data: ${store.DATA_DIR}`);
    console.log(`  Uploads: ${UPLOADS_DIR}`);
    console.log(`  Admin: http://localhost:${PORT}/admin (username: ${process.env.ADMIN_USERNAME || db.settings.adminUsername || ADMIN_USERNAME})`);
    const passwordSource = process.env.ADMIN_PASSWORD_HASH
      ? 'ADMIN_PASSWORD_HASH (env)'
      : process.env.ADMIN_PASSWORD
        ? 'ADMIN_PASSWORD (env)'
        : db.settings.adminPasswordHash
          ? 'stored hash in data/velune.db'
          : 'none — see one-time password above';
    console.log(`  Admin password source: ${passwordSource}`);
    const delivery = deliveryMode();
    console.log(`  Catalogue: ${db.products.length} products across ${db.categories.length} categories`);
    console.log(`  Verification delivery: email=${delivery.email} sms=${delivery.sms}${delivery.live ? '' : '  (codes are recorded under Admin → Delivery until credentials are set)'}`);
    if (IS_PROD && (!process.env.DATA_DIR || !process.env.UPLOADS_DIR)) {
      console.warn(
        '  WARNING: DATA_DIR and/or UPLOADS_DIR are not set in production. The database and uploaded\n' +
        '           images are in the application directory and can disappear on the next deploy.\n' +
        '           Mount a persistent volume and set DATA_DIR and UPLOADS_DIR before taking orders.\n'
      );
    }
    if (!IS_PROD && !process.env.ADMIN_SECRET) {
      console.log('  Note: set ADMIN_SECRET (and ADMIN_PASSWORD for a fixed password) before exposing this server publicly.\n');
    }
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log('\n  Shutting down…');
    // SQLite writes are synchronous, so there is nothing to flush beyond the
    // settings cache; closing the handle is enough.
    server.close(() => {
      try {
        store.sqlite.close();
      } catch {
        /* already closed */
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
