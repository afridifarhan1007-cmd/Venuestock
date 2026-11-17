/* VELUNE — live support chat (customer side, realtime over SSE) */
(() => {
  'use strict';

  const { $, api, esc, toast, ready } = window.VELUNE;

  const VISITOR_KEY = 'velune.chat.visitor';
  const THREAD_KEY = 'velune.chat.conversation';
  const REPLIED_KEY = 'velune.chat.replied';
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  const widget = $('[data-chat]');
  const panel = $('[data-chat-panel]');
  if (!widget || !panel) return;

  const launch = $('[data-chat-launch]');
  const collapse = $('[data-chat-toggle]');
  const intro = $('[data-chat-intro]');
  const log = $('[data-chat-log]');
  const typingLine = $('[data-chat-typing]');
  const presence = $('[data-chat-presence]');
  const form = $('[data-chat-form]');
  const input = $('[data-chat-input]');
  const badge = $('[data-chat-badge]');
  const payStrip = $('[data-chat-pay]');
  const footnote = $('[data-chat-footnote]');
  const attachBtn = $('[data-chat-attach]');
  const fileInput = $('[data-chat-file]');
  const attachPreview = $('[data-chat-attach-preview]');
  const attachThumb = $('[data-chat-attach-thumb]');
  const attachClear = $('[data-chat-attach-clear]');

  const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

  let visitorId = readStored(VISITOR_KEY) || '';
  let conversation = null;
  let payments = { methods: [], instructions: '' };
  let open = false;
  let stream = null;
  let streamAttempts = 0;
  let pollTimer = null;
  let typingTimer = null;
  let typingSent = false;
  let pendingAttachment = null;
  const rendered = new Set();

  // Unread handling. The tab title and the launcher badge are the only
  // always-available signals; the browser Notification API is asked about only
  // once the visitor has actually sent a message, never on page load.
  let unreadCount = 0;
  let baseTitle = document.title;
  let lastNotified = '';
  let lastInPagePing = 0;
  let notifyAsked = false;

  function readSession(key) {
    try {
      return sessionStorage.getItem(key) || '';
    } catch {
      return '';
    }
  }

  function storeSession(key, value) {
    try {
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch {
      /* storage can be unavailable in private modes */
    }
  }

  function visitorHasReplied() {
    return readSession(REPLIED_KEY) === '1';
  }

  function applyTitle() {
    document.title = unreadCount > 0 ? `(${unreadCount > 9 ? '9+' : unreadCount}) ${baseTitle}` : baseTitle;
  }

  function setUnread(count) {
    unreadCount = Math.max(0, Number(count) || 0);
    if (badge) {
      badge.textContent = String(unreadCount);
      badge.hidden = unreadCount === 0;
    }
    if (unreadCount === 0) launch?.classList.remove('is-alert');
    applyTitle();
  }

  // Permission is requested at the moment of the visitor's first outgoing
  // message, so no prompt ever appears out of context.
  function askNotifyPermission() {
    if (notifyAsked || typeof window.Notification !== 'function') return;
    if (Notification.permission === 'default') {
      notifyAsked = true;
      try {
        Notification.requestPermission().catch(() => {});
      } catch {
        /* older implementations return undefined */
      }
    }
  }

  function notifyReplies(message) {
    if (typeof window.Notification !== 'function') return;
    if (Notification.permission !== 'granted') return;
    if (!visitorHasReplied()) return;
    if (open && !document.hidden) return;
    if (lastNotified === message.id) return;
    lastNotified = message.id;
    const body = String(message.text || 'New message from the support team').slice(0, 120);
    try {
      const note = new Notification('VELUNE support replied', { body, tag: conversation ? `chat-${conversation.id}` : 'velune-chat', silent: true });
      note.onclick = () => {
        window.focus();
        setOpen(true);
        note.close();
      };
      setTimeout(() => note.close(), 8000);
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }

  function inPagePing() {
    const now = Date.now();
    if (now - lastInPagePing < 6000) return;
    lastInPagePing = now;
    toast('New message from VELUNE support.', {
      action: {
        label: 'Read now',
        onClick: () => setOpen(true)
      }
    });
  }

  function readStored(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  }

  function store(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* storage can be unavailable in private modes */
    }
  }

  function newVisitorId() {
    const random = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 18) : `${Date.now()}${Math.random()}`.slice(0, 18);
    return `vis_${random.replace(/[^A-Za-z0-9_-]/g, '')}`;
  }

  // ---------------------------------------------------------------- opening

  function setOpen(value) {
    open = Boolean(value);
    widget.classList.toggle('is-open', open);
    launch?.setAttribute('aria-expanded', String(open));
    panel.setAttribute('aria-hidden', String(!open));
    if (open) panel.removeAttribute('inert');
    else panel.setAttribute('inert', '');
    if (open) {
      markRead();
      scrollToEnd();
      if (conversation) setTimeout(() => input?.focus(), 120);
    }
  }

  launch?.addEventListener('click', () => setOpen(!open));
  collapse?.addEventListener('click', () => setOpen(false));
  panel.toggleAttribute('inert', true);

  // ---------------------------------------------------------------- rendering

  function scrollToEnd() {
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }

  function dayLabel(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return 'Today';
    return dayFmt.format(date);
  }

  // Older threads stored { upi, binance, crypto, label }; new ones use lines.
  function normalisePaymentInfo(info) {
    if (!info) return null;
    if (Array.isArray(info.lines)) {
      const lines = info.lines.filter((line) => line && line.label && line.value);
      return lines.length ? { heading: info.heading || 'Payment details', lines, note: info.note || '' } : null;
    }
    const lines = [
      { label: 'UPI', value: info.upi },
      { label: 'Binance', value: info.binance },
      { label: 'Crypto', value: info.crypto }
    ].filter((line) => line.value);
    return lines.length ? { heading: info.label || 'Payment details', lines, note: '' } : null;
  }

  function paymentCard(info) {
    const data = normalisePaymentInfo(info);
    if (!data) return '';
    return `<div class="wa-payment">
      <div class="wa-payment__head">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="14" height="14" aria-hidden="true"><rect x="2" y="6" width="20" height="14" rx="2"/><circle cx="12" cy="13" r="3"/></svg>
        ${esc(data.heading)}
      </div>
      ${data.note ? `<p class="wa-payment__note">${esc(data.note)}</p>` : ''}
      <dl class="wa-payment__list">
        ${data.lines
          .map(
            (line) => `<div><dt>${esc(line.label)}</dt><dd class="wa-mono">${esc(line.value)}<button class="wa-copy" type="button" data-copy="${esc(line.value)}">Copy</button></dd></div>`
          )
          .join('')}
      </dl>
    </div>`;
  }

  function messageNode(message) {
    const who = message.from === 'customer' ? 'customer' : message.from === 'system' ? 'system' : 'team';
    const time = timeFmt.format(new Date(message.at));
    const attachment = message.attachment
      ? `<a class="chat-file" href="${esc(message.attachment.path)}" target="_blank" rel="noopener">
           <img src="${esc(message.attachment.path)}" alt="${esc(message.attachment.kind === 'slip' ? 'Payment slip' : 'Attached image')}" loading="lazy">
           <span>${esc(message.attachment.kind === 'slip' ? 'Payment slip' : 'Image')} — open full size</span>
         </a>`
      : '';
    return `<div class="chat-msg chat-msg--${who}" data-message="${esc(message.id)}">
      <div class="chat-msg__bubble">
        ${who === 'system' ? '' : `<span class="chat-msg__who">${esc(message.senderName || (who === 'customer' ? 'You' : 'Support'))}</span>`}
        <p class="chat-msg__text">${esc(message.text)}</p>
        ${attachment}
        ${paymentCard(message.paymentInfo)}
        <span class="chat-msg__time">${esc(time)}</span>
      </div>
    </div>`;
  }

  function renderThread(thread) {
    if (!log) return;
    rendered.clear();
    let lastDay = '';
    log.innerHTML = (thread || [])
      .map((message) => {
        const label = dayLabel(message.at);
        const divider = label && label !== lastDay ? `<p class="chat-day">${esc(lastDay = label)}</p>` : '';
        rendered.add(message.id);
        return divider + messageNode(message);
      })
      .join('');
    scrollToEnd();
  }

  function appendMessage(message) {
    if (!log || !message || rendered.has(message.id)) return;
    rendered.add(message.id);
    const node = document.createElement('div');
    node.innerHTML = messageNode(message);
    log.appendChild(node);
    scrollToEnd();
    if (message.from === 'customer') return;
    // A visitor who is watching the open thread sees it arrive; the stream
    // handler already marks the thread read in that case.
    if (open && !document.hidden) return;
    bumpBadge(message);
  }

  function bumpBadge(message) {
    setUnread(unreadCount + 1);
    launch?.classList.add('is-alert');
    inPagePing();
    if (message) notifyReplies(message);
  }

  function showThread(value) {
    intro.hidden = Boolean(value);
    form.hidden = !value;
    if (footnote) footnote.hidden = !value;
    if (payStrip) payStrip.hidden = !value || !payments.methods.length;
  }

  function setPresence(adminOnline, support) {
    if (!presence) return;
    presence.classList.toggle('is-online', Boolean(adminOnline));
    presence.innerHTML = adminOnline
      ? '<i></i>Support is online now'
      : `<i></i>Offline · replies ${esc(support?.responseTime || 'within one business day')}`;
  }

  // Payment channels the store has filled in, offered right in the chat.
  function renderPayments() {
    if (!payStrip) return;
    const methods = payments.methods || [];
    if (!methods.length) {
      payStrip.innerHTML = '';
      payStrip.hidden = true;
      return;
    }
    payStrip.innerHTML = `
      <div class="chat-pay__tabs" role="group" aria-label="Payment options">
        ${methods.map((method) => `<button type="button" data-pay-tab="${esc(method.key)}">${esc(method.label)}</button>`).join('')}
      </div>
      ${methods
        .map(
          (method) => `<div class="chat-pay__card" data-pay-card="${esc(method.key)}" hidden>
            ${method.fields.length
              ? `<ul>${method.fields
                  .map(
                    (field) => `<li><span>${esc(field.label)}</span><strong class="wa-mono">${esc(field.value)}</strong>
                      <button class="wa-copy" type="button" data-copy="${esc(field.value)}">Copy</button></li>`
                  )
                  .join('')}</ul>`
              : ''}
            ${method.qr ? `<img class="chat-pay__qr" src="${esc(method.qr)}" alt="${esc(method.label)} QR code">` : ''}
            ${method.note ? `<p>${esc(method.note)}</p>` : ''}
            ${method.needsProof ? '<p class="chat-pay__proof">Attach the slip with the paperclip below and we will confirm it here.</p>' : ''}
            <button class="chat-pay__ask" type="button" data-ask-pay="${esc(method.label)}">Send this to support</button>
          </div>`
        )
        .join('')}
      ${payments.instructions ? `<p class="chat-pay__lead">${esc(payments.instructions)}</p>` : ''}`;
  }

  payStrip?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-pay-tab]');
    if (tab) {
      const key = tab.dataset.payTab;
      payStrip.querySelectorAll('[data-pay-card]').forEach((card) => {
        card.hidden = card.dataset.payCard !== key;
      });
      return;
    }
    const ask = event.target.closest('[data-ask-pay]');
    if (ask) {
      sendMessage(`Please send me the ${ask.dataset.askPay} payment details again.`);
      return;
    }
    const copy = event.target.closest('[data-copy]');
    if (copy) copyValue(copy);
  });

  log?.addEventListener('click', (event) => {
    const copy = event.target.closest('[data-copy]');
    if (copy) copyValue(copy);
  });

  function copyValue(button) {
    const value = button.dataset.copy || '';
    const done = () => {
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = 'Copy';
      }, 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(() => toast('Copy failed — select the text manually.', { error: true }));
      return;
    }
    toast('Your browser blocks clipboard access here.', { error: true });
  }

  // ---------------------------------------------------------------- state

  function applyState(data) {
    if (data.payments) payments = data.payments;
    renderPayments();
    const next = data.conversation || null;
    if (next) {
      store(THREAD_KEY, next.id);
      const changed = !conversation || conversation.id !== next.id || (next.messageCount ?? (next.thread || []).length) !== (conversation.thread || []).length;
      conversation = next;
      showThread(conversation);
      if (changed) renderThread(conversation.thread || []);
      setPresence(data.support?.online, data.support);
      if (conversation.status === 'resolved') {
        typingLine.hidden = true;
        if (footnote) footnote.hidden = false;
      }
      // The server keeps the real unread count, so a visitor who left the chat
      // open on another page comes back to the right badge.
      if (!open) setUnread(conversation.unread?.customer || 0);
      else setUnread(0);
    } else {
      conversation = null;
      store(THREAD_KEY, '');
      showThread(null);
      setPresence(data.support?.online, data.support);
      setUnread(0);
    }
  }

  async function refresh() {
    if (!visitorId) return;
    try {
      const data = await api(`/api/chat/state?visitorId=${encodeURIComponent(visitorId)}`);
      applyState(data);
    } catch {
      /* keep the last known thread when the network dips */
    }
  }

  // ---------------------------------------------------------------- stream

  async function connect() {
    if (!conversation) return;
    disconnect();
    let token = '';
    try {
      const issued = await api('/api/chat/stream-ticket', {
        method: 'POST',
        json: { conversationId: conversation.id, visitorId }
      });
      token = issued.token;
    } catch {
      startPolling();
      return;
    }
    if (!window.EventSource) {
      startPolling();
      return;
    }
    stream = new EventSource(`/api/chat/stream?sset=${encodeURIComponent(token)}`);
    stream.addEventListener('hello', (event) => {
      streamAttempts = 0;
      const data = JSON.parse(event.data);
      applyState({ conversation: data.conversation, payments: data.payments, support: data.support });
    });
    stream.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.conversation?.id && data.conversation.id !== conversation?.id) {
        refresh();
        return;
      }
      if (data.message) {
        appendMessage(data.message);
        if (conversation) conversation.unread = { admin: 0, customer: 0 };
      }
      if (data.conversation) typingLine.hidden = true;
      if (open) markRead();
    });
    stream.addEventListener('typing', (event) => {
      const data = JSON.parse(event.data);
      typingLine.hidden = !data.typing;
      if (data.typing) scrollToEnd();
    });
    stream.addEventListener('presence', (event) => {
      const data = JSON.parse(event.data);
      setPresence(data.adminOnline, null);
    });
    stream.addEventListener('status', () => refresh());
    stream.addEventListener('read', () => setUnread(0));
    stream.onerror = () => {
      if (streamAttempts >= 3) {
        disconnect();
        startPolling();
        return;
      }
      streamAttempts += 1;
      disconnect();
      setTimeout(connect, 4000);
    };
  }

  function disconnect() {
    if (stream) {
      stream.close();
      stream = null;
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      refresh();
    }, 15000);
  }

  // Coming back to the tab clears the title counter; an open panel also marks
  // the thread read so the agent sees the seen receipt.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    document.title = baseTitle;
    if (open) markRead();
  });

  window.addEventListener('focus', () => {
    document.title = baseTitle;
    if (open) markRead();
  });

  // ---------------------------------------------------------------- sending

  async function markRead() {
    setUnread(0);
    lastNotified = '';
    launch?.classList.remove('is-alert');
    if (!conversation || !conversation.unread?.customer) return;
    conversation.unread.customer = 0;
    try {
      await api('/api/chat/read', { method: 'POST', json: { conversationId: conversation.id, visitorId } });
    } catch {
      /* the unread dot is cosmetic */
    }
  }

  async function sendMessage(text) {
    const body = String(text || input?.value || '').trim().slice(0, 2000);
    if (!conversation) {
      toast('Please add your name and email first.', { error: true });
      setOpen(true);
      return;
    }
    if (!body && !pendingAttachment) return;
    const payload = { conversationId: conversation.id, visitorId, text: body };
    if (pendingAttachment) payload.attachment = pendingAttachment;
    if (input) input.value = '';
    clearAttachment();
    try {
      const data = await api('/api/chat/message', { method: 'POST', json: payload });
      appendMessage(data.message);
      conversation.unread = conversation.unread || { admin: 0, customer: 0 };
      conversation.unread.admin += 1;
      // Notifications are only ever raised for a visitor who has taken part in
      // the conversation, so permission is asked at exactly this moment.
      storeSession(REPLIED_KEY, '1');
      askNotifyPermission();
      setUnread(0);
    } catch (error) {
      toast(error.message, { error: true });
    }
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage();
  });

  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    signalTyping();
  });

  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  function signalTyping() {
    if (!conversation) return;
    if (!typingSent) {
      typingSent = true;
      api('/api/chat/typing', { method: 'POST', json: { conversationId: conversation.id, visitorId, typing: true } }).catch(() => {});
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      typingSent = false;
      api('/api/chat/typing', { method: 'POST', json: { conversationId: conversation.id, visitorId, typing: false } }).catch(() => {});
    }, 2500);
  }

  // ---------------------------------------------------------------- attachment

  attachBtn?.addEventListener('click', () => fileInput?.click());
  attachClear?.addEventListener('click', clearAttachment);

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast('Upload a JPG, PNG or WebP image.', { error: true });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast('Images must be 5 MB or smaller.', { error: true });
      return;
    }
    if (!conversation) {
      toast('Add your details first, then attach the slip.', { error: true });
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      attachBtn.disabled = true;
      try {
        const saved = await api('/api/chat/attachment', {
          method: 'POST',
          json: { conversationId: conversation.id, visitorId, data: String(reader.result), kind: 'slip' }
        });
        pendingAttachment = saved;
        attachThumb.src = saved.path;
        attachThumb.alt = 'Payment slip preview';
        attachPreview.hidden = false;
        if (input) input.placeholder = 'Add a note, then send the slip…';
      } catch (error) {
        toast(error.message, { error: true });
      } finally {
        attachBtn.disabled = false;
      }
    };
    reader.readAsDataURL(file);
  });

  function clearAttachment() {
    pendingAttachment = null;
    if (attachPreview) attachPreview.hidden = true;
    if (input) input.placeholder = 'Write a message…';
  }

  // ---------------------------------------------------------------- intro

  intro?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(intro);
    const button = intro.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const data = await api('/api/chat/start', {
        method: 'POST',
        json: {
          visitorId,
          name: String(fields.get('name') || ''),
          email: String(fields.get('email') || ''),
          phone: String(fields.get('phone') || ''),
          orderNumber: String(fields.get('orderNumber') || '')
        }
      });
      visitorId = data.visitorId || visitorId;
      store(VISITOR_KEY, visitorId);
      applyState(data);
      renderThread([]);
      connect();
      setTimeout(() => input?.focus(), 120);
    } catch (error) {
      toast(error.message, { error: true });
    } finally {
      if (button) button.disabled = false;
    }
  });

  // ---------------------------------------------------------------- boot

  async function boot() {
    visitorId = visitorId || newVisitorId();
    store(VISITOR_KEY, visitorId);
    await refresh();
    if (conversation) {
      renderThread(conversation.thread || []);
      connect();
    }
  }

  ready.then(boot);

  // Other pages can jump straight into the chat with context, e.g.
  // window.VELUNEChat.open('Order VLN-AB12-CD34 has the wrong address').
  window.VELUNEChat = {
    open(message, orderNumber) {
      setOpen(true);
      if (orderNumber && intro && !intro.hidden) {
        const field = intro.querySelector('[name="orderNumber"]');
        if (field) field.value = orderNumber;
      }
      if (message && input) input.value = message;
      if (message && conversation) setTimeout(() => sendMessage(message), 80);
    },
    refresh
  };
})();
