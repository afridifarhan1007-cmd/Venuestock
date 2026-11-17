// ---------------------------------------------------------------- message delivery
// Outbound email and SMS for verification codes and receipts. Zero npm
// dependencies: node:net/node:tls for SMTP and node:https for SMS REST APIs.
//
// When no provider is configured the message is written to the `outbox`
// table and shown under Admin → Delivery, so registration and verification
// flows can be tested end to end before SMTP or SMS credentials exist.
// Nothing here ever returns a code to a public API response.

import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import * as store from './store.js';

const SMTP_TIMEOUT_MS = 12_000;
const SMS_TIMEOUT_MS = 10_000;

const config = () => ({
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
    username: process.env.SMTP_USERNAME || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USERNAME || 'velune@localhost',
    enabled: process.env.OTP_EMAIL_ENABLED === 'true'
  },
  sms: {
    provider: (process.env.SMS_PROVIDER || '').toLowerCase(),
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.SMS_FROM || process.env.TWILIO_FROM || '',
    msg91Route: process.env.MSG91_ROUTE || 'ENGLISH',
    msg91Key: process.env.MSG91_AUTH_KEY || '',
    webhookUrl: process.env.SMS_WEBHOOK_URL || '',
    enabled: process.env.OTP_SMS_ENABLED === 'true'
  }
});

export function deliveryMode() {
  const cfg = config();
  return {
    email: cfg.smtp.enabled && cfg.smtp.host ? 'smtp' : 'outbox',
    sms: cfg.sms.enabled && (cfg.sms.provider || cfg.sms.webhookUrl) ? cfg.sms.provider || 'webhook' : 'outbox',
    live: Boolean((cfg.smtp.enabled && cfg.smtp.host) || (cfg.sms.enabled && (cfg.sms.provider || cfg.sms.webhookUrl)))
  };
}

function readEnvBanner() {
  const mode = deliveryMode();
  return { email: mode.email, sms: mode.sms };
}

// ---------------------------------------------------------------- SMTP client

class SmtpSession {
  constructor(socket, log) {
    this.socket = socket;
    this.log = log;
    this.buffer = '';
    this.waiter = null;
    socket.on('data', (chunk) => this.receive(chunk.toString('utf8')));
  }

  receive(chunk) {
    this.buffer += chunk;
    // A reply line ends with CRLF; the third digit being a space means "final".
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line) continue;
      this.log.push(line);
      if (/^\d{3} /.test(line) && this.waiter) {
        const resolve = this.waiter;
        this.waiter = null;
        resolve(line);
      }
    }
  }

  expect() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error('SMTP reply timed out'));
      }, SMTP_TIMEOUT_MS);
      this.waiter = (reply) => {
        clearTimeout(timer);
        resolve(reply);
      };
    });
  }

  async command(line, ...accept) {
    this.log.push(`> ${line.replace(/[^\x20-\x7e]/g, '')}`.replace(/AUTH PLAIN .*/, 'AUTH PLAIN [redacted]'));
    const reply = await this.expect();
    this.socket.write(`${line}\r\n`);
    const code = Number(reply.slice(0, 3));
    if (accept.length && !accept.includes(code)) throw new Error(`SMTP ${code}: ${reply.trim()}`);
    return reply;
  }

  // Wait for the server greeting before issuing commands.
  async hello() {
    const reply = await this.expect();
    const code = Number(reply.slice(0, 3));
    if (code !== 220) throw new Error(`SMTP greeting failed: ${reply.trim()}`);
    return reply;
  }

  destroy() {
    try {
      this.socket.removeAllListeners('data');
      this.socket.end('QUIT\r\n', () => this.socket.destroy());
    } catch {
      this.socket.destroy();
    }
  }
}

function smtpConnect(cfg) {
  return new Promise((resolve, reject) => {
    const log = [];
    const timer = setTimeout(() => reject(new Error('SMTP connect timed out')), SMTP_TIMEOUT_MS);
    if (cfg.secure) {
      const socket = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }, () => {
        clearTimeout(timer);
        resolve({ socket, log, secure: true });
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      return;
    }
    const socket = net.connect({ host: cfg.host, port: cfg.port }, () => {
      clearTimeout(timer);
      resolve({ socket, log, secure: false });
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host }, () => resolve(secure));
    secure.once('error', reject);
    setTimeout(() => reject(new Error('STARTTLS timed out')), SMTP_TIMEOUT_MS).unref();
  });
}

async function smtpSend(cfg, message) {
  const { socket, log } = await smtpConnect(cfg);
  const session = new SmtpSession(socket, log);
  try {
    await session.hello();
    const hostname = process.env.SMTP_EHLO_HOST || 'localhost';
    await session.command(`EHLO ${hostname}`, 250);
    if (!cfg.secure) {
      await session.command('STARTTLS', 220);
      const secureSocket = await upgradeToTls(socket, cfg.host);
      session.socket = secureSocket;
      secureSocket.on('data', (chunk) => session.receive(chunk.toString('utf8')));
      await session.command(`EHLO ${hostname}`, 250);
    }
    if (cfg.username) {
      const token = Buffer.from(`\u0000${cfg.username}\u0000${cfg.password}`).toString('base64');
      await session.command(`AUTH PLAIN ${token}`, 235);
    }
    await session.command(`MAIL FROM:<${cfg.from}>`, 250);
    await session.command(`RCPT TO:<${message.to}>`, 250, 251);
    await session.command('DATA', 354);
    const body = buildMime(message);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SMTP data timed out')), SMTP_TIMEOUT_MS);
      session.socket.write(`${body}\r\n.\r\n`, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const reply = await session.expect();
    if (!/^2\d\d /.test(reply)) throw new Error(`SMTP accept failed: ${reply.trim()}`);
    return reply;
  } finally {
    session.destroy();
  }
}

function buildMime(message) {
  const boundary = `velune-${Date.now().toString(36)}`;
  const headers = [
    `From: ${message.fromName ? `${message.fromName} <${message.from}>` : message.from}`,
    `To: <${message.to}>`,
    `Subject: ${encodeHeader(message.subject)}`,
    'Date: ' + new Date().toUTCString(),
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    dotStuff(message.text || ''),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    dotStuff(message.html || wrapHtml(message.text || '')),
    `--${boundary}--`
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

// SMTP forbids a line starting with a period unless it is escaped.
function dotStuff(body) {
  return String(body).replace(/^\./gm, '..');
}

function encodeHeader(value) {
  return /[^\x20-\x7e]/.test(value) ? `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=` : value;
}

function wrapHtml(text) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1c1a17">${String(text)
    .split('\n')
    .map((line) => `<p style="margin:0 0 10px">${escapeText(line)}</p>`)
    .join('')}</div>`;
}

function escapeText(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

// ---------------------------------------------------------------- SMS adapters

function httpPostJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return reject(new Error('Invalid SMS endpoint URL'));
    }
    const body = JSON.stringify(payload);
    const request = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
        timeout: SMS_TIMEOUT_MS
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode >= 200 && response.statusCode < 300) resolve({ ok: true, text });
          else reject(new Error(`SMS ${response.statusCode}: ${text.slice(0, 200)}`));
        });
      }
    );
    request.on('timeout', () => request.destroy(new Error('SMS request timed out')));
    request.on('error', reject);
    request.end(body);
  });
}

function httpPostForm(url, params, headers = {}) {
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return reject(new Error('Invalid SMS endpoint URL'));
    }
    const request = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          ...headers
        },
        timeout: SMS_TIMEOUT_MS
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode >= 200 && response.statusCode < 300) resolve({ ok: true, text });
          else reject(new Error(`SMS ${response.statusCode}: ${text.slice(0, 200)}`));
        });
      }
    );
    request.on('timeout', () => request.destroy(new Error('SMS request timed out')));
    request.on('error', reject);
    request.end(body);
  });
}

async function smsSend(cfg, message) {
  const digits = String(message.to).replace(/[^\d+]/g, '');
  if (cfg.provider === 'twilio' && cfg.accountSid && cfg.authToken && cfg.from) {
    const basic = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
    return httpPostForm(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`,
      { To: digits, From: cfg.from, Body: message.text },
      { Authorization: `Basic ${basic}` }
    );
  }
  if (cfg.provider === 'msg91' && cfg.msg91Key) {
    return httpPostJson(
      'https://api.msg91.com/api/v5/sms',
      { route: cfg.msg91Route, country: 91, sms: [{ message: message.text, mobile_no: [digits], sender: cfg.from || 'VELUNE' }] },
      { authkey: cfg.msg91Key }
    );
  }
  if (cfg.webhookUrl) {
    return httpPostJson(cfg.webhookUrl, { to: digits, message: message.text, template: message.template || 'otp' });
  }
  throw new Error('No SMS provider is configured');
}

// ---------------------------------------------------------------- public API

// Both channels record every attempt in the outbox so the admin can see what
// was sent, what failed, and (in outbox mode) the code itself.
export async function sendVerificationEmail({ to, subject, text, html }) {
  const cfg = config().smtp;
  const message = { to, subject, text, html, from: cfg.from, fromName: 'VELUNE' };
  const seq = store.pushOutbox({ channel: 'email', to, subject, body: `${text}\n\n${html || ''}` });
  if (!(cfg.enabled && cfg.host)) {
    store.markOutbox(seq, 'outbox', 'SMTP not configured — visible under Admin → Delivery');
    return { delivered: false, channel: 'outbox', seq };
  }
  try {
    await smtpSend(cfg, message);
    store.markOutbox(seq, 'sent');
    return { delivered: true, channel: 'smtp', seq };
  } catch (error) {
    store.markOutbox(seq, 'failed', error.message);
    console.error('[email] delivery failed:', error.message);
    return { delivered: false, channel: 'smtp', seq, error: error.message };
  }
}

export async function sendVerificationSms({ to, text, template = 'otp' }) {
  const cfg = config().sms;
  const seq = store.pushOutbox({ channel: 'sms', to, subject: template, body: text });
  if (!(cfg.enabled && (cfg.provider || cfg.webhookUrl))) {
    store.markOutbox(seq, 'outbox', 'SMS provider not configured — visible under Admin → Delivery');
    return { delivered: false, channel: 'outbox', seq };
  }
  try {
    await smsSend(cfg, { to, text, template });
    store.markOutbox(seq, 'sent');
    return { delivered: true, channel: cfg.provider || 'webhook', seq };
  } catch (error) {
    store.markOutbox(seq, 'failed', error.message);
    console.error('[sms] delivery failed:', error.message);
    return { delivered: false, channel: cfg.provider || 'webhook', seq, error: error.message };
  }
}

export function verificationOtpText(code, channel) {
  return channel === 'sms'
    ? `Your VELUNE verification code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`
    : `Your VELUNE verification code is ${code}.\n\nIt expires in 10 minutes. Do not share this code with anyone, and never send it to a person claiming to be our support team.\n\nIf you did not request this code, ignore this email.`;
}

export const deliveryStatus = readEnvBanner;
