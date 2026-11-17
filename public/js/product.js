/* VELUNE — product detail page */
(() => {
  'use strict';

  const {
    $,
    $$,
    api,
    cart,
    esc,
    getShipping,
    money,
    moneyOther,
    openCart,
    ready,
    renderGrid,
    stars,
    state,
    toast
  } = window.VELUNE;

  const slug = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');
  const addButton = $('[data-add-to-cart]');
  const stickyAdd = $('[data-sticky-add]');
  const stickyBar = $('[data-sticky-buy]');
  const qtyNode = $('[data-pdp-qty]');
  const ratingNode = $('[data-pdp-rating]');
  const priceNode = $('[data-pdp-price]');
  const altPriceNode = $('[data-pdp-price-alt]');
  const stockNode = $('[data-pdp-stock]');
  const relatedGrid = $('[data-related-grid]');
  const relatedLink = $('[data-related-link]');
  const stickyPrice = $('[data-sticky-price]');
  const titleNode = $('[data-pdp-title]');
  const crumbNode = $('[data-pdp-crumb]');
  const stickyName = $('[data-sticky-name]');
  const categoryLink = $('[data-pdp-category-link]');
  const descNode = $('[data-pdp-desc]');
  const longDescNode = $('[data-pdp-long-desc]');
  const imageNode = $('[data-pdp-image]');
  const freeShipNode = $('[data-pdp-free-ship]');
  const shipCopyNode = $('[data-pdp-ship-copy]');
  const optionsHost = $('[data-pdp-options]');

  let product = null;
  let related = [];
  let qty = 1;
  let groups = [];

  const selectedVariant = () =>
    groups
      .map((group) => ({ name: group.name, value: group.value }))
      .filter((entry) => entry.value)
      .map((entry) => `${entry.name}: ${entry.value}`)
      .join(' · ');

  function setStockUI() {
    if (!product || !stockNode) return;
    const stock = product.stock;
    stockNode.classList.toggle('is-out', stock < 1);
    stockNode.classList.toggle('is-low', stock > 0 && stock <= 5);
    const text = stock < 1 ? 'Out of stock — check back soon' : stock <= 5 ? `Only ${stock} left` : 'In stock — ready to ship';
    stockNode.innerHTML = `<span class="dot"></span>${esc(text)}`;
    const max = Math.min(10, stock);
    if (stock > 0 && qty > max) qty = max;
    $$('.qty-control [data-pdp-plus]').forEach((button) => {
      button.disabled = stock < 1 || qty >= max;
    });
    $$('.qty-control [data-pdp-minus]').forEach((button) => {
      button.disabled = stock < 1 || qty <= 1;
    });
    [addButton, stickyAdd].forEach((button) => {
      if (!button) return;
      button.disabled = stock < 1;
      button.textContent = stock < 1 ? 'Sold out' : 'Add to bag';
    });
    if (qtyNode) qtyNode.textContent = String(qty);
  }

  // Selling price only: /api/products/:slug returns price, compareAt and their
  // currency equivalents — never the stored cost or margin.
  function renderPrice() {
    if (!product) return;
    const price = Number(product.price) || 0;
    const compareAt = Number(product.compareAt) || 0;
    const sale = compareAt > price;
    if (priceNode) {
      priceNode.dataset.priceUsd = String(price);
      if (sale) priceNode.dataset.compareUsd = String(compareAt);
      else delete priceNode.dataset.compareUsd;
      priceNode.dataset.priceSave = 'true';
      priceNode.innerHTML = `${money(price)}${
        sale ? ` <s>${money(compareAt)}</s> <span class="save">Save ${Math.round((1 - price / compareAt) * 100)}%</span>` : ''
      }`;
    }
    if (stickyPrice) {
      stickyPrice.dataset.priceUsd = String(price);
      stickyPrice.textContent = money(price);
    }
    if (altPriceNode) {
      const alternate = moneyOther(price);
      if (alternate === money(price)) {
        // Both currencies resolve to the same symbol — the rate is not loaded,
        // so there is nothing honest to show on the secondary line.
        altPriceNode.textContent = '';
        altPriceNode.hidden = true;
      } else {
        altPriceNode.textContent = `Or ${alternate} at today’s rate`;
        altPriceNode.hidden = false;
      }
    }
  }

  function renderIdentity() {
    if (!product) return;
    if (titleNode) titleNode.textContent = product.name;
    if (crumbNode) crumbNode.textContent = product.name;
    if (stickyName) stickyName.textContent = product.name;
    if (descNode) descNode.textContent = product.short || '';
    if (longDescNode) longDescNode.textContent = product.description || '';
    if (categoryLink) {
      categoryLink.textContent = product.categoryName || product.category;
      categoryLink.setAttribute('href', `/shop?category=${encodeURIComponent(product.category)}`);
    }
    if (document.title && !document.title.startsWith(product.name)) {
      document.title = `${product.name} — VELUNE`;
    }
  }

  async function renderShippingNotes() {
    const data = await getShipping();
    if (!data) return;
    const methods = data.methods || {};
    const threshold = Number(data.freeThreshold) || 0;
    if (freeShipNode) {
      freeShipNode.textContent =
        threshold > 0 ? `Complimentary shipping on orders over ${money(threshold)}` : 'Complimentary shipping on qualifying orders';
    }
    if (shipCopyNode) {
      const standard = methods.standard;
      const express = methods.express;
      const parts = [];
      if (standard) {
        parts.push(
          `Standard delivery is ${standard.eta || '3–5 business days'} at ${money(standard.price)}${
            threshold > 0 ? `, complimentary over ${money(threshold)}` : ''
          }`
        );
      }
      if (express) parts.push(`Express is ${express.eta || '1–2 business days'} at ${money(express.price)}`);
      if (!parts.length) return;
      shipCopyNode.textContent = `${parts.join('. ')}. We ship across India and the United States, and orders are processed within 1–2 business days.`;
    }
  }

  function renderVariantMarkup() {
    if (!optionsHost || !Array.isArray(product.variants) || !product.variants.length) return;
    if (optionsHost.querySelector('[data-variant-group]')) return; // already server-rendered
    optionsHost.innerHTML = product.variants
      .map(
        (variant) => `<div class="variant-group" data-variant-group data-variant-name="${esc(variant.name)}">
          <div class="variant-label">${esc(variant.name)}: <strong data-variant-value>${esc(variant.options?.[0] || '')}</strong></div>
          <div class="variant-options">
            ${(variant.options || [])
              .map(
                (option, index) =>
                  `<button type="button" class="variant-btn${index === 0 ? ' is-selected' : ''}" data-variant-option="${esc(option)}">${esc(option)}</button>`
              )
              .join('')}
          </div>
        </div>`
      )
      .join('');
  }

  function wireVariants() {
    groups = $$('[data-variant-group]').map((group) => {
      const name = group.dataset.variantName;
      const buttons = $$('.variant-btn', group);
      const selected = buttons.find((button) => button.classList.contains('is-selected')) || buttons[0];
      const valueNode = $('[data-variant-value]', group);
      return { name, buttons, valueNode, get value() { return this.buttons.find((button) => button.classList.contains('is-selected'))?.dataset.variantOption || selected?.dataset.variantOption || ''; } };
    });

    $$('[data-variant-group]').forEach((group) => {
      group.addEventListener('click', (event) => {
        const button = event.target.closest('.variant-btn');
        if (!button) return;
        $$('.variant-btn', group).forEach((entry) => {
          entry.classList.toggle('is-selected', entry === button);
          entry.setAttribute('aria-pressed', String(entry === button));
        });
        const valueNode = $('[data-variant-value]', group);
        if (valueNode) valueNode.textContent = button.dataset.variantOption || '';
      });
    });

    $$('.variant-btn').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.classList.contains('is-selected')));
    });
  }

  function relatedFallback() {
    const pool = state.products.filter((entry) => entry.slug !== product.slug);
    const same = pool.filter((entry) => entry.category === product.category);
    const others = pool.filter((entry) => entry.category !== product.category);
    return [...same, ...others].slice(0, 4);
  }

  function renderRelated(related) {
    if (!relatedGrid) return;
    const items = (related && related.length >= 4 ? related.slice(0, 4) : relatedFallback()).filter(
      (entry) => entry.slug !== product.slug
    );
    renderGrid(relatedGrid, items.slice(0, 4));
  }

  function addToBag() {
    if (!product) return;
    const result = cart.add(product.slug, qty, selectedVariant());
    if (!result.ok) {
      toast(result.message, { error: true });
      return;
    }
    openCart();
  }

  function initSticky() {
    if (!stickyBar || !stickyAdd || !addButton) return;
    stickyAdd.addEventListener('click', addToBag);
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const visible = !entry.isIntersecting && window.scrollY > 320;
        stickyBar.classList.toggle('is-visible', visible);
        document.body.classList.toggle('has-sticky-buy', visible);
      },
      { rootMargin: '0px 0px -40px 0px', threshold: 0 }
    );
    observer.observe(addButton);
  }

  function wireQuantity() {
    $('[data-pdp-minus]')?.addEventListener('click', () => {
      if (!product) return;
      qty = Math.max(1, qty - 1);
      setStockUI();
    });
    $('[data-pdp-plus]')?.addEventListener('click', () => {
      if (!product) return;
      const max = Math.min(10, product.stock);
      if (qty >= max) {
        toast(`Only ${max} available.`, { error: true });
        return;
      }
      qty += 1;
      setStockUI();
    });
  }

  async function load() {
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      window.location.replace('/404');
      return;
    }
    try {
      const data = await api(`/api/products/${slug}`);
      product = data.product;
      related = data.related || [];
    } catch (error) {
      if (error.status === 404) {
        window.location.replace('/404');
        return;
      }
      product = state.products.find((entry) => entry.slug === slug) || null;
    }

    if (!product) {
      if (addButton) {
        addButton.disabled = true;
        addButton.textContent = 'Unavailable';
      }
      if (stockNode) stockNode.innerHTML = '<span class="dot"></span>This piece could not be loaded. Please refresh.';
      toast('We could not load this piece. Please refresh.', { error: true });
      return;
    }

    if (ratingNode) {
      ratingNode.innerHTML = `${stars(product.rating)}<span class="rating__text">${Number(product.rating).toFixed(1)} · ${product.reviewCount} reviews</span>`;
    }
    renderIdentity();
    renderPrice();
    renderShippingNotes();

    if (imageNode && product.image && /\.(jpe?g|png|webp|avif)$/i.test(String(product.image).split('?')[0])) {
      imageNode.alt = product.name;
      imageNode.src = product.image;
      imageNode.srcset = `${product.cardImage} 400w, ${product.image} 800w`;
      imageNode.setAttribute('data-fallback-src', '');
      delete imageNode.dataset.fallbackStage;
    }

    renderVariantMarkup();
    wireVariants();
    wireQuantity();
    setStockUI();
    addButton?.addEventListener('click', addToBag);
    initSticky();

    if (relatedLink) {
      relatedLink.setAttribute('href', `/shop?category=${encodeURIComponent(product.category)}`);
      relatedLink.innerHTML = `More in ${esc(product.categoryName || product.category)}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>`;
    }
    renderRelated(related);

    if (product.stock < 1) {
      toast('This piece is currently sold out.', { error: true });
    }
  }

  // Currency switch: repaint the price pair, the sticky bar, the delivery notes
  // and the related cards in place — the page never reloads.
  document.addEventListener('velune:currencychange', () => {
    renderPrice();
    renderShippingNotes();
    if (product) renderRelated(related);
  });

  (async () => {
    await ready;
    await load();
  })();
})();
