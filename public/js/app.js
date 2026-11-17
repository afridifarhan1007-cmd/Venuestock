/* VELUNE storefront — shared behaviour */
(() => {
  'use strict';

  const CART_KEY = 'velune.cart.v1';
  const CUSTOMER_TOKEN_KEY = 'velune.customer.token';
  let FREE_SHIPPING = 150;

  function customerToken() {
    try {
      return localStorage.getItem(CUSTOMER_TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  function setCustomerToken(token) {
    try {
      if (token) localStorage.setItem(CUSTOMER_TOKEN_KEY, token);
      else localStorage.removeItem(CUSTOMER_TOKEN_KEY);
    } catch {
      /* Storage can be unavailable in private modes. */
    }
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = {
    products: [],
    categories: [],
    catalogError: null,
    selected: {}
  };

  // ------------------------------------------------------------ currency
  // Every price the API returns is a USD number. INR is derived at display time
  // from the rate the server publishes (/api/currency), so the catalogue, the
  // bag, checkout and the order page always agree on the same underlying value.
  const currency = {
    active: 'USD',
    base: 'USD',
    inrPerUsd: 0,
    symbols: { USD: '', INR: '' },
    options: []
  };

  const groupers = {
    USD: {
      whole: new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
      cents: new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    },
    INR: {
      whole: new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
      cents: new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
  };

  const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

  const currencyNames = (() => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'currency' });
    } catch {
      return null;
    }
  })();

  function symbolFor(code) {
    if (currency.symbols[code]) return currency.symbols[code];
    try {
      const parts = new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency: code
      }).formatToParts(0);
      const found = parts.find((part) => part.type === 'currency');
      if (found && found.value) return found.value;
    } catch {
      /* A runtime without the currency data falls back to the ISO code. */
    }
    return code;
  }

  const currencyName = (code) => currencyNames?.of(code) || code;

  // Rupee display only works once the live rate is known; until then everything
  // stays in the stored base currency rather than showing a converted zero.
  const displayCode = (code) => (code === 'INR' && currency.inrPerUsd > 0 ? 'INR' : 'USD');
  const otherCode = () => (currency.active === 'INR' ? 'USD' : 'INR');

  // Numeric value of a stored USD amount in `code` — used for comparisons and
  // for bucket thresholds, never for display on its own.
  function amountIn(usd, code = currency.active) {
    const value = Number(usd) || 0;
    return displayCode(code) === 'INR' ? round2(value * currency.inrPerUsd) : value;
  }

  const money = (usd, code = currency.active) => {
    const iso = displayCode(code);
    const value = amountIn(usd, iso);
    const table = groupers[iso];
    return `${symbolFor(iso)}${(Number.isInteger(value) ? table.whole : table.cents).format(value)}`;
  };

  const moneyOther = (usd) => money(usd, otherCode());

  function refreshPrices(root = document) {
    $$('[data-price-usd]', root).forEach((node) => {
      const usd = Number(node.dataset.priceUsd) || 0;
      const compare = Number(node.dataset.compareUsd) || 0;
      if (compare > usd) {
        const save = usd > 0 ? Math.round((1 - usd / compare) * 100) : 0;
        node.innerHTML = `${money(usd)} <s>${money(compare)}</s>${
          node.dataset.priceSave ? ` <span class="save">Save ${save}%</span>` : ''
        }`;
        return;
      }
      node.textContent = money(usd);
    });
  }

  const currencySwitch = $('[data-currency-switch]');
  const currencyButtons = $$('[data-currency-code]');
  let currencyRequest = 0;

  function renderCurrencyControl() {
    currencyButtons.forEach((button) => {
      const code = button.dataset.currencyCode;
      const name = currencyName(code);
      button.textContent = symbolFor(code);
      button.setAttribute('aria-label', `Show prices in ${name}`);
      button.title = `Show prices in ${name}`;
      button.classList.toggle('is-active', code === currency.active);
      button.setAttribute('aria-pressed', String(code === currency.active));
    });
  }

  function applyCurrency(payload = {}, options = {}) {
    const data = payload.currency ? { ...payload.currency, ...payload } : payload;
    const rate = Number(data.inrPerUsd) || 0;
    if (rate > 0) currency.inrPerUsd = rate;
    currency.base = data.base === 'INR' ? 'INR' : 'USD';
    if (data.symbols && typeof data.symbols === 'object') {
      currency.symbols.USD = data.symbols.USD || '';
      currency.symbols.INR = data.symbols.INR || '';
    }
    if (Array.isArray(data.options)) currency.options = data.options;
    if (data.active === 'INR' || data.active === 'USD') {
      currency.active = data.active === 'INR' && currency.inrPerUsd > 0 ? 'INR' : 'USD';
    }
    renderCurrencyControl();
    refreshPrices();
    renderCart();
    if (searchInput && searchInput.value) renderSearch(searchInput.value);
    document.dispatchEvent(
      new CustomEvent('velune:currencychange', {
        detail: { active: currency.active, inrPerUsd: currency.inrPerUsd }
      })
    );
    if (options.announce && data.message) toast(data.message);
    return currency;
  }

  async function setCurrency(code) {
    const chosen = String(code || '').toUpperCase();
    if (chosen !== 'USD' && chosen !== 'INR') return currency;
    if (chosen === currency.active) return currency;
    const token = ++currencyRequest;
    currencyButtons.forEach((button) => {
      button.disabled = true;
    });
    try {
      const data = await api('/api/currency', { method: 'POST', json: { code: chosen } });
      if (token !== currencyRequest) return currency;
      applyCurrency(data, { announce: true });
    } catch (error) {
      if (token === currencyRequest) toast(error.message, { error: true });
      if (token === currencyRequest) renderCurrencyControl();
    } finally {
      if (token === currencyRequest) {
        currencyButtons.forEach((button) => {
          button.disabled = false;
        });
      }
    }
    return currency;
  }

  currencyButtons.forEach((button) =>
    button.addEventListener('click', () => setCurrency(button.dataset.currencyCode))
  );

  // Server-rendered pages (product details) already print the visitor's chosen
  // currency from the cookie; start from the same answer so the client never
  // repaints against the server.
  if (currencySwitch) {
    const bootRate = Number(currencySwitch.dataset.currencyRate) || 0;
    if (bootRate > 0) currency.inrPerUsd = bootRate;
    currency.active =
      currencySwitch.dataset.currencyActive === 'INR' && currency.inrPerUsd > 0 ? 'INR' : 'USD';
  }
  renderCurrencyControl();

  const currencyReady = api('/api/currency')
    .then((data) => applyCurrency(data))
    .catch(() => currency);

  // ------------------------------------------------------------ shipping
  // Read once and shared by the bag meter and the checkout form, so the
  // complimentary-shipping threshold is the server's, not a client guess.
  const shipping = { methods: null, freeThreshold: FREE_SHIPPING, countries: [], states: [] };
  let shippingPromise = null;

  function getShipping(force = false) {
    if (!shippingPromise || force) {
      shippingPromise = api('/api/shipping')
        .then((data) => {
          if (data && data.methods) shipping.methods = data.methods;
          const threshold = Number(data && data.freeThreshold);
          if (threshold > 0) {
            shipping.freeThreshold = threshold;
            FREE_SHIPPING = threshold;
            renderCart();
          }
          if (Array.isArray(data && data.countries)) shipping.countries = data.countries;
          if (Array.isArray(data && data.states)) shipping.states = data.states;
          return data;
        })
        .catch(() => null);
    }
    return shippingPromise;
  }

  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => entities[char]);

  // Product imagery is photography only. Legacy vector packshots are never
  // rendered, even if an older order or cache still carries their path.
  const PHOTO_FILE = /\.(?:jpe?g|png|webp|avif)$/i;
  const isPhotoUrl = (value) => PHOTO_FILE.test(String(value || '').split('?')[0].split('#')[0]);

  function mediaThumb(image, { className = '', alt = '', width = 48, height = 60, loading = 'lazy' } = {}) {
    const classes = `media-missing${className ? ` ${className}` : ''}`;
    if (!isPhotoUrl(image)) {
      return `<span class="${classes}" role="img" aria-label="Photo coming soon"></span>`;
    }
    return `<img${className ? ` class="${className}"` : ''} src="${esc(image)}" alt="${esc(alt)}" width="${width}" height="${height}" loading="${loading}" decoding="async">`;
  }

  const stars = (rating = 5, className = '') => {
    const full = Math.round(Number(rating) || 0);
    let output = `<span class="rating__stars ${className}" aria-hidden="true">`;
    for (let index = 0; index < 5; index += 1) {
      output += `<svg viewBox="0 0 20 20" fill="${index < full ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.2"><path d="m10 2.6 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 7.9l5-.7L10 2.6Z"/></svg>`;
    }
    return `${output}</span>`;
  };

  const toastStack = $('[data-toast-stack]');
  function toast(message, options = {}) {
    if (!toastStack) return;
    const node = document.createElement('div');
    node.className = `toast${options.error ? ' toast--error' : ''}`;
    node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg><span class="toast__text"></span>`;
    $('.toast__text', node).textContent = message;
    if (options.action?.label && typeof options.action.onClick === 'function') {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'toast__action';
      action.textContent = options.action.label;
      action.addEventListener('click', () => {
        options.action.onClick();
        node.remove();
      });
      node.appendChild(action);
    }
    toastStack.appendChild(node);
    requestAnimationFrame(() => node.classList.add('is-visible'));
    setTimeout(() => {
      node.classList.remove('is-visible');
      setTimeout(() => node.remove(), 300);
    }, options.duration || 3600);
  }

  async function api(path, options = {}) {
    const config = { ...options, headers: { ...(options.headers || {}) } };
    const sessionToken = customerToken();
    if (sessionToken) config.headers['x-velune-customer'] = sessionToken;
    if (options.json !== undefined) {
      config.body = JSON.stringify(options.json);
      config.headers['Content-Type'] = 'application/json';
      delete config.json;
    }
    const response = await fetch(path, config);
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) {
      const error = new Error(data.error || 'Something went wrong. Please try again.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function getCatalog(force = false) {
    if (!catalogPromise || force) {
      catalogPromise = api('/api/products')
        .then((data) => {
          state.products = data.products || [];
          state.categories = data.categories || [];
          state.catalogError = null;
          return data;
        })
        .catch((error) => {
          catalogPromise = null; // a failed request must never be cached for the visit
          state.catalogError = error;
          throw error;
        });
    }
    return catalogPromise;
  }
  let catalogPromise = null;
  // One dropped request (cold start, flaky network) must not leave every grid
  // empty, so retry once before showing the collection error.
  const ready = getCatalog()
    .catch(() => new Promise((resolve) => setTimeout(resolve, 1200)))
    .then((data) => data || getCatalog(true))
    .catch((error) => {
      state.catalogError = error;
      toast('We could not load the collection. Please refresh.', { error: true });
      return null;
    });

  // ---------------------------------------------------------------- cart

  function loadCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item.slug === 'string' && Number.isInteger(item.qty))
        .map((item) => ({
          slug: item.slug,
          qty: Math.min(10, Math.max(1, item.qty)),
          variant: typeof item.variant === 'string' ? item.variant : ''
        }));
    } catch {
      return [];
    }
  }

  const cart = {
    items: loadCart(),

    save() {
      try {
        localStorage.setItem(CART_KEY, JSON.stringify(this.items));
      } catch {
        /* Storage can be unavailable in private modes; the cart stays in memory. */
      }
      renderCart();
    },

    detailed() {
      return this.items
        .map((item, index) => {
          const product = state.products.find((entry) => entry.slug === item.slug);
          if (!product) return null;
          return {
            ...item,
            index,
            product,
            lineTotal: Math.round(product.price * item.qty * 100) / 100
          };
        })
        .filter(Boolean);
    },

    count() {
      return this.items.reduce((sum, item) => sum + item.qty, 0);
    },

    subtotal() {
      return Math.round(
        this.items.reduce((sum, item) => {
          const product = state.products.find((entry) => entry.slug === item.slug);
          return product ? sum + product.price * item.qty : sum;
        }, 0) * 100
      ) / 100;
    },

    add(slug, qty = 1, variant = null) {
      const product = state.products.find((entry) => entry.slug === slug);
      if (!product) return { ok: false, message: 'This piece is no longer available.' };
      if (product.stock < 1) return { ok: false, message: 'This piece is currently sold out.' };
      const chosen = variant || product.variants?.[0]?.options?.[0] || '';
      const existing = this.items.find((item) => item.slug === slug && item.variant === chosen);
      const currentQty = existing ? existing.qty : 0;
      const nextQty = Math.min(currentQty + qty, 10, product.stock);
      if (nextQty <= currentQty) {
        return { ok: false, message: `Only ${product.stock} available.` };
      }
      if (existing) existing.qty = nextQty;
      else this.items.push({ slug, qty: nextQty, variant: chosen });
      this.save();
      return { ok: true, message: `${product.name} added to your bag.` };
    },

    setQty(index, quantity) {
      const item = this.items[index];
      if (!item) return;
      const product = state.products.find((entry) => entry.slug === item.slug);
      const max = Math.min(10, product?.stock || 10);
      const next = Math.min(max, Math.max(1, quantity));
      if (next < 1) return;
      if (quantity > max) toast(`Only ${max} available.`, { error: true });
      item.qty = next;
      this.save();
    },

    changeQty(index, delta) {
      const item = this.items[index];
      if (!item) return;
      this.setQty(index, item.qty + delta);
    },

    remove(index) {
      this.items.splice(index, 1);
      this.save();
    },

    clear() {
      this.items = [];
      this.save();
    }
  };

  const cartDrawer = $('[data-cart-drawer]');
  const cartLines = $('[data-cart-lines]');
  const cartEmpty = $('[data-cart-empty]');
  const cartFoot = $('[data-cart-foot]');

  function renderCart() {
    const count = cart.count();
    $$('[data-cart-count]').forEach((node) => {
      node.textContent = count > 99 ? '99+' : String(count);
      node.classList.toggle('has-items', count > 0);
    });
    const titleCount = $('[data-cart-title-count]');
    if (titleCount) titleCount.textContent = count ? `(${count})` : '';
    if (!cartLines) return;

    const lines = cart.detailed();
    const hasItems = lines.length > 0 && state.products.length > 0;
    if (cartEmpty) cartEmpty.hidden = hasItems;
    if (cartFoot) cartFoot.hidden = !hasItems;
    cartLines.hidden = !hasItems;

    if (!hasItems) {
      cartLines.innerHTML = '';
      return;
    }

    cartLines.innerHTML = lines
      .map(({ product, qty, variant, lineTotal, index }) => {
        const options = [variant].filter(Boolean).join(' · ');
        return `
          <div class="cart-line">
            <a href="/product/${esc(product.slug)}">${mediaThumb(product.cardImage, { className: 'cart-thumb', alt: product.name, width: 78, height: 98 })}</a>
            <div class="cart-line__body">
              <div class="cart-line__top">
                <a class="cart-line__name" href="/product/${esc(product.slug)}">${esc(product.name)}</a>
                <span class="cart-line__price" data-price-usd="${lineTotal}">${money(lineTotal)}</span>
              </div>
              ${options ? `<span class="cart-line__variant">${esc(options)}</span>` : ''}
              <div class="cart-line__foot">
                <div class="qty-control" aria-label="Quantity">
                  <button type="button" data-cart-minus="${index}" aria-label="Decrease quantity" ${qty <= 1 ? 'disabled' : ''}>−</button>
                  <span>${qty}</span>
                  <button type="button" data-cart-plus="${index}" aria-label="Increase quantity" ${qty >= Math.min(10, product.stock) ? 'disabled' : ''}>+</button>
                </div>
                <button class="cart-remove" type="button" data-cart-remove="${index}">Remove</button>
              </div>
            </div>
          </div>`;
      })
      .join('');

    const subtotal = cart.subtotal();
    const subtotalNode = $('[data-cart-subtotal]');
    if (subtotalNode) subtotalNode.textContent = money(subtotal);
    const remaining = Math.max(0, FREE_SHIPPING - subtotal);
    const copy = $('[data-ship-copy]');
    if (copy) {
      copy.textContent = remaining > 0
        ? `${money(remaining)} away from complimentary shipping.`
        : 'Complimentary shipping unlocked.';
    }
    const bar = $('[data-ship-bar]');
    if (bar) bar.style.width = `${Math.min(100, (subtotal / FREE_SHIPPING) * 100)}%`;
    document.dispatchEvent(new CustomEvent('velune:cartchange'));
  }

  if (cartLines) {
    cartLines.addEventListener('click', (event) => {
      const plus = event.target.closest('[data-cart-plus]');
      const minus = event.target.closest('[data-cart-minus]');
      const remove = event.target.closest('[data-cart-remove]');
      if (plus) cart.changeQty(Number(plus.dataset.cartPlus), 1);
      if (minus) cart.changeQty(Number(minus.dataset.cartMinus), -1);
      if (remove) cart.remove(Number(remove.dataset.cartRemove));
    });
  }

  // ---------------------------------------------------------------- overlays

  const scrim = $('[data-scrim]');
  const searchPanel = $('[data-search-panel]');
  const mobileNav = $('#mobile-nav');
  const navToggle = $('[data-nav-toggle]');
  let lastFocus = null;
  let overlayState = { cart: false, search: false, nav: false };

  const setInert = (node, value) => {
    if (!node) return;
    if (value) node.setAttribute('inert', '');
    else node.removeAttribute('inert');
  };

  function syncScrim() {
    const anyModal = overlayState.cart || overlayState.search;
    if (scrim) scrim.classList.toggle('is-open', anyModal);
    document.body.classList.toggle('locked', overlayState.cart || overlayState.search || overlayState.nav);
  }

  function closeSearch(restoreFocus = true) {
    overlayState.search = false;
    if (searchPanel) {
      searchPanel.classList.remove('is-open');
      searchPanel.setAttribute('aria-hidden', 'true');
      setInert(searchPanel, true);
    }
    syncScrim();
    if (restoreFocus && lastFocus) lastFocus.focus?.();
  }

  function openSearch() {
    if (!searchPanel) return;
    closeCart(false);
    closeNav();
    lastFocus = document.activeElement;
    overlayState.search = true;
    searchPanel.classList.add('is-open');
    searchPanel.setAttribute('aria-hidden', 'false');
    setInert(searchPanel, false);
    syncScrim();
    const input = $('[data-search-input]');
    setTimeout(() => input?.focus(), 120);
  }

  function closeCart(restoreFocus = true) {
    overlayState.cart = false;
    if (cartDrawer) {
      cartDrawer.classList.remove('is-open');
      cartDrawer.setAttribute('aria-hidden', 'true');
      setInert(cartDrawer, true);
    }
    syncScrim();
    if (restoreFocus && lastFocus) lastFocus.focus?.();
  }

  function openCart() {
    if (!cartDrawer) return;
    closeSearch(false);
    closeNav();
    lastFocus = document.activeElement;
    overlayState.cart = true;
    renderCart();
    cartDrawer.classList.add('is-open');
    cartDrawer.setAttribute('aria-hidden', 'false');
    setInert(cartDrawer, false);
    syncScrim();
    setTimeout(() => $('[data-cart-close]')?.focus(), 120);
  }

  function closeNav() {
    overlayState.nav = false;
    if (mobileNav) {
      mobileNav.classList.remove('is-open');
      mobileNav.setAttribute('aria-hidden', 'true');
    }
    navToggle?.setAttribute('aria-expanded', 'false');
    syncScrim();
  }

  function openNav() {
    closeSearch(false);
    closeCart(false);
    overlayState.nav = true;
    mobileNav?.classList.add('is-open');
    mobileNav?.setAttribute('aria-hidden', 'false');
    navToggle?.setAttribute('aria-expanded', 'true');
    syncScrim();
  }

  $$('[data-cart-open]').forEach((button) => button.addEventListener('click', openCart));
  $$('[data-cart-close]').forEach((button) => button.addEventListener('click', () => closeCart()));
  $$('[data-search-open]').forEach((button) => button.addEventListener('click', openSearch));
  $$('[data-search-close]').forEach((button) => button.addEventListener('click', () => closeSearch()));
  navToggle?.addEventListener('click', () => (overlayState.nav ? closeNav() : openNav()));
  scrim?.addEventListener('click', () => {
    if (overlayState.cart) closeCart();
    if (overlayState.search) closeSearch();
  });
  $$('[data-cart-shop]').forEach((link) => link.addEventListener('click', () => closeCart(false)));
  $$('#mobile-nav a').forEach((link) => link.addEventListener('click', () => closeNav()));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (overlayState.cart) closeCart();
    else if (overlayState.search) closeSearch();
    else if (overlayState.nav) closeNav();
  });
  document.addEventListener('click', (event) => {
    if (!overlayState.nav) return;
    if ($('.site-header')?.contains(event.target) || mobileNav?.contains(event.target)) return;
    closeNav();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 920 && overlayState.nav) closeNav();
  });

  // The header only earns its shadow once the page has moved, so the top of the
  // homepage stays a flat, quiet plane.
  const siteHeader = $('.site-header');
  if (siteHeader) {
    const onScroll = () => siteHeader.classList.toggle('is-scrolled', window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  setInert(cartDrawer, true);
  setInert(searchPanel, true);

  // ---------------------------------------------------------------- search

  const searchInput = $('[data-search-input]');
  const searchResults = $('[data-search-results]');
  let searchToken = 0;

  function renderSearch(query) {
    if (!searchResults) return;
    const term = query.trim().toLowerCase();
    if (!term) {
      searchResults.innerHTML = '<p class="search-empty">Begin typing to search the collection.</p>';
      return;
    }
    if (state.catalogError) {
      searchResults.innerHTML = '<p class="search-empty">The collection could not be loaded. Refresh to try again.</p>';
      return;
    }
    if (!state.products.length) {
      searchResults.innerHTML = '<p class="search-empty">Loading…</p>';
      return;
    }
    const matches = state.products
      .filter((product) => {
        const haystack = `${product.name} ${product.categoryName} ${product.short} ${product.description}`.toLowerCase();
        return haystack.includes(term);
      })
      .slice(0, 6);
    if (!matches.length) {
      searchResults.innerHTML = `<p class="search-empty">No products match “${esc(query.trim())}”. Try “serum”, “foundation” or “perfume”.</p>`;
      return;
    }
    searchResults.innerHTML = matches
      .map(
        (product) => `
        <a class="search-result" href="/product/${esc(product.slug)}">
          ${mediaThumb(product.cardImage, { alt: product.name, width: 48, height: 60 })}
          <span class="search-result__text">
            <span class="search-result__name">${esc(product.name)}</span>
            <span class="search-result__meta">${esc(product.categoryName)}</span>
          </span>
          <span class="search-result__price" data-price-usd="${Number(product.price) || 0}">${money(product.price)}</span>
        </a>`
      )
      .join('');
  }

  searchInput?.addEventListener('input', async () => {
    const term = searchInput.value;
    const token = ++searchToken;
    await ready;
    if (token !== searchToken) return;
    renderSearch(term);
  });

  $('[data-search-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const term = searchInput?.value.trim();
    if (!term) return;
    closeSearch(false);
    window.location.href = `/shop?q=${encodeURIComponent(term)}`;
  });

  // ---------------------------------------------------------------- product cards

  function productCard(product) {
    const soldOut = product.stock < 1;
    const sale = product.compareAt && product.compareAt > product.price;
    const badge = soldOut ? 'Sold out' : product.badge;
    const price = Number(product.price) || 0;
    const compareAt = sale ? Number(product.compareAt) || 0 : 0;
    const photo = isPhotoUrl(product.cardImage) ? product.cardImage : '';
    const size = (product.specs || []).find((spec) => /^size$/i.test(spec.k))?.v || '';
    const variants = (product.variants || [])
      .map((group) => {
        const shown = (group.options || []).slice(0, 3).join(', ');
        const extra = (group.options || []).length - 3;
        return shown ? `${group.name}: ${shown}${extra > 0 ? ` +${extra}` : ''}` : '';
      })
      .filter(Boolean)
      .join(' · ');
    const meta = [size, variants].filter(Boolean).join(' · ');
    return `
      <article class="product-card" data-product-card="${esc(product.slug)}">
        <div class="product-media-wrap">
          <a class="product-media${photo ? '' : ' product-media--pending'}" href="/product/${esc(product.slug)}" aria-label="View ${esc(product.name)}">
            ${photo
              ? `<img src="${esc(photo)}"
                 srcset="${esc(photo)} 400w, ${esc(product.image || photo)} 800w"
                 sizes="(min-width: 1081px) 22vw, (min-width: 921px) 30vw, 46vw"
                 alt="${esc(product.name)}" width="400" height="500" loading="lazy" decoding="async">`
              : `<span class="photo-pending"><span class="photo-pending__eyebrow">Studio photography</span><strong>Photo coming soon</strong></span>`}
            ${badge ? `<span class="product-badge${soldOut ? ' product-badge--sold' : ''}">${esc(badge)}</span>` : ''}
          </a>
        </div>
        <div class="product-info">
          <a class="product-name" href="/product/${esc(product.slug)}">${esc(product.name)}</a>
          <div class="product-price" data-price-usd="${price}"${compareAt ? ` data-compare-usd="${compareAt}"` : ''}>${money(price)}${sale ? ` <s>${money(product.compareAt)}</s>` : ''}</div>
          ${meta ? `<div class="product-meta" title="${esc(meta)}">${esc(meta)}</div>` : ''}
          <button class="product-add" type="button" data-quick-add="${esc(product.slug)}" ${soldOut ? 'disabled' : ''}>${soldOut ? 'Sold out' : 'Add to cart'}</button>
        </div>
      </article>`;
  }

  function renderGrid(container, products) {
    if (!container) return;
    container.innerHTML = products.map(productCard).join('');
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-quick-add]');
    if (!button) return;
    event.preventDefault();
    const slug = button.dataset.quickAdd;
    const result = cart.add(slug, 1);
    toast(result.message, {
      error: !result.ok,
      action: result.ok ? { label: 'View bag', onClick: openCart } : undefined
    });
  });

  // ---------------------------------------------------------------- newsletter

  $$('[data-newsletter-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const wrap = form.closest('.newsletter-inner') || form.parentElement;
      const note = wrap?.querySelector('[data-newsletter-note]');
      const emailInput = form.querySelector('input[type="email"]');
      const honeypot = form.querySelector('input[name="website"]');
      const email = emailInput?.value.trim() || '';
      const button = form.querySelector('button[type="submit"]');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        if (note) {
          note.textContent = 'Please enter a valid email address.';
          note.className = 'newsletter-note is-error';
        }
        emailInput?.focus();
        return;
      }
      if (button) button.disabled = true;
      if (note) {
        note.textContent = 'Adding you to the list…';
        note.className = 'newsletter-note';
      }
      try {
        const data = await api('/api/newsletter', {
          method: 'POST',
          json: { email, website: honeypot?.value || '' }
        });
        if (note) {
          note.textContent = data.message || 'You are on the list.';
          note.className = 'newsletter-note is-success';
        }
        form.reset();
      } catch (error) {
        if (note) {
          note.textContent = error.message;
          note.className = 'newsletter-note is-error';
        }
      } finally {
        if (button) button.disabled = false;
      }
    });
  });


  // ---------------------------------------------------------------- navigation state

  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  $$('.primary-nav a').forEach((link) => {
    const nav = link.dataset.nav;
    let active = false;
    if (path === '/shop') {
      if (nav === 'shop' && !params.get('category')) active = true;
      if (params.get('category') && nav === params.get('category')) active = true;
    }
    if (active) {
      link.classList.add('is-active');
      link.setAttribute('aria-current', 'page');
    }
  });

  // ---------------------------------------------------------------- ready

  ready.then(() => {
    renderCart();
    if (searchInput?.value) renderSearch(searchInput.value);
  });

  getShipping();

  api('/api/auth/session')
    .then((data) => {
      const dot = $('[data-account-dot]');
      if (dot) dot.hidden = !data.customer;
    })
    .catch(() => {});

  renderCart();
  window.addEventListener('storage', (event) => {
    if (event.key !== CART_KEY) return;
    cart.items = loadCart();
    renderCart();
  });

  const REVEAL_SELECTOR =
    '.section-head__copy, .editorial-copy, .editorial-media, .materials-content, .category-rail, .values-grid, .testimonials, .newsletter-inner';

  function initReveal() {
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets = $$(REVEAL_SELECTOR);
    if (!targets.length) return;
    document.documentElement.classList.add('reveal-ready');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    for (const node of targets) observer.observe(node);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReveal, { once: true });
  } else {
    initReveal();
  }

  window.VELUNE = {
    amountIn,
    api,
    cart,
    currency,
    currencyReady,
    esc,
    getCatalog,
    getShipping,
    isPhotoUrl,
    mediaThumb,
    money,
    moneyOther,
    openCart,
    otherCode,
    productCard,
    ready,
    refreshPrices,
    renderGrid,
    setCurrency,
    setCustomerToken,
    shipping,
    stars,
    state,
    symbolFor,
    toast,
    $,
    $$
  };
})();
