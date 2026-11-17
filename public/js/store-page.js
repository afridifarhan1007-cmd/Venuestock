/* Public reseller storefront — bag and cash-on-delivery checkout */
(() => {
  'use strict';

  const { $, $$, api, esc, money, toast, ready, getShipping } = window.VELUNE;

  const form = $('[data-store-order-form]');
  const grid = $('[data-store-grid]');
  const bagNode = $('[data-store-bag]');
  const countrySelect = $('[data-store-country]');
  const stateSelect = $('[data-store-state]');
  const zipInput = $('[data-store-zip]');
  const zipLabel = $('[data-store-zip-label]');
  const shippingSelect = $('[data-store-shipping]');
  const subtotalNode = $('[data-store-subtotal]');
  const shippingNode = $('[data-store-shipping]');
  const totalNode = $('[data-store-total]');
  const submitBtn = $('[data-store-order-submit]');
  const errorNode = $('[data-store-order-error]');
  const confirmation = $('[data-store-confirmation]');
  const numberNode = $('[data-store-order-number]');
  const confirmationTotal = $('[data-store-order-total]');
  const orderLink = $('[data-store-order-link]');
  const againBtn = $('[data-store-order-again]');

  if (!form || !grid) return;

  const slug = (location.pathname.match(/^\/store\/([a-z0-9-]+)$/) || [])[1] || '';
  const bag = new Map();
  let shippingInfo = { standard: 8, express: 18, freeThreshold: 150, methods: null };
  let states = { US: [], IN: [] };
  let submitting = false;

  function eachCard(callback) {
    $$('[data-store-item]', grid).forEach(callback);
  }

  function readQty(input) {
    const value = Number(input?.value || 1);
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
  }

  function addItem(card) {
    const stock = Number(card.dataset.stock) || 0;
    const qtyInput = $('[data-store-qty]', card);
    const qty = Math.min(Math.max(1, readQty(qtyInput)), Math.max(1, Math.min(stock, 20)));
    const slugValue = card.dataset.slug;
    if (!slugValue || stock < 1) return;
    const existing = bag.get(slugValue);
    const nextQty = Math.min((existing?.qty || 0) + qty, stock);
    bag.set(slugValue, {
      slug: slugValue,
      name: $('h3', card)?.textContent?.trim() || slugValue,
      price: Number(card.dataset.price) || 0,
      image: $('img', card)?.getAttribute('src') || '',
      fallback: $('img', card)?.getAttribute('data-fallback-src') || '',
      stock,
      qty: nextQty
    });
    if (qtyInput) qtyInput.value = 1;
    renderBag();
    toast(`${nextQty} × ${bag.get(slugValue).name} in your bag.`);
  }

  function changeQty(slugValue, delta) {
    const item = bag.get(slugValue);
    if (!item) return;
    const next = Math.min(item.stock, Math.max(0, item.qty + delta));
    if (next < 1) bag.delete(slugValue);
    else item.qty = next;
    renderBag();
  }

  function renderBag() {
    if (!bag.size) {
      bagNode.innerHTML = '<p class="field-hint">Your bag is empty. Add a product from the shelf.</p>';
      submitBtn.disabled = true;
      updateTotals();
      return;
    }
    bagNode.innerHTML = [...bag.values()]
      .map(
        (item) => `<div class="store-bag__row" data-bag-row="${esc(item.slug)}">
          ${window.VELUNE.mediaThumb(item.image, { alt: item.name, width: 52, height: 64 })}
          <div class="store-bag__copy">
            <strong>${esc(item.name)}</strong>
            <span>${esc(money(item.price))} each</span>
          </div>
          <div class="store-bag__qty">
            <button type="button" aria-label="Decrease quantity" data-bag-decrease="${esc(item.slug)}">−</button>
            <span>${item.qty}</span>
            <button type="button" aria-label="Increase quantity" data-bag-increase="${esc(item.slug)}">+</button>
          </div>
          <button type="button" class="store-bag__remove" data-bag-remove="${esc(item.slug)}" aria-label="Remove ${esc(item.name)}">×</button>
        </div>`
      )
      .join('');
    submitBtn.disabled = false;
    updateTotals();
  }

  function subtotal() {
    return [...bag.values()].reduce((sum, item) => sum + item.price * item.qty, 0);
  }

  function shippingCost() {
    const method = shippingSelect.value;
    if (method === 'express') return Number(shippingInfo.express) || 18;
    const standard = Number(shippingInfo.standard) || 8;
    return subtotal() >= (Number(shippingInfo.freeThreshold) || 150) ? 0 : standard;
  }

  function updateTotals() {
    const merchandise = subtotal();
    const shipping = bag.size ? shippingCost() : 0;
    subtotalNode.textContent = money(merchandise);
    shippingNode.textContent = bag.size ? money(shipping) : money(0);
    totalNode.textContent = money(merchandise + shipping);
  }

  function populateStates(country) {
    if (!stateSelect) return;
    const list = states[country] || [];
    stateSelect.innerHTML = '<option value="">Select state</option>' + list.map((state) => `<option value="${esc(state)}">${esc(state)}</option>`).join('');
    if (zipLabel) zipLabel.textContent = country === 'IN' ? 'PIN code' : 'ZIP code';
    if (zipInput) {
      zipInput.value = '';
      zipInput.placeholder = country === 'IN' ? '400001' : '97209';
      zipInput.maxLength = country === 'IN' ? 6 : 10;
      zipInput.inputMode = 'numeric';
      zipInput.pattern = country === 'IN' ? '\\d{6}' : '\\d{5}(-\\d{4})?';
    }
    const phone = $('[name="phone"]', form);
    if (phone) phone.placeholder = country === 'IN' ? '98765 43210' : '+1 415 555 0132';
  }

  async function loadShipping() {
    try {
      const data = await getShipping(true);
      if (data?.methods) {
        shippingInfo.standard = Number(data.methods.standard?.price) || 8;
        shippingInfo.express = Number(data.methods.express?.price) || 18;
        shippingInfo.methods = data.methods;
      }
      if (Number(data?.freeThreshold) > 0) shippingInfo.freeThreshold = Number(data.freeThreshold);
      if (Array.isArray(data?.countries)) {
        for (const entry of data.countries) {
          states[entry.code] = Array.isArray(entry.states)
            ? entry.states.map((state) => (typeof state === 'string' ? state : state.label))
            : [];
        }
      }
      if (shippingSelect && shippingInfo.methods) {
        const current = shippingSelect.value;
        shippingSelect.innerHTML = `<option value="standard">${esc(shippingInfo.methods.standard.label)} · ${esc(shippingInfo.methods.standard.eta)} · ${esc(money(shippingInfo.standard))}</option>
          <option value="express">${esc(shippingInfo.methods.express.label)} · ${esc(shippingInfo.methods.express.eta)} · ${esc(money(shippingInfo.express))}</option>`;
        shippingSelect.value = current === 'express' ? 'express' : 'standard';
      }
      populateStates(countrySelect?.value || 'US');
      updateTotals();
    } catch {
      // The server recalculates shipping at checkout; defaults keep the
      // estimate sensible when this request is unavailable.
    }
  }

  grid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-store-add]');
    if (!button) return;
    const card = button.closest('[data-store-item]');
    if (card) addItem(card);
  });

  bagNode.addEventListener('click', (event) => {
    const decrease = event.target.closest('[data-bag-decrease]');
    const increase = event.target.closest('[data-bag-increase]');
    const remove = event.target.closest('[data-bag-remove]');
    if (decrease) changeQty(decrease.dataset.bagDecrease, -1);
    if (increase) changeQty(increase.dataset.bagIncrease, 1);
    if (remove) {
      bag.delete(remove.dataset.bagRemove);
      renderBag();
    }
  });

  countrySelect?.addEventListener('change', () => populateStates(countrySelect.value));
  shippingSelect?.addEventListener('change', updateTotals);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !bag.size) return;
    errorNode.textContent = '';
    const data = new FormData(form);
    const country = String(data.get('country') || 'US');
    const payload = {
      customer: {
        firstName: String(data.get('firstName') || '').trim(),
        lastName: String(data.get('lastName') || '').trim(),
        email: String(data.get('email') || '').trim(),
        phone: String(data.get('phone') || '').trim()
      },
      shipping: {
        address1: String(data.get('address1') || '').trim(),
        address2: String(data.get('address2') || '').trim(),
        city: String(data.get('city') || '').trim(),
        state: String(data.get('state') || '').trim(),
        zip: String(data.get('zip') || '').trim(),
        country
      },
      items: [...bag.values()].map((item) => ({ slug: item.slug, qty: item.qty })),
      shippingMethod: String(data.get('shippingMethod') || 'standard'),
      notes: '',
      idempotencyKey: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `store-${Date.now()}`
    };

    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Placing order…';
    try {
      const result = await api(`/api/stores/${encodeURIComponent(slug)}/orders`, { method: 'POST', json: payload });
      const order = result.order || {};
      form.hidden = true;
      confirmation.hidden = false;
      numberNode.textContent = order.number || '';
      confirmationTotal.textContent = `${money(order.total || 0)} · cash on delivery`;
      orderLink.href = `/order?number=${encodeURIComponent(order.number || '')}&token=${encodeURIComponent(result.token || '')}`;
      confirmation.scrollIntoView({ behavior: 'smooth', block: 'center' });
      bag.clear();
      toast(`Order ${order.number} placed.`);
    } catch (error) {
      errorNode.textContent = error.message;
    } finally {
      submitting = false;
      submitBtn.disabled = bag.size === 0;
      submitBtn.textContent = 'Place order';
    }
  });

  againBtn?.addEventListener('click', () => {
    confirmation.hidden = true;
    form.hidden = false;
    form.reset();
    populateStates(countrySelect?.value || 'US');
    renderBag();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  ready.finally(() => {
    loadShipping();
    renderBag();
  });
})();
