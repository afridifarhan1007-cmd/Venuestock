import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, ROOT } from './helpers.mjs';

let server;
let api;
let conversation;
let visitorId;

before(async () => {
  server = await startServer();
  api = server.api;
  visitorId = `vis_test${Date.now().toString(36)}`;
  const started = await api.post('/api/chat/start', {
    visitorId,
    name: 'Meera',
    email: `meera${Date.now()}@example.com`,
    message: 'Is the barrier balm fragrance free?'
  });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  conversation = started.body.conversation;
  visitorId = started.body.visitorId;
});

after(async () => {
  await server.stop();
});

async function openStream(path) {
  const controller = new AbortController();
  const response = await fetch(`${server.baseUrl}${path}`, { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  return {
    events,
    async next(eventName, timeoutMs = 4000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (events.some((entry) => entry.event === eventName)) return events.find((entry) => entry.event === eventName);
        const remaining = deadline - Date.now();
        const result = await Promise.race([
          reader.read(),
          new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), Math.max(50, remaining)))
        ]);
        if (result.timeout) continue;
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const event = { event: 'message', data: null };
          let meaningful = false;
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) {
              event.event = line.slice(7).trim();
              meaningful = true;
            }
            if (line.startsWith('data: ')) {
              meaningful = true;
              try { event.data = JSON.parse(line.slice(6)); } catch { event.data = line.slice(6); }
            }
          }
          if (meaningful) events.push(event);
        }
      }
      return null;
    },
    close() {
      controller.abort();
    }
  };
}

test('guest chat is stored, readable by its owner and visible to the desk', async () => {
  const state = await api.get(`/api/chat/state?visitorId=${visitorId}`);
  assert.equal(state.status, 200);
  assert.equal(state.body.conversation.id, conversation.id);
  assert.equal(state.body.conversation.thread.length, 1);

  const message = await api.post('/api/chat/message', {
    conversationId: conversation.id,
    visitorId,
    text: 'And does it suit sensitive skin?'
  });
  assert.equal(message.status, 201, JSON.stringify(message.body));
  assert.equal(message.body.message.text, 'And does it suit sensitive skin?');

  const wrongVisitor = await api.post('/api/chat/message', {
    conversationId: conversation.id,
    visitorId: 'vis_someoneelse',
    text: 'I should not be able to write here.'
  });
  assert.equal(wrongVisitor.status, 403);

  await adminLogin(api);
  const inbox = await api.get('/api/admin/chat');
  assert.equal(inbox.status, 200);
  const row = inbox.body.conversations.find((entry) => entry.id === conversation.id);
  assert.ok(row, 'conversation appears in the admin inbox');
  assert.ok(row.unread.admin >= 1);

  const thread = await api.get(`/api/admin/chat/${conversation.id}`);
  assert.equal(thread.status, 200);
  assert.equal(thread.body.conversation.thread.length, 2);
  assert.equal(thread.body.conversation.unread.admin, 0, 'opening the thread clears the badge');

  const reply = await api.patch(`/api/admin/chat/${conversation.id}`, { text: 'Yes, it is fragrance free and fragrance-allergen free.' });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.equal(reply.body.message.from, 'employee');
  assert.equal(reply.body.message.senderName, 'Store admin');

  const customerView = await api.get(`/api/chat/state?visitorId=${visitorId}`);
  assert.equal(customerView.body.conversation.thread.length, 3);
  assert.ok(customerView.body.conversation.unread.customer >= 1);

  const read = await api.post('/api/chat/read', { conversationId: conversation.id, visitorId });
  assert.equal(read.status, 200);
  const afterRead = await api.get(`/api/chat/state?visitorId=${visitorId}`);
  assert.equal(afterRead.body.conversation.unread.customer, 0);
});

test('messages are delivered live over SSE to the customer and the desk', async () => {
  const customerTicket = await api.post('/api/chat/stream-ticket', { conversationId: conversation.id, visitorId });
  assert.equal(customerTicket.status, 200);
  const customerStream = await openStream(`/api/chat/stream?sset=${customerTicket.body.token}`);
  await customerStream.next('hello');

  const adminTicket = await api.post('/api/admin/chat/stream-ticket');
  assert.equal(adminTicket.status, 200);
  const adminStream = await openStream(`/api/admin/chat/stream?sset=${adminTicket.body.token}`);
  await adminStream.next('hello');

  const reply = await api.patch(`/api/admin/chat/${conversation.id}`, { text: 'Live reply from the support desk.' });
  assert.equal(reply.status, 200);
  const customerEvent = await customerStream.next('message');
  assert.ok(customerEvent, 'customer stream receives the reply');
  assert.equal(customerEvent.data.message?.text || customerEvent.data.text, 'Live reply from the support desk.');

  const sent = await api.post('/api/chat/message', { conversationId: conversation.id, visitorId, text: 'Live question from the customer.' });
  assert.equal(sent.status, 201);
  const adminEvent = await adminStream.next('message');
  assert.ok(adminEvent, 'desk stream receives the customer message');

  customerStream.close();
  adminStream.close();
});

test('admin can resolve, note, assign and moderate conversations', async () => {
  await adminLogin(api);
  await api.post('/api/admin/staff', {
    name: 'Desk Agent',
    username: `agent${Date.now()}`,
    password: 'employee-password',
    permissions: { chat: true }
  });
  const staffList = await api.get('/api/admin/staff');
  const someone = staffList.body.staff[0];
  const update = await api.patch(`/api/admin/chat/${conversation.id}`, {
    adminNotes: 'Customer asked about fragrance; answered.',
    assignedStaffId: someone.id,
    status: 'resolved'
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.conversation.status, 'resolved');
  assert.equal(update.body.conversation.assignedStaffId, someone.id);
  const stored = await api.get(`/api/admin/chat/${conversation.id}`);
  assert.equal(stored.body.conversation.adminNotes, 'Customer asked about fragrance; answered.');

  const reopened = await api.post('/api/chat/message', { conversationId: conversation.id, visitorId, text: 'One more question.' });
  assert.equal(reopened.status, 201);
  const state = await api.get(`/api/admin/chat/${conversation.id}`);
  assert.equal(state.body.conversation.status, 'open', 'a customer message reopens the thread');

  const target = state.body.conversation.thread.at(-1);
  const removed = await api.del(`/api/admin/chat/${conversation.id}/messages/${target.id}`);
  assert.equal(removed.status, 200);
  const after = await api.get(`/api/admin/chat/${conversation.id}`);
  assert.equal(after.body.conversation.thread.some((entry) => entry.id === target.id), false);
});

test('conversation history survives a server restart', async () => {
  const state = await api.get(`/api/admin/chat/${conversation.id}`);
  const count = state.body.conversation.thread.length;
  const dbPath = server.dbPath();
  const dir = server.dir;
  const baseUrl = server.baseUrl;

  // Stop, then start a second process against the same database file.
  await server.stop({ keepData: true });
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: new URL(baseUrl).port,
      HOST: '127.0.0.1',
      STORE_DB_PATH: dbPath,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'test-admin-password',
      ADMIN_SECRET: 'test-admin-secret',
      SESSION_SECRET: 'test-session-secret',
      SITE_URL: baseUrl,
      OTP_DEV_ECHO: 'true',
      OTP_ENFORCE: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const deadline = Date.now() + 15_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`${baseUrl}/api/health`)).ok) { ready = true; break; }
      } catch { /* waiting */ }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(ready, true);
    const { makeApi, adminLogin: login } = await import('./helpers.mjs');
    const fresh = makeApi(baseUrl);
    await login(fresh);
    const restored = await fresh.get(`/api/admin/chat/${conversation.id}`);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.conversation.thread.length, count, 'stored messages reload after restart');
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 4_000);
        child.on('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    const fs = await import('node:fs');
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
});

test('a reply sent while resolving still reaches the customer', async () => {
  // The restart test above shuts the shared server down, so this one owns its own.
  const desk = await startServer({ prefix: 'velune-resolve-delivery' });
  try {
    const api = desk.api;
    await adminLogin(api);
    const visitor = `vis_resolve${Date.now().toString(36)}`;
    const started = await api.post('/api/chat/start', { visitorId: visitor, name: 'Nora', message: 'nill hh8888' }, { guest: true });
    assert.equal(started.status, 201);
    const id = started.body.conversation.id;

    // The desk form ticks "mark resolved after sending", which sends the payment
    // details and closes the thread in one request.
    const sent = await api.request('PATCH', `/api/admin/chat/${id}`, {
      body: { paymentInfo: { upi: 'livestore@789765' }, status: 'resolved' }
    });
    assert.equal(sent.status, 200);
    assert.ok(sent.body.message, 'the agent reply must be created');

    const state = await api.get(`/api/chat/state?visitorId=${encodeURIComponent(visitor)}`, { guest: true });
    assert.ok(state.body.conversation, 'a resolved thread must stay readable by its visitor');
    assert.equal(state.body.conversation.status, 'resolved');
    const delivered = state.body.conversation.thread.find((entry) => entry.from === 'employee');
    assert.ok(delivered, 'the customer must see the agent reply');
    assert.equal(delivered.paymentInfo.lines[0].value, 'livestore@789765');
    assert.ok(state.body.conversation.unread.customer >= 1, 'the closing reply should still badge as unread');

    // Writing back reopens the same thread, so the history is not lost.
    const reply = await api.post('/api/chat/message', { conversationId: id, visitorId: visitor, text: 'paid, please check' }, { guest: true });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.conversation.id, id);
    assert.equal(reply.body.conversation.status, 'open');
    const stored = await api.get(`/api/admin/chat/${id}`);
    assert.equal(stored.body.conversation.status, 'open');
    assert.equal(stored.body.conversation.thread.filter((entry) => entry.from === 'customer').length, 2);
  } finally {
    await desk.stop();
  }
});

test('a phone-only ticket thread becomes live once the customer reopens it', async () => {
  const desk = await startServer({ prefix: 'velune-ticket-claim' });
  try {
    const api = desk.api;
    await adminLogin(api);
    const visitor = `vis_claim${Date.now().toString(36)}`;
    const phone = '+92 300 9998877';

    // The legacy ticket route creates threads with no browser attached, so the
    // widget cannot resolve them and agent replies sit unread.
    const created = await api.post('/api/support/ticket', {
      name: 'Orphan Customer', phone, message: 'I paid, where is my order?'
    }, { guest: true });
    assert.equal(created.status, 201);
    const id = created.body.ticket.id;

    const sent = await api.patch(`/api/admin/tickets/${id}`, { replyText: 'Paying now — UPI livestore@789765' });
    assert.equal(sent.status, 200);

    const blind = await api.get(`/api/chat/state?visitorId=${encodeURIComponent(visitor)}`, { guest: true });
    assert.equal(blind.body.conversation, null, 'an unclaimed thread stays invisible to the widget');

    const reopened = await api.get(
      `/api/support/ticket/${id}?phone=${encodeURIComponent(phone)}&visitorId=${encodeURIComponent(visitor)}`,
      { guest: true }
    );
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.ticket.visitorId, visitor);

    const state = await api.get(`/api/chat/state?visitorId=${encodeURIComponent(visitor)}`, { guest: true });
    assert.equal(state.body.conversation.id, id, 'the claimed thread is now the visitor chat');
    assert.equal(state.body.conversation.thread.some((entry) => entry.from === 'employee'), true);

    // New tickets carry the visitor ID straight away, so they are never orphaned.
    const fresh = await api.post('/api/support/ticket', {
      name: 'Bound Customer', phone: '+92 300 1112223', message: 'Second thread, same person.', visitorId: visitor
    }, { guest: true });
    assert.equal(fresh.body.ticket.visitorId, visitor);
  } finally {
    await desk.stop();
  }
});
