/* VELUNE — checkout */
(() => {
  'use strict';

  const { $, $$, api, cart, esc, getShipping, money, ready, state, toast } = window.VELUNE;

  const grid = $('[data-checkout-grid]');
  const empty = $('[data-checkout-empty]');
  const form = $('[data-checkout-form]');
  const banner = $('[data-form-banner]');
  const placeOrder = $('[data-place-order]');
  const summaryItems = $('[data-summary-items]');
  const promoInput = $('[data-promo-input]');
  const promoButton = $('[data-promo-apply]');
  const promoMessage = $('[data-promo-message]');
  const stateSelect = $('[data-state-select]');
  const countrySelect = $('[data-country-select]');
  const zipInput = $('[data-zip-input]');
  const zipLabel = $('[data-zip-label]');
  const gstinRow = $('[data-gstin-row]');
  const gstinInput = $('[data-gstin-input]');
  const phoneInput = $('[data-phone-input]');
  const phoneLabel = $('[data-phone-label]');
  const phoneOptional = $('[data-phone-optional]');
  const shipOptions = $('[data-ship-options]');
  const payList = $('[data-pay-methods]');
  const payPanel = $('[data-pay-panel]');
  const payRefRow = $('[data-pay-ref-row]');
  const payInstructions = $('[data-pay-instructions]');

  const PAY_ICONS = {
    bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M12 12v4M8 12v4M16 12v4"/></svg>',
    upi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="2" width="18" height="20" rx="3"/><path d="M8 6h8M8 11h3l4 6M8 17h3"/></svg>',
    binance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 4 4 4-4 4-4-4 4-4Zm-5 5 5 5 5-5 4 4-9 9-9-9 4-4Z"/></svg>',
    crypto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M9 7.5h4.5a2.25 2.25 0 0 1 0 4.5H9m0 0h5a2.25 2.25 0 0 1 0 4.5H9m0-9v13m1.5-13v13"/></svg>',
    cod: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="6" width="20" height="14" rx="2"/><circle cx="12" cy="13" r="3"/><path d="M6 9h.01M18 9h.01"/></svg>'
  };

  // Mirrors the shape /api/shipping documents, so the U.S. flow keeps working
  // if the request fails; every value is replaced by the live payload below.
  const shippingData = {
    methods: {
      standard: { label: 'Standard', price: 8, eta: '3–5 business days' },
      express: { label: 'Express', price: 18, eta: '1–2 business days' }
    },
    freeThreshold: 150,
    countries: [],
    states: []
  };
  let appliedPromo = null;
  let payments = null;
  let submitting = false;
  let country = null;
  const touched = new Set();
  let idempotencyKey =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `ck-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const round2 = (value) => Math.round(value * 100) / 100;
  const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]{3}$/;

  function selectedMethod() {
    return $('input[name="shippingMethod"]:checked')?.value || 'standard';
  }

  function selectedPaymentMethod() {
    return $('input[name="paymentMethod"]:checked')?.value || 'Bank Transfer';
  }

  function selectedChannel() {
    const name = selectedPaymentMethod();
    return (payments?.methods || []).find((method) => method.name === name) || null;
  }

  // ------------------------------------------------------------ addresses

  // Reads a fixed-length numeric postal pattern such as "^\d{6}$" (India) and
  // returns 6. Anything else — the U.S. "^\d{5}(-\d{4})?$" — returns 0, so the
  // U.S. field keeps exactly the markup the server rendered for it.
  const digitPattern = (pattern) => {
    const match = String(pattern || '').match(/\^\\d\{(\d+)\}\$/);
    return match ? Number(match[1]) : 0;
  };

  function zipRegexp(entry) {
    try {
      return new RegExp(String(entry?.zipPattern || '\\d{5}'));
    } catch {
      return /^\d{5}$/;
    }
  }

  // Same digit rules the server applies in normaliseMobile(), used here only to
  // tell the shopper before submit and to send an unambiguous number.
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

  function renderCountries() {
    if (!countrySelect) return;
    const list = shippingData.countries.length
      ? shippingData.countries
      : [{ code: 'US', label: 'United States', states: shippingData.states }];
    const previous = countrySelect.value;
    countrySelect.innerHTML = list
      .map((entry) => `<option value="${esc(entry.code)}">${esc(entry.label)}</option>`)
      .join('');
    const wanted = previous || 'US';
    countrySelect.value = list.some((entry) => entry.code === wanted) ? wanted : list[0].code;
  }

  function fillStates(states) {
    if (!stateSelect || !Array.isArray(states)) return;
    const previous = stateSelect.value;
    stateSelect.innerHTML =
      '<option value="">Select state</option>' +
      states.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    if (previous && states.includes(previous)) stateSelect.value = previous;
  }

  // The server-rendered attributes of the default (U.S.) postal field are the
  // source of truth for a market without a fixed-length numeric code, so
  // switching back to it restores the markup instead of inventing new copy.
  let zipDefaults = null;
  function captureZipDefaults() {
    if (zipDefaults || !zipInput) return;
    zipDefaults = {
      maxlength: zipInput.getAttribute('maxlength'),
      placeholder: zipInput.getAttribute('placeholder'),
      title: zipInput.getAttribute('title')
    };
  }

  function setZipAttribute(name, value) {
    if (!zipInput) return;
    if (value === null || value === undefined) zipInput.removeAttribute(name);
    else zipInput.setAttribute(name, value);
  }

  function applyCountry(code, { keepValues = false } = {}) {
    const entry =
      shippingData.countries.find((countryEntry) => countryEntry.code === code) ||
      shippingData.countries[0] ||
      { code: 'US', label: 'United States', states: shippingData.states, zipLabel: 'ZIP code', zipPattern: '^\\d{5}(-\\d{4})?$' };
    country = entry;

    if (countrySelect) countrySelect.value = entry.code;
    fillStates(entry.states || []);

    const digits = digitPattern(entry.zipPattern);
    captureZipDefaults();
    if (zipLabel) zipLabel.textContent = entry.zipLabel || 'Postal code';
    if (zipInput) {
      zipInput.setAttribute('pattern', entry.zipPattern || '\\d{5}');
      if (digits > 0) {
        // A fixed-length numeric code: mask exactly the digits the server asks for.
        zipInput.maxLength = digits;
        zipInput.placeholder = '0'.repeat(digits);
        zipInput.title = `Enter a ${digits}-digit ${entry.zipLabel || 'postal code'}.`;
      } else {
        setZipAttribute('maxlength', zipDefaults.maxlength);
        setZipAttribute('placeholder', zipDefaults.placeholder);
        setZipAttribute('title', zipDefaults.title);
      }
    }

    if (phoneInput) {
      if (entry.phoneExample) phoneInput.placeholder = entry.phoneExample;
      const required = entry.code === 'IN';
      phoneInput.required = required;
      phoneInput.setAttribute('aria-required', String(required));
      if (phoneLabel) phoneLabel.textContent = required ? 'Mobile' : 'Phone';
      if (phoneOptional) {
        phoneOptional.textContent = required ? '(required)' : '(optional)';
        phoneOptional.hidden = false;
      }
    }

    if (gstinRow) {
      gstinRow.hidden = entry.code !== 'IN';
      // Without a GSTIN beside it the postal field takes the whole row.
      zipInput?.closest('.field')?.classList.toggle('field--full', gstinRow.hidden);
    }
    if (gstinInput) {
      gstinInput.disabled = entry.code !== 'IN';
      if (!keepValues) gstinInput.value = '';
    }

    if (!keepValues) {
      touched.forEach((input) => validateField(input));
    }
    const hint = $('[data-country-hint]');
    if (hint) {
      hint.textContent = `We ship to ${shippingData.countries.map((countryEntry) => countryEntry.label).join(' and ') || 'India and the United States'} — choose your country and the address fields adjust.`;
    }
  }

  // ------------------------------------------------------------ validation

  function errorNodeFor(input) {
    const id = `${input.id}-error`;
    let node = document.getElementById(id);
    if (!node) {
      node = document.createElement('p');
      node.id = id;
      node.className = 'form-error';
      node.setAttribute('role', 'alert');
      node.setAttribute('aria-live', 'polite');
      (input.closest('.field') || input.parentElement || form).appendChild(node);
    }
    return node;
  }

  function setFieldError(input, message) {
    if (!input) return;
    const node = errorNodeFor(input);
    node.textContent = message || '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (message) input.setAttribute('aria-describedby', node.id);
    else input.removeAttribute('aria-describedby');
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // One rule per field, worded like the server so inline and server errors
  // read the same. Returns '' when the field is acceptable.
  const rules = {
    email: (value) => (emailPattern.test(value.trim()) ? '' : 'Please enter a valid email address.'),
    firstName: (value) => (value.trim().length >= 2 ? '' : 'Please enter your first name.'),
    lastName: (value) => (value.trim().length >= 2 ? '' : 'Please enter your last name.'),
    address1: (value) => (value.trim().length >= 3 ? '' : 'Please enter a street address.'),
    city: (value) => (value.trim().length >= 2 ? '' : 'Please enter a city.'),
    state: (value) => {
      const list = country?.states || [];
      if (!value) return `Please choose your ${country?.code === 'IN' ? 'state or union territory' : 'state'}.`;
      return list.includes(value) ? '' : `Please choose a valid ${country?.code === 'IN' ? 'Indian state or union territory' : 'U.S. state'}.`;
    },
    zip: (value) => {
      const clean = value.trim();
      if (!zipRegexp(country).test(clean)) {
        const digits = digitPattern(country?.zipPattern);
        return digits
          ? `Please enter a valid ${digits}-digit ${country?.zipLabel || 'code'}.`
          : `Please enter a valid ${country?.zipLabel || 'postal code'}.`;
      }
      return '';
    },
    phone: (value) => {
      const clean = value.trim();
      if (country?.code === 'IN') {
        const mobile = normaliseMobile(clean);
        return mobile && mobile.startsWith('+91')
          ? ''
          : `An India delivery needs an Indian mobile number, for example ${country?.phoneExample || '98765 43210'}.`;
      }
      if (!clean) return '';
      const mobile = normaliseMobile(clean);
      return mobile && mobile.startsWith('+1')
        ? ''
        : `Enter a valid phone number, for example ${country?.phoneExample || '+1 415 555 0132'}.`;
    },
    gstin: (value) => {
      const clean = value.trim().toUpperCase();
      if (!clean) return '';
      return GSTIN_PATTERN.test(clean) ? '' : 'That GSTIN does not look valid. Leave it blank for a personal order.';
    }
  };

  // Every field that has a rule, including one a hidden country-specific field
  // such as GSTIN: it starts disabled and only gains a listener once the market
  // changes, so live validation would otherwise never reach it.
  const ruleFields = () =>
    Object.keys(rules)
      .map((name) => form?.querySelector(`[name="${name}"]`))
      .filter(Boolean);

  // Disabled fields are not part of the submitted address, so they are not
  // validated on submit either.
  const validatedFields = () => ruleFields().filter((input) => !input.disabled);

  function validateField(input) {
    const rule = rules[input.name];
    if (!rule) return '';
    const message = rule(input.value || '');
    setFieldError(input, message);
    return message;
  }

  function validateForm() {
    const problems = [];
    validatedFields().forEach((input) => {
      const message = validateField(input);
      if (message) problems.push(input);
    });
    return problems;
  }

  // ------------------------------------------------------------ payment

  function renderPaymentList() {
    if (!payList || !payments?.methods?.length) return;
    const previous = selectedPaymentMethod();
    payList.innerHTML = payments.methods
      .map(
        (method, index) => {
          const checked = method.name === previous ? true : index === 0 && !payments.methods.some((m) => m.name === previous);
          return `<label class="pay-method-option${checked ? ' is-selected' : ''}">
            <input type="radio" name="paymentMethod" value="${esc(method.name)}"${checked ? ' checked' : ''}>
            <span class="pay-method-option__icon" aria-hidden="true">${PAY_ICONS[method.key] || PAY_ICONS.bank}</span>
            <span class="pay-method-option__text">
              <strong>${esc(method.label)}</strong>
              <span>${esc(method.note || (method.key === 'cod' ? 'Pay when your order arrives at your door' : 'We confirm payment before dispatch'))}</span>
            </span>
          </label>`;
        }
      )
      .join('');
  }

  function renderPaymentPanel() {
    const channel = selectedChannel();
    $$('.pay-method-option').forEach((label) => {
      label.classList.toggle('is-selected', label.querySelector('input')?.checked === true);
    });
    if (payInstructions) {
      payInstructions.textContent = payments?.instructions || '';
      payInstructions.hidden = !payments?.instructions;
    }
    if (!payPanel) return;

    if (!channel) {
      payPanel.innerHTML = '<p class="pay-empty">Loading payment options…</p>';
      if (payRefRow) payRefRow.hidden = true;
      return;
    }

    if (channel.key === 'cod') {
      payPanel.innerHTML = `<div class="cod-payment"><p>${esc(
        channel.note || 'No card details needed — you pay the courier when your order arrives.'
      )}</p></div>`;
      if (payRefRow) payRefRow.hidden = true;
      return;
    }

    const rows = (channel.fields || [])
      .map(
        (field) => `<div class="pay-info__row">
          <span>${esc(field.label)}</span>
          <b class="pay-mono">${esc(field.value)}</b>
          <button class="pay-copy" type="button" data-pay-copy="${esc(field.value)}">Copy</button>
        </div>`
      )
      .join('');
    payPanel.innerHTML = `<div class="pay-info">
        <div class="pay-info__main">
          <h3>${esc(channel.label)}</h3>
          ${channel.note ? `<p class="pay-info__note">${esc(channel.note)}</p>` : ''}
          ${rows ? `<div class="pay-info__rows">${rows}</div>` : ''}
          <p class="pay-info__steps">Place the order, then open it from the confirmation link and <strong>upload your payment slip</strong>. Our team marks it paid as soon as the money lands.</p>
        </div>
        ${channel.qr ? `<figure class="pay-qr"><img src="${esc(channel.qr)}" alt="${esc(channel.label)} QR code" width="150" height="150"><figcaption>Scan to pay</figcaption></figure>` : ''}
      </div>`;
    if (payRefRow) payRefRow.hidden = false;
  }

  // ------------------------------------------------------------ summary

  function currentTotals() {
    const subtotal = cart.subtotal();
    const discount = appliedPromo?.type === 'percent' ? round2(subtotal * (Number(appliedPromo.value) / 100)) : 0;
    const merchandise = round2(subtotal - discount);
    const method = selectedMethod();
    let shipping = shippingData.methods[method]?.price ?? 0;
    if (method === 'standard') {
      if (merchandise >= shippingData.freeThreshold) shipping = 0;
      if (appliedPromo?.type === 'shipping') shipping = 0;
    }
    return { subtotal, discount, merchandise, shipping, tax: 0, total: round2(merchandise + shipping) };
  }

  function setPromoMessage(text, type = '') {
    if (!promoMessage) return;
    promoMessage.textContent = text;
    promoMessage.className = `promo-message${text ? ' is-visible' : ''}${type ? ` is-${type}` : ''}`;
  }

  function shipOptionMarkup(key, method, checked) {
    const standard = key === 'standard';
    const meta = standard
      ? `<span data-ship-eta="standard">${esc(method.eta)}</span> · <span data-ship-free-note>complimentary over ${money(shippingData.freeThreshold)}</span>`
      : `<span data-ship-eta="${esc(key)}">${esc(method.eta)}</span>`;
    return `<label class="ship-option${checked ? ' is-selected' : ''}">
      <input type="radio" name="shippingMethod" value="${esc(key)}"${checked ? ' checked' : ''}>
      <span class="ship-option__text">
        <strong data-ship-label="${esc(key)}">${esc(method.label)}</strong>
        <span>${meta}</span>
      </span>
      <span class="ship-option__price" data-ship-price="${esc(key)}">${money(method.price)}</span>
    </label>`;
  }

  // Built once from the live /api/shipping methods; later renders only refresh
  // the numbers, so keyboard focus on a chosen option is never lost.
  function renderShipOptions() {
    if (!shipOptions) return;
    const entries = Object.entries(shippingData.methods || {});
    if (!entries.length) return;
    const keys = $$('input[name="shippingMethod"]', shipOptions).map((input) => input.value);
    const same = entries.length === keys.length && entries.every(([key]) => keys.includes(key));
    if (same) return;
    const previous = selectedMethod();
    shipOptions.innerHTML = entries
      .map(
        ([key, method], index) =>
          shipOptionMarkup(key, method, previous && shippingData.methods[previous] ? previous === key : index === 0)
      )
      .join('');
  }

  function updateShipPrices() {
    if (!shipOptions) return;
    const totals = currentTotals();
    const freeNote = shipOptions.querySelector('[data-ship-free-note]');
    if (freeNote) freeNote.textContent = `complimentary over ${money(shippingData.freeThreshold)}`;
    Object.entries(shippingData.methods || {}).forEach(([key, method]) => {
      const labelNode = shipOptions.querySelector(`[data-ship-label="${key}"]`);
      if (labelNode && method.label) labelNode.textContent = method.label;
      const etaNode = shipOptions.querySelector(`[data-ship-eta="${key}"]`);
      if (etaNode && method.eta) etaNode.textContent = method.eta;
      const node = shipOptions.querySelector(`[data-ship-price="${key}"]`);
      if (!node) return;
      const free = key === 'standard' && (totals.merchandise >= shippingData.freeThreshold || appliedPromo?.type === 'shipping');
      node.textContent = free ? 'Complimentary' : money(method.price);
    });
    $$('.ship-option', shipOptions).forEach((option) => {
      option.classList.toggle('is-selected', option.querySelector('input')?.checked === true);
    });
  }

  function renderSummary() {
    if (!summaryItems) return;
    const lines = cart.detailed();
    const hasItems = lines.length > 0;

    if (grid) grid.hidden = !hasItems;
    if (empty) empty.hidden = hasItems;

    if (!hasItems) {
      setPromoMessage('');
      return;
    }

    summaryItems.innerHTML = lines
      .map(
        ({ product, qty, variant, lineTotal }) => `
        <div class="summary-item">
          <a class="summary-thumb" href="/product/${esc(product.slug)}" aria-label="View ${esc(product.name)}">
            ${window.VELUNE.mediaThumb(product.cardImage, { alt: product.name, width: 54, height: 68 })}
            <span>${qty}</span>
          </a>
          <div>
            <a class="summary-item__name" href="/product/${esc(product.slug)}">${esc(product.name)}</a>
            ${variant ? `<p class="summary-item__variant">${esc(variant)}</p>` : ''}
          </div>
          <span class="summary-item__price">${money(lineTotal)}</span>
        </div>`
      )
      .join('');

    const totals = currentTotals();

    const subtotalNode = $('[data-summary-subtotal]');
    if (subtotalNode) subtotalNode.textContent = money(totals.subtotal);
    const discountRow = $('[data-discount-row]');
    if (discountRow) discountRow.hidden = totals.discount <= 0;
    const discountNode = $('[data-summary-discount]');
    if (discountNode) discountNode.textContent = totals.discount > 0 ? `−${money(totals.discount)}` : money(0);
    const shippingNode = $('[data-summary-shipping]');
    if (shippingNode) shippingNode.textContent = totals.shipping > 0 ? money(totals.shipping) : 'Complimentary';
    const taxNode = $('[data-summary-tax]');
    if (taxNode) taxNode.textContent = money(totals.tax);
    const totalNode = $('[data-summary-total]');
    if (totalNode) totalNode.textContent = money(totals.total);
    if (placeOrder) placeOrder.textContent = `Place order — ${money(totals.total)}`;

    const express = shippingData.methods.express?.price ?? 0;
    const shipNote = $('[data-checkout-ship-note]');
    if (shipNote) {
      if (selectedMethod() === 'express') {
        shipNote.textContent = `Express is ${money(express)}. Complimentary shipping applies to standard delivery only.`;
      } else if (appliedPromo?.type === 'shipping') {
        shipNote.textContent = 'Free standard shipping applied with your promo code.';
      } else if (totals.merchandise >= shippingData.freeThreshold) {
        shipNote.textContent = 'Complimentary standard shipping unlocked.';
      } else {
        shipNote.textContent = `Add ${money(round2(shippingData.freeThreshold - totals.merchandise))} more for complimentary standard shipping.`;
      }
    }

    renderShipOptions();
    updateShipPrices();
  }

  function showError(message) {
    if (!banner) return;
    banner.textContent = message;
    banner.classList.add('is-visible');
    banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function clearError() {
    if (!banner) return;
    banner.textContent = '';
    banner.classList.remove('is-visible');
  }

  // ------------------------------------------------------------ submit

  async function applyPromo() {
    if (!promoInput) return;
    const code = promoInput.value.trim().toUpperCase();
    if (!code) {
      appliedPromo = null;
      setPromoMessage('');
      renderSummary();
      return;
    }
    if (promoButton) promoButton.disabled = true;
    try {
      const data = await api('/api/promo', { method: 'POST', json: { code } });
      appliedPromo = {
        code: data.code,
        type: data.type,
        label: data.label,
        value: Number(data.value) || (data.type === 'percent' ? 10 : 100)
      };
      promoInput.value = data.code;
      setPromoMessage(`${data.label} applied.`, 'success');
      clearError();
    } catch (error) {
      appliedPromo = null;
      setPromoMessage(error.message, 'error');
    } finally {
      if (promoButton) promoButton.disabled = false;
      renderSummary();
    }
  }

  function buildPayload() {
    const selected = cart.detailed();
    const formData = new FormData(form);
    const text = (name) => String(formData.get(name) || '').trim();
    const countryCode = country?.code || 'US';

    const shipping = {
      address1: text('address1'),
      address2: text('address2'),
      city: text('city'),
      state: text('state'),
      zip: text('zip'),
      country: countryCode
    };
    // GSTIN is an India-only field; the U.S. payload stays exactly as before.
    if (countryCode === 'IN') shipping.gstin = text('gstin').toUpperCase();

    const phone = text('phone');
    return {
      items: selected.map(({ product, qty, variant }) => ({ slug: product.slug, qty, variant })),
      customer: {
        firstName: text('firstName'),
        lastName: text('lastName'),
        email: text('email'),
        phone: countryCode === 'IN' ? normaliseMobile(phone) || phone : phone
      },
      shipping,
      shippingMethod: selectedMethod(),
      paymentMethod: selectedPaymentMethod(),
      paymentReference: payRefRow?.hidden ? '' : text('paymentReference'),
      promoCode: appliedPromo?.code || '',
      notes: text('notes'),
      idempotencyKey
    };
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (submitting || !form) return;
    clearError();

    const selected = cart.detailed();
    if (!selected.length) {
      renderSummary();
      return;
    }

    validatedFields().forEach((input) => touched.add(input));
    const problems = validateForm();
    if (problems.length) {
      const first = problems[0];
      first.focus();
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showError(`${problems.length === 1 ? 'One field' : `${problems.length} fields`} still need${problems.length === 1 ? 's' : ''} your attention above.`);
      return;
    }

    const payload = buildPayload();

    submitting = true;
    if (placeOrder) {
      placeOrder.disabled = true;
      placeOrder.textContent = 'Placing your order…';
    }
    try {
      const data = await api('/api/orders', { method: 'POST', json: payload });
      cart.clear();
      const query = new URLSearchParams({ number: data.order.number, token: data.token, placed: '1' });
      window.location.href = `/order?${query.toString()}`;
    } catch (error) {
      submitting = false;
      if (placeOrder) placeOrder.disabled = false;
      renderSummary();
      showError(error.message);
      if (error.status === 409) {
        window.VELUNE.getCatalog(true).then(renderSummary).catch(() => {});
      }
    }
  }

  function prefillAccount(customer) {
    if (!customer || !form) return;
    const setIfEmpty = (name, value) => {
      const input = form.querySelector(`[name="${name}"]`);
      if (input && !input.value.trim() && value) input.value = value;
    };
    setIfEmpty('email', customer.email);
    setIfEmpty('firstName', customer.firstName);
    setIfEmpty('lastName', customer.lastName);
    setIfEmpty('phone', customer.phone);
    const note = $('[data-checkout-account]');
    if (note) {
      note.innerHTML = `Signed in as <strong>${esc(customer.email)}</strong>. This order will appear in your account. <a href="/account">View account</a>`;
      note.hidden = false;
    }
  }

  (async () => {
    await ready;
    try {
      const data = await getShipping();
      if (data?.methods) shippingData.methods = data.methods;
      shippingData.freeThreshold = Number(data?.freeThreshold) || shippingData.freeThreshold;
      if (Array.isArray(data?.states)) shippingData.states = data.states;
      if (Array.isArray(data?.countries)) shippingData.countries = data.countries;
    } catch {
      /* The form still works with the documented fallback rates. */
    }

    renderCountries();
    applyCountry(countrySelect?.value || 'US', { keepValues: true });

    try {
      const session = await api('/api/auth/session');
      if (session.customer) prefillAccount(session.customer);
    } catch {
      /* Guest checkout remains available if the session check fails. */
    }

    try {
      const data = await api('/api/payments');
      if (Array.isArray(data.methods)) payments = data;
    } catch {
      /* The static bank + cash-on-delivery options stay usable. */
    }

    renderPaymentList();
    renderSummary();
    renderPaymentPanel();

    form?.addEventListener('submit', submitOrder);
    countrySelect?.addEventListener('change', () => {
      applyCountry(countrySelect.value);
    });

    ruleFields().forEach((input) => {
      input.addEventListener('blur', () => {
        touched.add(input);
        validateField(input);
      });
      input.addEventListener('input', () => {
        if (touched.has(input)) validateField(input);
      });
      input.addEventListener('change', () => {
        touched.add(input);
        validateField(input);
      });
    });

    promoButton?.addEventListener('click', applyPromo);
    promoInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      applyPromo();
    });
    promoInput?.addEventListener('input', () => {
      const normalized = promoInput.value.trim().toUpperCase();
      if (appliedPromo && normalized !== appliedPromo.code) {
        appliedPromo = null;
        setPromoMessage('');
        renderSummary();
      }
    });
    shipOptions?.addEventListener('change', (event) => {
      if (!event.target.matches('input[name="shippingMethod"]')) return;
      renderSummary();
    });
    payList?.addEventListener('change', (event) => {
      if (event.target.matches('input[name="paymentMethod"]')) renderPaymentPanel();
    });
    payPanel?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-pay-copy]');
      if (!button) return;
      const value = button.dataset.payCopy || '';
      const done = () => {
        button.textContent = 'Copied';
        setTimeout(() => {
          button.textContent = 'Copy';
        }, 1600);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(value).then(done).catch(() => toast('Copy failed — select the text manually.', { error: true }));
      } else {
        toast('Your browser blocks clipboard access here.', { error: true });
      }
    });
    document.addEventListener('velune:cartchange', renderSummary);
    // The summary, delivery prices and the button label all follow the currency
    // without a reload, from the same USD numbers the server charges.
    document.addEventListener('velune:currencychange', renderSummary);
  })();

  // Keep the page honest if the tab is restored with an emptied cart.
  window.addEventListener('pageshow', () => {
    if (state.products.length) renderSummary();
  });
})();
