import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, pngBase64 } from './helpers.mjs';

let server;
let api;
const password = 'correcthorsebattery';

before(async () => {
  server = await startServer({ env: { OTP_ENFORCE: 'true' } });
  api = server.api;
});

after(async () => {
  await server.stop();
});

async function register(overrides = {}) {
  const email = overrides.email || `user${Date.now()}${Math.random().toString(16).slice(2, 6)}@example.com`;
  const mobile = overrides.mobile || `+1415555${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const response = await api.post(
    '/api/auth/register',
    {
      fullName: 'Asha Verma',
      email,
      mobile,
      password,
      confirmPassword: password,
      ...overrides
    },
    { guest: true }
  );
  return response;
}

async function verifyBoth(payload) {
  for (const entry of payload.codes) {
    if (!entry.code) continue;
    const response = await api.post('/api/auth/otp/verify', { purpose: entry.purpose, code: entry.code });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }
  return (await api.get('/api/account/verification')).body.verification;
}

test('registration validates identity, email, mobile and password', async () => {
  const missingName = await api.post('/api/auth/register', { email: 'x@example.com', mobile: '+14155550123', password, confirmPassword: password }, { guest: true });
  assert.equal(missingName.status, 422);

  const badEmail = await register({ email: 'not-an-email' });
  assert.equal(badEmail.status, 422);

  const badMobile = await register({ mobile: 'abc' });
  assert.equal(badMobile.status, 422);

  const shortPassword = await register({ password: 'short', confirmPassword: 'short' });
  assert.equal(shortPassword.status, 422);

  const mismatch = await register({ confirmPassword: 'differentpass1' });
  assert.equal(mismatch.status, 422);

  const honeypot = await api.post('/api/auth/register', { website: 'http://spam', email: 'bot@example.com' }, { guest: true });
  assert.equal(honeypot.status, 201);
  assert.equal(honeypot.body.customer, undefined);
});

test('a new account must verify both contacts and pass document review', async () => {
  api.clearSession();
  const email = `kyc${Date.now()}@example.com`;
  const response = await register({ email });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.customer.email, email);
  assert.equal(response.body.customer.kycStatus, 'unverified');
  assert.ok(response.body.codes.some((entry) => entry.purpose === 'email' && entry.code));
  assert.ok(response.body.codes.some((entry) => entry.purpose === 'phone' && entry.code));

  const duplicate = await register({ email });
  assert.equal(duplicate.status, 409);

  // Checkout is locked before verification when enforcement is on.
  const products = await api.get('/api/products');
  const product = products.body.products[0];
  const blocked = await api.post('/api/orders', {
    customer: { firstName: 'Asha', lastName: 'Verma', email, phone: '+14155550123' },
    shipping: { address1: '1200 Harbor Ave', city: 'Portland', state: 'OR', zip: '97202', country: 'US' },
    items: [{ slug: product.slug, qty: 1 }],
    shippingMethod: 'standard'
  });
  assert.equal(blocked.status, 403);

  const verification = await verifyBoth(response.body);
  assert.equal(verification.status, 'unverified');
  assert.equal(verification.contactsVerified, true);
  assert.equal(verification.canCheckout, true);
  assert.equal(verification.canReseller, false);

  const docs = await api.post('/api/account/verification/documents', {
    docType: 'aadhaar',
    front: `data:image/png;base64,${pngBase64()}`,
    back: `data:image/png;base64,${pngBase64()}`
  });
  assert.equal(docs.status, 201, JSON.stringify(docs.body));
  assert.equal(docs.body.documents.uploaded, 2);
  assert.equal(docs.body.verification.status, 'pending');
  assert.equal(docs.body.verification.canReseller, false);

  // Private files never appear under the public web root.
  const privateUrl = await api.get('/data/private/documents/anything.png');
  assert.equal(privateUrl.status, 404);

  const docsIds = docs.body.verification.documents.map((document) => document.id);
  assert.ok(docsIds.length >= 2);
  for (const id of docsIds) {
    const own = await api.get(`/api/account/verification/documents/${id}/view`);
    assert.equal(own.status, 200);
    assert.match(own.headers.get('content-type') || '', /image\/png/);
  }

  // A second customer cannot read those documents.
  const otherResponse = await register();
  const otherToken = otherResponse.body.token;
  const denied = await api.get(`/api/account/verification/documents/${docsIds[0]}/view`, {
    headers: { 'x-velune-customer': otherToken },
    guest: true
  });
  assert.equal(denied.status, 404);

  // Admins can review and approve; the customer's status moves to approved.
  const customerId = response.body.customer.id;
  await adminLogin(api);
  const queue = await api.get('/api/admin/verification');
  assert.equal(queue.status, 200);
  const queued = queue.body.customers.find((row) => row.id === customerId);
  assert.equal(queued.documentsPending, true);

  const view = await api.get(`/api/admin/verification/${customerId}/documents/${docsIds[0]}`);
  assert.equal(view.status, 200);
  assert.match(view.headers.get('content-type') || '', /image\/png/);

  const approve = await api.patch(`/api/admin/verification/${customerId}`, { status: 'approved', note: 'Readable document.' });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal(approve.body.verification.status, 'approved');
  assert.equal(approve.body.verification.canReseller, true);

  api.useCustomerToken(response.body.token);
  const after = await api.get('/api/account/verification');
  assert.equal(after.body.verification.status, 'approved');
  assert.equal(after.body.verification.canReseller, true);

  // The approved customer can now check out.
  const allowed = await api.post('/api/orders', {
    customer: { firstName: 'Asha', lastName: 'Verma', email, phone: '+14155550123' },
    shipping: { address1: '1200 Harbor Ave', city: 'Portland', state: 'OR', zip: '97202', country: 'US' },
    items: [{ slug: product.slug, qty: 1 }],
    shippingMethod: 'standard',
    idempotencyKey: `kyc-${Date.now()}`
  });
  assert.equal(allowed.status, 201, JSON.stringify(allowed.body));
});

test('identity preview defaults to a light stage and offers a persisted light/dark toggle', async () => {
  const script = await api.get('/js/admin.js', { guest: true });
  assert.equal(script.status, 200);
  const js = String(script.body);
  assert.match(js, /velune\.admin\.docPreviewTheme/, 'the preview theme preference must be stored');
  assert.match(js, /data-doc-theme="light"/, 'the light preview control is missing');
  assert.match(js, /data-doc-theme="dark"/, 'the dark preview control is missing');
  assert.match(js, /classList\.toggle\('is-dark'/, 'the control must switch the preview stage');

  const styles = await api.get('/css/admin.css', { guest: true });
  assert.equal(styles.status, 200);
  const css = String(styles.body);
  assert.match(css, /\.vf-doc__preview \{[\s\S]*?--doc-stage: var\(--paper\)/, 'the preview must default to a light stage');
  assert.match(css, /\.vf-doc__preview\.is-dark \{/, 'the dark stage override is missing');
});

test('login, session restore and password change invalidate older tokens', async () => {
  const email = `login${Date.now()}@example.com`;
  const reg = await register({ email });
  assert.equal(reg.status, 201);
  const firstToken = reg.body.token;
  const passwordHash = sqliteHash(server.dbPath(), email);
  assert.match(passwordHash, /^scrypt\$/, 'password must be stored as a scrypt hash');

  api.clearSession();
  const wrong = await api.post('/api/auth/login', { email, password: 'wrong-password' }, { guest: true });
  assert.equal(wrong.status, 401);

  const login = await api.post('/api/auth/login', { email, password }, { guest: true });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
  api.useCustomerToken(login.body.token);

  const session = await api.get('/api/auth/session');
  assert.equal(session.body.customer.email, email);

  const changed = await api.post('/api/account/password', { currentPassword: password, newPassword: 'an-even-longer-password' });
  assert.equal(changed.status, 200);
  const newToken = changed.body.token;
  assert.notEqual(newToken, login.body.token);

  const staleSession = await api.get('/api/auth/session', { headers: { 'x-velune-customer': login.body.token }, guest: true });
  assert.equal(staleSession.body.customer, null, 'the old session version must be rejected');

  api.useCustomerToken(newToken);
  const fresh = await api.get('/api/auth/session');
  assert.equal(fresh.body.customer.email, email);
  assert.ok(firstToken);
});

test('changing a verified mobile number clears its verification', async () => {
  api.clearSession();
  const reg = await register({ mobile: '+14155550188' });
  assert.equal(reg.status, 201);
  await verifyBoth(reg.body);
  api.useCustomerToken(reg.body.token);
  const before = await api.get('/api/account/verification');
  assert.equal(before.body.verification.phone.verified, true);

  const update = await api.patch('/api/account', { phone: '+14155550177' });
  assert.equal(update.status, 200, JSON.stringify(update.body));
  const after = await api.get('/api/account/verification');
  assert.equal(after.body.verification.phone.verified, false, 'a changed number must be re-verified');
  assert.equal(after.body.verification.phone.number, '+14155550177');

  const unchanged = await api.patch('/api/account', { phone: reg.body.customer.phone });
  assert.equal(unchanged.status, 200, 'an unchanged number needs no re-verification');
  const stillVerified = await api.get('/api/account/verification');
  assert.equal(stillVerified.body.verification.phone.verified, false);
});

test('a mobile number already used by another account is refused', async () => {
  api.clearSession();
  const mobile = '+14155550155';
  assert.equal((await register({ mobile })).status, 201);
  api.clearSession();
  assert.equal((await register({ mobile })).status, 409);
});

test('registration rejects an email or mobile already in use', async () => {
  api.clearSession();
  const email = `unique${Date.now()}@example.com`;
  const mobile = '+14155550166';
  assert.equal((await register({ email, mobile })).status, 201);
  assert.equal((await register({ email: `other${Date.now()}@example.com`, mobile })).status, 409);
});

test('profile updates are validated and escaped', async () => {
  api.clearSession();
  const reg = await register();
  api.useCustomerToken(reg.body.token);
  assert.equal((await api.patch('/api/account', { firstName: 'A' })).status, 422);
  const script = '<script>alert(1)</script>';
  const response = await api.patch('/api/account', { firstName: 'Asha', lastName: script });
  assert.equal(response.status, 200);
  assert.equal(response.body.customer.lastName, script);
  const page = await api.get('/account');
  assert.doesNotMatch(page.body, /<script>alert\(1\)<\/script>/);
});

function sqliteHash(dbPath, email) {
  // Read the SQLite row directly to prove hashing at rest, not just in the API.
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT password_hash FROM customers WHERE email = ?').get(email.toLowerCase());
    return row?.password_hash || '';
  } finally {
    db.close();
  }
}
