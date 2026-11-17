// Test harness: boots a real VELUNE server on a free port with a throwaway
// database, and gives request helpers that mirror what the browser does
// (cookie + header auth, same-origin checks).
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// A structurally valid PNG (real magic bytes, real chunks) so upload validators
// that sniff content types accept it.
export function pngBase64({ width = 64, height = 64 } = {}) {
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 8;
    crcTable[n] = c >>> 0;
  }
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = rowStart + 1 + x * 4;
      raw[i] = (x * 3) % 256;
      raw[i + 1] = (y * 5) % 256;
      raw[i + 2] = (x + y) % 256;
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  return bytes.toString('base64');
}

export async function startServer({ prefix = 'velune-test', env = {} } = {}) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const dbPath = path.join(dir, 'test.db');
  // Keep runtime state (database, KYC documents, uploads, integration key) in
  // the throwaway directory, exactly as a mounted volume would in production.
  const dataDir = path.join(dir, 'data');
  const uploadsDir = path.join(dir, 'uploads');
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      HOST: '127.0.0.1',
      STORE_DB_PATH: dbPath,
      DATA_DIR: dataDir,
      UPLOADS_DIR: uploadsDir,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'test-admin-password',
      ADMIN_SECRET: 'test-admin-secret',
      SESSION_SECRET: 'test-session-secret',
      SITE_URL: `http://127.0.0.1:${port}`,
      OTP_DEV_ECHO: 'true',
      OTP_ENFORCE: 'false',
      RATE_LIMIT_DISABLED: 'true',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (!healthy) {
    throw new Error(`Server did not become healthy.\n${logs.join('')}`);
  }

  const api = makeApi(baseUrl);
  return {
    baseUrl,
    api,
    dbPath: () => dbPath,
    dir,
    logs: () => logs.join(''),
    async stop({ keepData = false } = {}) {
      if (!child.killed) {
        child.kill('SIGTERM');
        await new Promise((resolve) => {
          const timer = setTimeout(() => child.kill('SIGKILL') && resolve(), 4_000);
          child.on('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      if (!keepData) fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

export function makeApi(baseUrl) {
  const state = { cookies: new Map(), adminToken: null, customerToken: null };

  function cookieHeader() {
    return [...state.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  function absorbCookies(response) {
    const setCookie = response.headers.getSetCookie?.() || [];
    for (const line of setCookie) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!value || value === '""') state.cookies.delete(key);
      else state.cookies.set(key, value);
    }
  }

  async function request(method, route, { body, headers = {}, token, guest = false, origin = baseUrl } = {}) {
    const finalHeaders = { ...headers };
    if (origin) finalHeaders.origin = origin;
    if (body !== undefined && finalHeaders['content-type'] === undefined) {
      finalHeaders['content-type'] = 'application/json';
    }
    if (token) finalHeaders.authorization = `Bearer ${token}`;
    else if (state.adminToken && !guest) finalHeaders.authorization = `Bearer ${state.adminToken}`;
    if (state.customerToken && !guest) finalHeaders['x-velune-customer'] = state.customerToken;
    const cookies = cookieHeader();
    if (cookies && !guest) finalHeaders.cookie = cookies;

    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    });
    absorbCookies(response);
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return { status: response.status, ok: response.ok, body: payload, headers: response.headers };
  }

  return {
    state,
    request,
    get: (route, options) => request('GET', route, options),
    post: (route, body, options) => request('POST', route, { ...options, body }),
    patch: (route, body, options) => request('PATCH', route, { ...options, body }),
    del: (route, options) => request('DELETE', route, options),
    useAdminToken(token) {
      state.adminToken = token;
    },
    useCustomerToken(token) {
      state.customerToken = token;
    },
    clearSession() {
      state.cookies.clear();
      state.customerToken = null;
    }
  };
}

export async function adminLogin(api, { username = 'admin', password = 'test-admin-password' } = {}) {
  const response = await api.post('/api/admin/login', { username, password }, { guest: true });
  if (response.status !== 200) {
    throw new Error(`Admin login failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  api.useAdminToken(response.body.token);
  return response.body;
}

export async function registerCustomer(api, { first = 'Asha', last = 'Verma', email, mobile, password = 'correcthorsebattery', extra = {} } = {}) {
  const address = email || `customer${Date.now()}@example.com`;
  const response = await api.post(
    '/api/auth/register',
    { fullName: `${first} ${last}`, firstName: first, lastName: last, email: address, mobile, password, confirmPassword: password, ...extra },
    { guest: true }
  );
  if (response.status !== 201) {
    throw new Error(`Registration failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  api.useCustomerToken(response.body.token);
  return response.body;
}

// Extracts the echoed codes when the delivery provider is not configured.
export function echoedCodes(dispatch, purpose) {
  const entry = (dispatch || []).find((item) => item.purpose === purpose);
  return entry?.code || null;
}

export const usAddress = () => ({
  customer: { firstName: 'Nora', lastName: 'Alvarez', email: `buyer${Date.now()}@example.com`, phone: '+1 415 555 0132' },
  shipping: { address1: '1200 Harbor Ave', address2: '', city: 'Portland', state: 'OR', zip: '97202', country: 'US' }
});

export const inAddress = (phone = '98765 43210') => ({
  customer: { firstName: 'Rhea', lastName: 'Kapoor', email: `buyer${Date.now()}@example.com`, phone },
  shipping: { address1: '14 Linking Road', address2: '', city: 'Mumbai', state: 'Maharashtra', zip: '400012', country: 'IN' }
});
