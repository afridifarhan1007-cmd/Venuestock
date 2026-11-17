/* VELUNE — order tracking */
(() => {
  'use strict';

  const { $, api, esc, getShipping, money, toast } = window.VELUNE;

  const lookup = $('[data-order-lookup]');
  const lookupForm = $('[data-lookup-form]');
  const lookupError = $('[data-lookup-error]');
  const lookupSubmit = $('[data-lookup-submit]');
  const numberInput = $('#order-number');
  const emailInput = $('#order-email');
  const root = $('[data-order-root]');
  const heading = $('[data-order-heading]');
  const sub = $('[data-order-sub]');
  const eyebrow = $('[data-order-eyebrow]');
  const supportEmail = $('.site-header')?.dataset.supportEmail || 'support@velune.store';
  const supportHref = (orderNumber) =>
    `mailto:${supportEmail}?subject=${encodeURIComponent(`Order ${orderNumber}`)}`;

  const steps = ['Confirmed', 'Packed', 'Shipped', 'Delivered'];
  // Fallback only — the live labels and ETAs come from /api/shipping.
  const shippingLabels = {
    standard: { label: 'Standard delivery', eta: '3–5 business days' },
    express: { label: 'Express delivery', eta: '1–2 business days' }
  };
  let shipMethods = null;

  const regionNames = (() => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      return null;
    }
  })();

  const countryLabel = (code) => {
    const iso = String(code || '').toUpperCase();
    return regionNames?.of(iso) || iso || '—';
  };

  async function loadShipMethods() {
    if (shipMethods) return shipMethods;
    const data = await getShipping();
    shipMethods = data?.methods || null;
    return shipMethods;
  }

  function deliveryLabel(order) {
    const live = shipMethods?.[order.shippingMethod];
    if (live) return { label: `${live.label} delivery`, eta: live.eta || '' };
    return shippingLabels[order.shippingMethod] || { label: order.shippingMethod, eta: '' };
  }

  let currentOrder = null;
  let currentToken = '';
  let whatsappConfirmUrl = '';
  let payments = null;

  async function loadPayments() {
    if (payments) return payments;
    try {
      const data = await api('/api/payments');
      payments = Array.isArray(data.methods) ? data : { methods: [], instructions: '' };
    } catch {
      payments = { methods: [], instructions: '' };
    }
    return payments;
  }

  function channelFor(order) {
    return (payments?.methods || []).find((method) => method.name === order.paymentMethod) || null;
  }

  const MAX_SLIP_BYTES = 5 * 1024 * 1024;

  function slipStrip(order) {
    const proofs = Array.isArray(order.paymentProof) ? order.paymentProof : [];
    if (!proofs.length) return '<p class="order-slip__none">No slip uploaded yet.</p>';
    return `<div class="order-slip__list">${proofs
      .slice(-4)
      .reverse()
      .map(
        (proof) => `<figure class="order-slip${proof.status === 'accepted' ? ' is-accepted' : ''}${proof.status === 'rejected' ? ' is-rejected' : ''}">
          <a href="${esc(proof.path)}" target="_blank" rel="noopener"><img src="${esc(proof.path)}" alt="Payment slip" loading="lazy"></a>
          <figcaption>${esc(proof.status || 'pending')}${proof.reference ? ` · ${esc(proof.reference)}` : ''}</figcaption>
        </figure>`
      )
      .join('')}</div>`;
  }

  function paymentPanelMarkup(order) {
    if (order.status === 'Cancelled') return '';
    const paid = order.paymentStatus === 'Paid';
    const channel = channelFor(order);
    const isCod = order.paymentMethod === 'Cash on delivery';
    const note = order.proofReviewNote
      ? `<p class="order-pay__note">${esc(order.proofReviewNote)}</p>`
      : '';

    if (paid) {
      return `<section class="order-pay">
        <header class="order-pay__head"><h3>Payment settled</h3>${statusPill(order.paymentStatus)}</header>
        <p class="order-pay__lead">We received your ${esc(order.paymentMethod)} payment for ${money(order.total)} and will dispatch once the parcel is packed.</p>
        ${slipStrip(order)}
      </section>`;
    }

    const details = isCod
      ? '<p class="order-pay__lead">Pay the courier when your order arrives. No online payment is needed for this order.</p>'
      : channel
        ? `<div class="order-pay__info">
            ${channel.note ? `<p class="order-pay__lead">${esc(channel.note)}</p>` : ''}
            <div class="pay-info__rows">
              ${(channel.fields || [])
                .map(
                  (field) => `<div class="pay-info__row">
                    <span>${esc(field.label)}</span>
                    <b class="pay-mono">${esc(field.value)}</b>
                    <button class="pay-copy" type="button" data-pay-copy="${esc(field.value)}">Copy</button>
                  </div>`
                )
                .join('')}
            </div>
            ${channel.qr ? `<figure class="pay-qr pay-qr--order"><img src="${esc(channel.qr)}" alt="${esc(channel.label)} QR code" width="150" height="150"><figcaption>Scan to pay</figcaption></figure>` : ''}
          </div>`
        : `<p class="order-pay__lead">Send ${money(order.total)} with ${esc(order.paymentMethod)}. Need our account details again? Ask support in the live chat and we will post them here.</p>`;

    return `<section class="order-pay">
      <header class="order-pay__head">
        <h3>Payment</h3>
        <span class="order-pay__status${order.paymentStatus === 'Proof submitted' ? ' is-proof' : ''}">${esc(order.paymentStatus || 'Awaiting Payment')}</span>
      </header>
      ${details}
      ${note}
      ${slipStrip(order)}
      <form class="order-slip-form" data-slip-form>
        <p class="order-slip-form__title">Upload your payment slip</p>
        <div class="order-slip-form__row">
          <label class="btn btn--outline btn--small order-slip-pick">
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-slip-file>
            Choose image
          </label>
          <span class="order-slip-form__name" data-slip-name>No file chosen</span>
        </div>
        <img class="order-slip-preview" data-slip-preview hidden alt="Selected payment slip preview">
        <div class="field">
          <label for="slip-reference">Reference <span style="text-transform:none;letter-spacing:0;">(optional)</span></label>
          <input id="slip-reference" type="text" maxlength="80" data-slip-reference placeholder="UPI reference, Binance order id or tx hash">
        </div>
        <p class="form-error" role="alert" data-slip-error></p>
        <button class="btn btn--small" type="submit" data-slip-submit>Send slip</button>
        <p class="field-hint" style="margin-top:8px;">JPEG, PNG or WebP up to 5 MB. Our team reviews slips within one business day, Monday–Friday.</p>
      </form>
      ${order.paymentReference ? `<p class="field-hint" style="margin-top:10px;">Reference on file: <strong>${esc(order.paymentReference)}</strong></p>` : ''}
    </section>`;
  }

  function wirePaymentPanel(order) {
    const form = $('[data-slip-form]', root);
    if (!form) return;
    const fileInput = $('[data-slip-file]', form);
    const nameNode = $('[data-slip-name]', form);
    const preview = $('[data-slip-preview]', form);
    const reference = $('[data-slip-reference]', form);
    const errorNode = $('[data-slip-error]', form);
    const submit = $('[data-slip-submit]', form);
    let payload = '';

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      payload = '';
      if (!file) {
        if (nameNode) nameNode.textContent = 'No file chosen';
        if (preview) preview.hidden = true;
        return;
      }
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        if (errorNode) errorNode.textContent = 'Choose a JPEG, PNG or WebP image.';
        fileInput.value = '';
        return;
      }
      if (file.size > MAX_SLIP_BYTES) {
        if (errorNode) errorNode.textContent = 'That image is larger than 5 MB.';
        fileInput.value = '';
        return;
      }
      if (errorNode) errorNode.textContent = '';
      if (nameNode) nameNode.textContent = file.name.slice(0, 40);
      const reader = new FileReader();
      reader.onload = () => {
        payload = String(reader.result || '');
        if (preview) {
          preview.src = payload;
          preview.hidden = false;
        }
      };
      reader.onerror = () => {
        if (errorNode) errorNode.textContent = 'That image could not be read. Try another file.';
      };
      reader.readAsDataURL(file);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!payload) {
        if (errorNode) errorNode.textContent = 'Choose the slip image first.';
        return;
      }
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Sending…';
      }
      try {
        const data = await api(`/api/orders/${encodeURIComponent(order.number)}/proof`, {
          method: 'POST',
          json: { token: currentToken, data: payload, method: order.paymentMethod, reference: (reference?.value || '').trim() }
        });
        currentOrder = data.order;
        toast(data.message || 'Slip received.', { ok: true });
        renderOrder(data.order, { quiet: true });
      } catch (error) {
        if (errorNode) errorNode.textContent = error.message;
      } finally {
        if (submit) {
          submit.disabled = false;
          submit.textContent = 'Send slip';
        }
      }
    });

    const panel = $('.order-pay', root);
    panel?.addEventListener('click', (event) => {
      const copy = event.target.closest('[data-pay-copy]');
      if (!copy) return;
      const value = copy.dataset.payCopy || '';
      const done = () => {
        copy.textContent = 'Copied';
        setTimeout(() => {
          copy.textContent = 'Copy';
        }, 1600);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(value).then(done).catch(() => toast('Copy failed — select the text manually.', { error: true }));
      } else {
        toast('Your browser blocks clipboard access here.', { error: true });
      }
    });
  }


  const formatDate = (iso, withTime = true) => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {})
    }).format(date);
  };

  const thumbFor = (image) => (typeof image === 'string' && image.includes('-800') ? image.replace('-800', '-400') : image || '');

  const statusPill = (status) => {
    const cancelled = status === 'Cancelled';
    const delivered = status === 'Delivered';
    return `<span class="status-pill${cancelled ? ' status-pill--cancelled' : ''}${delivered ? ' status-pill--delivered' : ''}">${esc(status)}</span>`;
  };

  function timeline(order) {
    const history = new Map();
    for (const entry of order.statusHistory || []) {
      history.set(entry.status, entry.at);
    }
    if (order.status === 'Cancelled') {
      const cancelledAt = history.get('Cancelled');
      return `<div class="timeline-cancelled">This order was cancelled${cancelledAt ? ` on ${esc(formatDate(cancelledAt))}` : ''}. If this was unexpected, contact support with your order number.</div>
        <div class="timeline">
          ${steps
            .filter((step) => history.has(step))
            .map((step) => `<div class="timeline-step is-done"><span class="timeline-step__dot"></span><span>${esc(step)}</span><span class="timeline-step__time">${esc(formatDate(history.get(step)))}</span></div>`)
            .join('')}
        </div>`;
    }
    const currentIndex = steps.indexOf(order.status);
    return `<div class="timeline">
      ${steps
        .map((step, index) => {
          const done = currentIndex >= 0 && index < currentIndex;
          const current = index === currentIndex;
          const timestamp = history.get(step);
          return `<div class="timeline-step${done ? ' is-done' : ''}${current ? ' is-current' : ''}">
            <span class="timeline-step__dot"></span>
            <span>${esc(step)}</span>
            <span class="timeline-step__time">${timestamp ? esc(formatDate(timestamp)) : ''}</span>
          </div>`;
        })
        .join('')}
    </div>`;
  }

  function renderOrder(order, options = {}) {
    const placed = new URLSearchParams(window.location.search).get('placed') === '1';
    const isCod = order.paymentMethod === 'Cash on delivery';
    if (eyebrow) eyebrow.textContent = placed ? 'Thank you' : 'Client care';
    if (heading) heading.textContent = placed ? 'Your order is confirmed.' : 'Your order.';
    if (sub) {
      sub.textContent = placed
        ? isCod
          ? 'Your order request is saved. Nothing was charged — you pay when the parcel arrives.'
          : 'Your order request is saved. Pay with the method you chose, then upload the slip below.'
        : 'A private view of your order. Keep this link to return to it.';
    }

    const fullName = `${order.customer.firstName} ${order.customer.lastName}`.trim();
    const address = order.shipping;
    const ship = deliveryLabel(order);
    const history = new Map((order.statusHistory || []).map((entry) => [entry.status, entry.at]));
    const isCancelled = order.status === 'Cancelled';

    const successMarkup = placed
      ? `<div class="order-success">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.1 7.5 9.5 4.3-1.4 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m8.6 11.8 2.3 2.3 4.5-4.7"/></svg>
          <div>
            <strong>Order ${esc(order.number)} is in our system.</strong>
            <p>${isCod
              ? "We've noted your delivery details and reserved your pieces. Nothing was charged — pay the courier when the parcel arrives."
              : `We've reserved your pieces for 48 hours. Pay ${money(order.total)} with ${esc(order.paymentMethod)}, then upload the slip in the payment panel below.`}</p>
            ${whatsappConfirmUrl ? `<a class="btn btn--small" style="margin-top:12px;" href="${esc(whatsappConfirmUrl)}" target="_blank" rel="noopener noreferrer">Confirm on WhatsApp</a>` : '<p style="margin-top:10px;" class="field-hint">We may contact you to confirm availability before dispatch.</p>'}
          </div>
        </div>`
      : '';

    root.innerHTML = `
      ${successMarkup}
      <article class="order-card">
        <div class="order-card__head">
          <div>
            <div class="order-number">${esc(order.number)}</div>
            <div class="order-date">Placed ${esc(formatDate(order.createdAt))}</div>
          </div>
          ${statusPill(order.status)}
        </div>
        <div class="order-body">
          <div class="order-main">
            ${timeline(order)}
            <div class="order-items">
              <h3>Items</h3>
              ${order.items
                .map(
                  (item) => `
                  <div class="order-item">
                    ${window.VELUNE.mediaThumb(thumbFor(item.image), { alt: item.name, width: 50, height: 62 })}
                    <div>
                      <a class="order-item__name" href="/product/${esc(item.slug)}">${esc(item.name)}</a>
                      <p class="order-item__meta">${item.variant ? `${esc(item.variant)} · ` : ''}Qty ${Number(item.qty)}</p>
                    </div>
                    <span class="order-item__price" data-price-usd="${(Number(item.price) || 0) * (Number(item.qty) || 0)}">${money(Number(item.price) * Number(item.qty))}</span>
                  </div>`
                )
                .join('')}
              <div class="order-totals">
                <div class="summary-line"><span>Subtotal</span><span data-price-usd="${Number(order.subtotal) || 0}">${money(order.subtotal)}</span></div>
                ${Number(order.discount) > 0 ? `<div class="summary-line"><span>Discount${order.promoCode ? ` (${esc(order.promoCode)})` : ''}</span><span>−${money(order.discount)}</span></div>` : ''}
                <div class="summary-line"><span>Shipping</span><span${Number(order.shippingCost) > 0 ? ` data-price-usd="${Number(order.shippingCost) || 0}"` : ''}>${Number(order.shippingCost) > 0 ? money(order.shippingCost) : 'Complimentary'}</span></div>
                <div class="summary-line"><span>Tax</span><span data-price-usd="${Number(order.tax) || 0}">${money(order.tax)}</span></div>
                <div class="summary-line summary-line--total"><span>Total</span><span data-price-usd="${Number(order.total) || 0}">${money(order.total)}</span></div>
              </div>
            </div>
            ${paymentPanelMarkup(order)}
          </div>
          <aside class="order-side">
            <div class="order-block">
              <h3>Contact</h3>
              <p><strong>${esc(fullName)}</strong><br>${esc(order.customer.email)}${order.customer.phone ? `<br>${esc(order.customer.phone)}` : ''}</p>
            </div>
            <div class="order-block">
              <h3>Ship to</h3>
              <p>${esc(address.address1)}${address.address2 ? `<br>${esc(address.address2)}` : ''}<br>${esc(address.city)}, ${esc(address.state)} ${esc(address.zip)}<br>${esc(countryLabel(address.country))}</p>
              ${address.gstin ? `<p class="field-hint" style="margin-top:6px;">GSTIN <strong>${esc(address.gstin)}</strong></p>` : ''}
            </div>
            <div class="order-block">
              <h3>Delivery</h3>
              <p>${esc(ship.label)}<br>${esc(ship.eta)}</p>
              ${
                order.trackingNumber
                  ? `<div class="tracking-box"><span>Tracking number</span>${esc(order.trackingNumber)}</div>`
                  : '<p class="field-hint" style="margin-top:8px;">A tracking number appears here once the order ships.</p>'
              }
            </div>
            <div class="order-block">
              <h3>Payment</h3>
              <p>${esc(order.paymentMethod || 'Bank Transfer')}<br><span class="field-hint">${esc(order.paymentStatus || 'Awaiting Payment')}</span></p>
            </div>
            ${isCancelled || !isCod ? '' : '<div class="order-cod-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg><span>Cash on delivery: have your order total ready when the parcel arrives. We may contact you first to confirm availability.</span></div>'}
          </aside>
        </div>
      </article>
      <div class="order-actions">
        <button class="btn btn--outline btn--small" type="button" data-track-another>Track another order</button>
        <a class="text-link" href="/shop">Continue shopping</a>
      </div>
      <div class="order-help">
        <a href="/policies#shipping">Shipping policy</a>
        <a href="/policies#returns">Returns &amp; exchanges</a>
        <a href="${esc(supportHref(order.number))}">Email support</a>
        <span>Replies within one business day, Monday–Friday.</span>
      </div>`;

    lookup.hidden = true;
    root.hidden = false;
    document.title = `Order ${order.number} — VELUNE`;
    $('[data-track-another]', root)?.addEventListener('click', resetView);
    wirePaymentPanel(order);
    if (!options.quiet) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetView() {
    currentOrder = null;
    root.hidden = true;
    lookup.hidden = false;
    window.history.replaceState({}, '', '/order');
    if (heading) heading.textContent = 'Track your order';
    if (sub) sub.textContent = 'Enter your order number and the email used at checkout. No account needed.';
    if (eyebrow) eyebrow.textContent = 'Client care';
    document.title = 'Order Tracking — VELUNE';
    lookupForm?.reset();
    if (lookupError) lookupError.textContent = '';
    numberInput?.focus();
  }

  async function loadByToken(number, token, quiet = false) {
    if (!number || !token) return false;
    await Promise.all([loadPayments(), loadShipMethods()]);
    try {
      const data = await api(`/api/orders/${encodeURIComponent(number)}?token=${encodeURIComponent(token)}`);
      currentOrder = data.order;
      currentToken = token;
      whatsappConfirmUrl = data.whatsapp || '';
      renderOrder(data.order);
      return true;
    } catch (error) {
      if (!quiet) toast(error.message, { error: true });
      return false;
    }
  }

  lookupForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!lookupForm.reportValidity()) return;
    if (lookupError) lookupError.textContent = '';
    const number = String(numberInput?.value || '').trim().toUpperCase();
    const email = String(emailInput?.value || '').trim().toLowerCase();
    if (!/^VLN-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(number)) {
      if (lookupError) lookupError.textContent = 'Enter a valid order number (for example VLN-AB12-CD34).';
      numberInput?.focus();
      return;
    }
    if (lookupSubmit) {
      lookupSubmit.disabled = true;
      lookupSubmit.textContent = 'Finding order…';
    }
    try {
      await Promise.all([loadPayments(), loadShipMethods()]);
      const data = await api('/api/orders/lookup', { method: 'POST', json: { number, email } });
      currentOrder = data.order;
      currentToken = data.token;
      whatsappConfirmUrl = data.whatsapp || '';
      const query = new URLSearchParams({ number: data.order.number, token: data.token });
      window.history.replaceState({}, '', `/order?${query.toString()}`);
      renderOrder(data.order);
    } catch (error) {
      if (lookupError) lookupError.textContent = error.message;
    } finally {
      if (lookupSubmit) {
        lookupSubmit.disabled = false;
        lookupSubmit.textContent = 'Find order';
      }
    }
  });

  (async () => {
    const params = new URLSearchParams(window.location.search);
    const number = (params.get('number') || '').toUpperCase();
    const token = params.get('token') || '';
    if (number && numberInput) numberInput.value = number;

    if (number && token) {
      const loaded = await loadByToken(number, token, true);
      if (!loaded && lookupError) {
        lookupError.textContent = 'That order link is invalid or no longer available. Look it up with your email below.';
      }
    }
  })();

  // An INR visitor never sees raw dollars on the confirmation: the shared
  // formatter repaints every money line in place on a currency switch.
  document.addEventListener('velune:currencychange', () => {
    if (currentOrder) renderOrder(currentOrder, { quiet: true });
  });

  window.addEventListener('pageshow', async () => {
    if (currentOrder) return;
    const params = new URLSearchParams(window.location.search);
    const number = (params.get('number') || '').toUpperCase();
    const token = params.get('token') || '';
    if (number && token && root?.hidden) await loadByToken(number, token, true);
  });
})();
