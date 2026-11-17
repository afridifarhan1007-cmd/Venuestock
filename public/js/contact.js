/* VELUNE — Contact page live support chat (SSE real-time, connected to admin Live Chat panel) */
(() => {
  'use strict';

  const { $, api, esc, toast } = window.VELUNE;

  // ── storage keys ──────────────────────────────────────────
  const VISITOR_KEY      = 'velune.chat.visitor';
  const THREAD_KEY       = 'velune.chat.conversation';
  const MAX_IMAGE_BYTES  = 5 * 1024 * 1024;

  // ── views ─────────────────────────────────────────────────
  const waStart    = $('[data-wa-start]');
  const waExisting = $('[data-wa-existing]');
  const waChat     = $('[data-wa-chat]');

  function showView(view) {
    if (waStart)    waStart.hidden    = (view !== 'start');
    if (waExisting) waExisting.hidden = (view !== 'existing');
    if (waChat)     waChat.hidden     = (view !== 'chat');
  }
  showView('start');

  // ── state ─────────────────────────────────────────────────
  let visitorId    = '';
  let conversation = null;
  let payments     = { methods: [], instructions: '' };
  let stream       = null;
  let streamAttempts = 0;
  let pollTimer    = null;
  let typingTimer  = null;
  let typingSent   = false;
  let pendingAttachment = null;
  const rendered   = new Set();

  // ── local storage helpers ─────────────────────────────────
  function readStored(key) {
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
  }
  function store(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {}
  }
  function newVisitorId() {
    const r = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 18) : `${Date.now()}${Math.random()}`.replace(/\D/g, '').slice(0, 18);
    return `vis_${r.replace(/[^A-Za-z0-9_-]/g, '')}`;
  }

  // ── DOM refs ──────────────────────────────────────────────
  const startForm       = $('[data-start-form]');
  const startError      = $('[data-start-error]');
  const startSubmit     = $('[data-start-submit]');
  const existingBtn     = $('[data-open-existing]');
  const backToStart     = $('[data-back-to-start]');
  const existingForm    = $('[data-existing-form]');
  const existingError   = $('[data-existing-error]');
  const existingSubmit  = $('[data-existing-submit]');
  const chatBack        = $('[data-chat-back]');
  const chatMessages    = $('[data-chat-messages]');
  const chatTextarea    = $('[data-chat-textarea]');
  const chatSendBtn     = $('[data-chat-send]');
  const chatHeaderId    = $('[data-chat-header-id]');
  const chatStatusText  = $('[data-chat-status-text]');
  const typingLine      = $('[data-chat-typing-line]');
  const payPanel        = $('[data-contact-pay]');
  const attachBtn       = $('[data-contact-attach]');
  const fileInput       = $('[data-contact-file]');
  const attachPreview   = $('[data-contact-attach-preview]');
  const attachThumb     = $('[data-contact-attach-thumb]');
  const attachClear     = $('[data-contact-attach-clear]');

  const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
  const fmt     = iso => iso ? timeFmt.format(new Date(iso)) : '';

  // ── payment renderer ──────────────────────────────────────
  function normalisePaymentInfo(pi) {
    if (!pi) return null;
    if (Array.isArray(pi.lines)) {
      const lines = pi.lines.filter(l => l && l.label && l.value);
      return lines.length ? { heading: pi.heading || 'Payment details', lines, note: pi.note || '' } : null;
    }
    // legacy shape  {upi, binance, crypto, label}
    const lines = [];
    if (pi.upi)     lines.push({ label: 'UPI',     value: pi.upi });
    if (pi.binance) lines.push({ label: 'Binance',  value: pi.binance });
    if (pi.crypto)  lines.push({ label: 'Crypto',   value: pi.crypto });
    return lines.length ? { heading: 'Payment details', lines, note: pi.label || '' } : null;
  }

  function paymentCardHtml(pi) {
    const info = normalisePaymentInfo(pi);
    if (!info) return '';
    return `<div class="wa-payment">
      <div class="wa-payment__head">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="14" height="14" aria-hidden="true"><rect x="2" y="6" width="20" height="14" rx="2"/><circle cx="12" cy="13" r="3"/><path d="M6 9h.01M18 9h.01"/></svg>
        ${esc(info.heading)}
      </div>
      ${info.note ? `<p class="wa-payment__note">${esc(info.note)}</p>` : ''}
      <dl class="wa-payment__list">
        ${info.lines.map(l => `<div>
          <dt>${esc(l.label)}</dt>
          <dd class="${l.label.toLowerCase().includes('crypto') || l.label.toLowerCase().includes('address') ? 'wa-mono' : ''}">${esc(l.value)}<button class="wa-copy" type="button" data-copy="${esc(l.value)}">Copy</button></dd>
        </div>`).join('')}
      </dl>
      <p class="wa-payment__warn">⚠ Double-check the address before sending. Add your order number in remarks. Upload a slip or screenshot after payment.</p>
    </div>`;
  }

  function attachmentHtml(att) {
    if (!att || !att.path) return '';
    const isSlip = att.kind === 'slip';
    return `<div class="wa-slip">
      <a href="${esc(att.path)}" target="_blank" rel="noopener">
        <img src="${esc(att.path)}" alt="${isSlip ? 'Payment slip' : 'Photo'}" class="wa-slip__img" loading="lazy">
      </a>
      <span class="wa-slip__label">${isSlip ? '📎 Payment slip' : '📷 Photo'}</span>
    </div>`;
  }

  // ── render full thread ────────────────────────────────────
  function renderThread(thread) {
    if (!chatMessages) return;
    const datePill = `<div class="wa-chat__date-pill">Today</div>`;
    const msgs = (thread || []).map(msg => {
      const mine   = msg.from === 'customer';
      const isTeam = msg.from === 'employee';
      const isSys  = msg.from === 'system';
      if (isSys) {
        return `<div class="wa-msg wa-msg--system"><div class="wa-msg__system-text">${esc(msg.text)}</div></div>`;
      }
      const pi = normalisePaymentInfo(msg.paymentInfo);
      return `<div class="wa-msg ${mine ? 'wa-msg--out' : 'wa-msg--in'}" data-msg-id="${esc(msg.id)}">
        <div class="wa-msg__bubble">
          ${!mine ? `<span class="wa-msg__sender">${esc(msg.senderName || 'Support')}</span>` : ''}
          <div class="wa-msg__text">${esc(msg.text).replace(/\n/g, '<br>')}</div>
          ${msg.attachment ? attachmentHtml(msg.attachment) : ''}
          ${pi ? paymentCardHtml(pi) : ''}
          <span class="wa-msg__time">${fmt(msg.at)}</span>
        </div>
      </div>`;
    }).join('');
    chatMessages.innerHTML = datePill + msgs;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ── append single message without full re-render ──────────
  function appendMessage(msg) {
    if (!chatMessages || !msg || rendered.has(msg.id)) return;
    rendered.add(msg.id);
    const mine   = msg.from === 'customer';
    const isSys  = msg.from === 'system';
    let html;
    if (isSys) {
      html = `<div class="wa-msg wa-msg--system"><div class="wa-msg__system-text">${esc(msg.text)}</div></div>`;
    } else {
      const pi = normalisePaymentInfo(msg.paymentInfo);
      html = `<div class="wa-msg ${mine ? 'wa-msg--out' : 'wa-msg--in'}" data-msg-id="${esc(msg.id)}">
        <div class="wa-msg__bubble">
          ${!mine ? `<span class="wa-msg__sender">${esc(msg.senderName || 'Support')}</span>` : ''}
          <div class="wa-msg__text">${esc(msg.text).replace(/\n/g, '<br>')}</div>
          ${msg.attachment ? attachmentHtml(msg.attachment) : ''}
          ${pi ? paymentCardHtml(pi) : ''}
          <span class="wa-msg__time">${fmt(msg.at)}</span>
        </div>
      </div>`;
    }
    const node = document.createElement('div');
    node.innerHTML = html;
    chatMessages.appendChild(node);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ── payment panel (inline in chat, admin-configured methods) ──
  function renderPaymentPanel() {
    if (!payPanel) return;
    const methods = payments.methods || [];
    if (!methods.length) { payPanel.innerHTML = ''; payPanel.hidden = true; return; }
    payPanel.hidden = false;
    payPanel.innerHTML = `
      <div class="contact-pay__heading">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="16" height="16" aria-hidden="true"><rect x="2" y="6" width="20" height="14" rx="2"/><circle cx="12" cy="13" r="3"/><path d="M6 9h.01M18 9h.01"/></svg>
        Payment Options
      </div>
      <div class="contact-pay__tabs" role="group" aria-label="Payment methods">
        ${methods.map(m => `<button type="button" class="contact-pay__tab" data-pay-tab="${esc(m.key)}">${esc(m.label)}</button>`).join('')}
      </div>
      ${methods.map(m => `<div class="contact-pay__card" data-pay-card="${esc(m.key)}" hidden>
        ${m.fields && m.fields.length ? `<ul class="contact-pay__fields">
          ${m.fields.map(f => `<li>
            <span class="contact-pay__field-label">${esc(f.label)}</span>
            <strong class="contact-pay__field-value wa-mono">${esc(f.value)}</strong>
            <button class="wa-copy" type="button" data-copy="${esc(f.value)}">Copy</button>
          </li>`).join('')}
        </ul>` : ''}
        ${m.qr ? `<img class="contact-pay__qr" src="${esc(m.qr)}" alt="${esc(m.label)} QR code">` : ''}
        ${m.note ? `<p class="contact-pay__note">${esc(m.note)}</p>` : ''}
        ${m.needsProof !== false ? '<p class="contact-pay__slip-hint">📎 Attach your payment slip below after paying.</p>' : ''}
      </div>`).join('')}
      ${payments.instructions ? `<p class="contact-pay__instructions">${esc(payments.instructions)}</p>` : ''}`;
  }

  payPanel?.addEventListener('click', e => {
    const tab = e.target.closest('[data-pay-tab]');
    if (tab) {
      const key = tab.dataset.payTab;
      payPanel.querySelectorAll('[data-pay-card]').forEach(c => { c.hidden = c.dataset.payCard !== key; });
      payPanel.querySelectorAll('[data-pay-tab]').forEach(t => { t.classList.toggle('is-active', t.dataset.payTab === key); });
    }
  });

  // ── copy handler (delegated, entire page) ─────────────────
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const val = btn.dataset.copy || '';
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(val).then(() => {
        const old = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = old; }, 1500);
      }).catch(() => {});
    }
  });

  // ── set presence indicator ────────────────────────────────
  function setPresence(adminOnline) {
    if (!chatStatusText) return;
    chatStatusText.textContent = adminOnline ? 'Online — real team member' : `Offline · replies ${(payments && payments.responseTime) || 'within one business day'}`;
  }

  // ── open chat view ────────────────────────────────────────
  function openChat(conv, vid, pmts) {
    conversation = conv;
    visitorId    = vid;
    if (pmts) payments = pmts;
    if (chatHeaderId) chatHeaderId.textContent = conv.id;
    const isResolved = conv.status === 'resolved';
    if (chatStatusText) chatStatusText.textContent = isResolved ? 'Resolved' : 'Checking availability…';
    rendered.clear();
    renderThread(conv.thread || []);
    (conv.thread || []).forEach(m => rendered.add(m.id));
    renderPaymentPanel();
    showView('chat');
    chatTextarea?.focus();
    store(VISITOR_KEY, vid);
    store(THREAD_KEY, conv.id);
    connect();
  }

  // ── start new chat ────────────────────────────────────────
  startForm?.addEventListener('submit', async e => {
    e.preventDefault();
    if (startError) startError.textContent = '';
    if (!startForm.reportValidity()) { startForm.querySelector(':invalid')?.focus(); return; }
    const fd = new FormData(startForm);
    if (String(fd.get('website') || '').trim()) return; // honeypot
    const name    = String(fd.get('name')        || '').trim();
    const phone   = String(fd.get('phone')       || '').trim();
    const message = String(fd.get('message')     || '').trim();
    if (startSubmit) { startSubmit.disabled = true; startSubmit.textContent = 'Starting…'; }

    // generate/restore visitorId
    const vid = readStored(VISITOR_KEY) || newVisitorId();

    try {
      const result = await api('/api/chat/start', {
        method: 'POST',
        json: {
          visitorId: vid,
          name,
          phone,
          email:       String(fd.get('email')       || '').trim(),
          orderNumber: String(fd.get('orderNumber')  || '').trim(),
          subject:     String(fd.get('subject')      || '').trim(),
          message,
          source: 'contact'
        }
      });
      startForm.reset();
      openChat(result.conversation, result.visitorId, result.payments);
    } catch (err) {
      if (startError) startError.textContent = err.message;
    } finally {
      if (startSubmit) { startSubmit.disabled = false; startSubmit.textContent = 'Start chat'; }
    }
  });

  // ── open existing chat ────────────────────────────────────
  existingBtn?.addEventListener('click', () => showView('existing'));
  backToStart?.addEventListener('click', () => showView('start'));

  existingForm?.addEventListener('submit', async e => {
    e.preventDefault();
    if (existingError) existingError.textContent = '';
    const fd       = new FormData(existingForm);
    const ticketId = String(fd.get('ticketId') || '').trim().toUpperCase();
    const phone    = String(fd.get('phone')    || '').trim();
    if (!ticketId || !phone) {
      if (existingError) existingError.textContent = 'Please fill in both fields.';
      return;
    }
    if (existingSubmit) { existingSubmit.disabled = true; existingSubmit.textContent = 'Opening…'; }

    // For existing chats started through the live chat widget, use visitorId from storage
    const vid = readStored(VISITOR_KEY) || newVisitorId();

    try {
      // Try live chat API first (visitorId based)
      const state = await api(`/api/chat/state?visitorId=${encodeURIComponent(vid)}`);
      if (state.conversation && state.conversation.id.toUpperCase() === ticketId) {
        openChat(state.conversation, vid, state.payments);
        return;
      }
      // Fall back: try the legacy ticket API with phone lookup, handing over our
      // visitor ID so a thread created before it existed becomes a live chat.
      const data = await api(`/api/support/ticket/${encodeURIComponent(ticketId)}?phone=${encodeURIComponent(phone)}&visitorId=${encodeURIComponent(vid)}`);
      // Migrate: if this ticket doesn't have a visitorId, we need to use the legacy poll mode
      if (!data.ticket.visitorId) {
        legacyOpenChat(ticketId, phone, data.ticket);
        return;
      }
      openChat(data.ticket, vid, state.payments);
    } catch (err) {
      if (existingError) existingError.textContent = err.message || 'Chat not found. Check your Chat ID and phone number.';
    } finally {
      if (existingSubmit) { existingSubmit.disabled = false; existingSubmit.textContent = 'Open chat'; }
    }
  });

  // ── legacy mode for old phone-based tickets ───────────────
  let legacyPhone = '';
  let legacyId    = '';
  let legacyTimer = null;
  function legacyOpenChat(id, phone, ticket) {
    legacyId    = id;
    legacyPhone = phone;
    conversation = ticket;
    if (chatHeaderId) chatHeaderId.textContent = id;
    if (chatStatusText) chatStatusText.textContent = ticket.status === 'resolved' ? 'Resolved' : 'Online — real team member';
    rendered.clear();
    renderThread(ticket.thread || []);
    showView('chat');
    chatTextarea?.focus();
    legacyTimer = setInterval(legacyRefresh, 8000);
  }
  async function legacyRefresh() {
    if (!legacyId || !legacyPhone) return;
    try {
      const data = await api(`/api/support/ticket/${encodeURIComponent(legacyId)}?phone=${encodeURIComponent(legacyPhone)}`);
      if (chatStatusText && data.ticket.status === 'resolved') chatStatusText.textContent = 'Resolved';
      renderThread(data.ticket.thread || []);
    } catch {}
  }

  // ── back from chat ────────────────────────────────────────
  chatBack?.addEventListener('click', () => {
    disconnect();
    if (legacyTimer) { clearInterval(legacyTimer); legacyTimer = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    conversation = null;
    legacyId = '';
    legacyPhone = '';
    showView('start');
  });

  // ── SSE connection ────────────────────────────────────────
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
    if (!window.EventSource) { startPolling(); return; }

    stream = new EventSource(`/api/chat/stream?sset=${encodeURIComponent(token)}`);

    stream.addEventListener('hello', e => {
      streamAttempts = 0;
      const data = JSON.parse(e.data);
      if (data.conversation) {
        conversation = data.conversation;
        if (data.payments) { payments = data.payments; renderPaymentPanel(); }
        setPresence(data.support?.online);
      }
    });

    stream.addEventListener('message', e => {
      const data = JSON.parse(e.data);
      if (data.message) {
        if (typingLine) typingLine.hidden = true;
        appendMessage(data.message);
        markRead();
      }
    });

    stream.addEventListener('typing', e => {
      const data = JSON.parse(e.data);
      if (typingLine) typingLine.hidden = !data.typing;
      if (data.typing) chatMessages && (chatMessages.scrollTop = chatMessages.scrollHeight);
    });

    stream.addEventListener('presence', e => {
      const data = JSON.parse(e.data);
      setPresence(data.adminOnline);
    });

    stream.addEventListener('status', () => refresh());
    stream.addEventListener('read', () => {});

    stream.onerror = () => {
      if (streamAttempts >= 3) { disconnect(); startPolling(); return; }
      streamAttempts += 1;
      disconnect();
      setTimeout(connect, 4000);
    };
  }

  function disconnect() {
    if (stream) { stream.close(); stream = null; }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, 12000);
  }

  async function refresh() {
    if (!visitorId) return;
    try {
      const data = await api(`/api/chat/state?visitorId=${encodeURIComponent(visitorId)}`);
      if (data.conversation) {
        const changed = !conversation || conversation.id !== data.conversation.id ||
          (data.conversation.thread || []).length !== (conversation.thread || []).length;
        conversation = data.conversation;
        if (changed) {
          rendered.clear();
          renderThread(conversation.thread || []);
          (conversation.thread || []).forEach(m => rendered.add(m.id));
        }
        if (data.payments) { payments = data.payments; renderPaymentPanel(); }
        setPresence(data.support?.online);
      }
    } catch {}
  }

  async function markRead() {
    if (!conversation || !visitorId) return;
    try {
      await api('/api/chat/read', { method: 'POST', json: { conversationId: conversation.id, visitorId } });
    } catch {}
  }

  // ── send message ──────────────────────────────────────────
  async function sendMessage() {
    // Legacy ticket mode
    if (legacyId && legacyPhone) {
      const text = chatTextarea?.value?.trim();
      if (!text) return;
      if (chatSendBtn) chatSendBtn.disabled = true;
      try {
        await api(`/api/support/ticket/${encodeURIComponent(legacyId)}/reply`, {
          method: 'POST', json: { phone: legacyPhone, text }
        });
        if (chatTextarea) chatTextarea.value = '';
        await legacyRefresh();
      } catch (err) {
        if (chatTextarea) chatTextarea.placeholder = err.message || 'Error. Try again.';
        setTimeout(() => { if (chatTextarea) chatTextarea.placeholder = 'Type a message…'; }, 3000);
      } finally {
        if (chatSendBtn) chatSendBtn.disabled = false;
        chatTextarea?.focus();
      }
      return;
    }

    const text = String(chatTextarea?.value || '').trim();
    if (!text && !pendingAttachment) return;
    if (!conversation) {
      if (chatTextarea) chatTextarea.placeholder = 'Please start a chat first.';
      setTimeout(() => { if (chatTextarea) chatTextarea.placeholder = 'Type a message…'; }, 2000);
      return;
    }
    const payload = { conversationId: conversation.id, visitorId, text };
    if (pendingAttachment) payload.attachment = pendingAttachment;
    if (chatTextarea) chatTextarea.value = '';
    clearAttachment();
    if (chatSendBtn) chatSendBtn.disabled = true;
    signalTyping(false);

    try {
      const data = await api('/api/chat/message', { method: 'POST', json: payload });
      appendMessage(data.message);
      rendered.add(data.message.id);
    } catch (err) {
      if (chatTextarea) chatTextarea.placeholder = err.message || 'Error. Try again.';
      setTimeout(() => { if (chatTextarea) chatTextarea.placeholder = 'Type a message…'; }, 3000);
    } finally {
      if (chatSendBtn) chatSendBtn.disabled = false;
      chatTextarea?.focus();
    }
  }

  chatSendBtn?.addEventListener('click', sendMessage);
  chatTextarea?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  chatTextarea?.addEventListener('input', () => {
    chatTextarea.style.height = 'auto';
    chatTextarea.style.height = Math.min(chatTextarea.scrollHeight, 120) + 'px';
    signalTyping(true);
  });

  // ── typing signal ─────────────────────────────────────────
  function signalTyping(isTyping) {
    if (!conversation || legacyId) return;
    if (isTyping) {
      if (!typingSent) {
        typingSent = true;
        api('/api/chat/typing', { method: 'POST', json: { conversationId: conversation.id, visitorId, typing: true } }).catch(() => {});
      }
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => signalTyping(false), 2500);
    } else {
      if (typingSent) {
        typingSent = false;
        api('/api/chat/typing', { method: 'POST', json: { conversationId: conversation.id, visitorId, typing: false } }).catch(() => {});
      }
      clearTimeout(typingTimer);
    }
  }

  // ── attachment ────────────────────────────────────────────
  attachBtn?.addEventListener('click', () => fileInput?.click());
  attachClear?.addEventListener('click', clearAttachment);

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast && toast('Upload a JPG, PNG or WebP image.', { error: true });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast && toast('Images must be 5 MB or smaller.', { error: true });
      return;
    }
    if (!conversation) {
      toast && toast('Start a chat first, then attach your slip.', { error: true });
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      if (attachBtn) attachBtn.disabled = true;
      try {
        const saved = await api('/api/chat/attachment', {
          method: 'POST',
          json: { conversationId: conversation.id, visitorId, data: String(reader.result), kind: 'slip' }
        });
        pendingAttachment = saved;
        if (attachThumb) { attachThumb.src = saved.path; attachThumb.alt = 'Payment slip'; }
        if (attachPreview) attachPreview.hidden = false;
        if (chatTextarea) chatTextarea.placeholder = 'Add a note, then send the slip…';
      } catch (err) {
        toast && toast(err.message, { error: true });
      } finally {
        if (attachBtn) attachBtn.disabled = false;
      }
    };
    reader.readAsDataURL(file);
  });

  function clearAttachment() {
    pendingAttachment = null;
    if (attachPreview) attachPreview.hidden = true;
    if (chatTextarea) chatTextarea.placeholder = 'Type a message…';
  }

  // ── restore session on page load ──────────────────────────
  (async () => {
    const storedVid = readStored(VISITOR_KEY);
    if (!storedVid) return;
    visitorId = storedVid;
    try {
      const state = await api(`/api/chat/state?visitorId=${encodeURIComponent(storedVid)}`);
      if (state.conversation) {
        openChat(state.conversation, state.visitorId || storedVid, state.payments);
      }
    } catch {}
  })();
})();
