/* Shop — filters, sorting and URL state */
(() => {
  'use strict';
  const { ready, state, renderGrid, $, $$, money, amountIn } = window.VELUNE;

  const grid = $('[data-shop-grid]');
  const countNode = $('[data-shop-count]');
  const clearButton = $('[data-clear-filters]');
  const categoryButtons = $$('[data-category]');
  const sortSelect = $('[data-sort]');
  const priceSelect = $('[data-price-filter]');

  const validCategories = new Set(['all', ...categoryButtons.map((button) => button.dataset.category)]);
  const validSorts = new Set(['featured', 'newest', 'price-asc', 'price-desc', 'rating']);

  // Four bands that actually split this catalogue: the house cosmetics line sits
  // just above $52, the legacy pieces climb through $55–$200 and a handful of
  // high-jewellery prices sit above that. Thresholds are stored in USD (the unit
  // every API price is written in) and converted with the live rate, so an INR
  // shopper filters against the same numbers the labels describe.
  const PRICE_BANDS = [
    { key: 'under-55', min: 0, max: 55, label: 'under' },
    { key: '55-100', min: 55, max: 100, label: 'range' },
    { key: '100-200', min: 100, max: 200, label: 'range' },
    { key: '200-plus', min: 200, max: 0, label: 'plus' }
  ];
  const validPrices = new Set(['all', ...PRICE_BANDS.map((band) => band.key)]);
  const bandFor = (key) => PRICE_BANDS.find((band) => band.key === key) || null;

  const filters = { category: 'all', sort: 'featured', price: 'all', q: '' };

  // Both sides of the comparison are converted, so the bucket boundaries move
  // with the display currency instead of pairing a ₹ label with a USD number.
  const priceMatches = (price) => {
    const band = bandFor(filters.price);
    if (!band) return true;
    const value = amountIn(price);
    if (band.label === 'under') return value < amountIn(band.max);
    if (band.label === 'plus') return value >= amountIn(band.min);
    return value >= amountIn(band.min) && value < amountIn(band.max);
  };

  const bandLabel = (band) => {
    if (band.label === 'under') return `Under ${money(band.max)}`;
    if (band.label === 'plus') return `${money(band.min)} & above`;
    return `${money(band.min)} – ${money(band.max)}`;
  };

  function relabelPriceOptions() {
    if (!priceSelect) return;
    Array.from(priceSelect.options).forEach((option) => {
      if (option.value === 'all') {
        option.textContent = 'All prices';
        return;
      }
      const band = bandFor(option.value);
      if (band) option.textContent = bandLabel(band);
    });
  }

  const sorters = {
    featured: null,
    newest: (a, b) => Number(b.isNew) - Number(a.isNew) || b.rating - a.rating,
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
    rating: (a, b) => b.rating - a.rating
  };

  function readUrl() {
    const params = new URLSearchParams(location.search);
    const category = params.get('category') || 'all';
    const sort = params.get('sort') || 'featured';
    const price = params.get('price') || 'all';
    filters.category = validCategories.has(category) ? category : 'all';
    filters.sort = validSorts.has(sort) ? sort : 'featured';
    filters.price = validPrices.has(price) ? price : 'all';
    filters.q = (params.get('q') || '').trim().slice(0, 80);
  }

  function writeUrl() {
    const params = new URLSearchParams();
    if (filters.category !== 'all') params.set('category', filters.category);
    if (filters.sort !== 'featured') params.set('sort', filters.sort);
    if (filters.price !== 'all') params.set('price', filters.price);
    if (filters.q) params.set('q', filters.q);
    const query = params.toString();
    history.replaceState({}, '', `/shop${query ? `?${query}` : ''}`);
  }

  function syncControls() {
    categoryButtons.forEach((button) => {
      const active = button.dataset.category === filters.category;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (sortSelect) sortSelect.value = filters.sort;
    if (priceSelect) priceSelect.value = filters.price;
    const filtered = filters.category !== 'all' || filters.price !== 'all' || filters.q;
    clearButton?.classList.toggle('hidden', !filtered && filters.sort === 'featured');
  }

  function applyFilters() {
    const term = filters.q.toLowerCase();
    let products = state.products.filter((product) => {
      if (filters.category !== 'all' && product.category !== filters.category) return false;
      if (!priceMatches(product.price)) return false;
      if (term) {
        const haystack = `${product.name} ${product.categoryName} ${product.short} ${product.description}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
    if (sorters[filters.sort]) products = products.slice().sort(sorters[filters.sort]);

    if (!grid) return;
    if (!products.length) {
      grid.innerHTML = `<div class="empty-state">
        <h2>Nothing here, yet.</h2>
        <p>No products match this combination. Try a wider price range or another category.</p>
        <button type="button" class="btn btn--outline" data-empty-clear>Clear filters</button>
      </div>`;
      $('[data-empty-clear]')?.addEventListener('click', clearFilters);
    } else {
      renderGrid(grid, products);
    }

    if (countNode) {
      const label = filters.q
        ? `${products.length} ${products.length === 1 ? 'product' : 'products'} for “${filters.q}”`
        : `${products.length} ${products.length === 1 ? 'product' : 'products'}`;
      countNode.textContent = label;
    }
    syncControls();
  }

  function fillCounts() {
    const counts = { all: state.products.length };
    for (const product of state.products) counts[product.category] = (counts[product.category] || 0) + 1;
    $$('[data-count]').forEach((node) => {
      node.textContent = String(counts[node.dataset.count] || 0);
    });
  }

  function clearFilters() {
    filters.category = 'all';
    filters.sort = 'featured';
    filters.price = 'all';
    filters.q = '';
    if (sortSelect) sortSelect.value = 'featured';
    if (priceSelect) priceSelect.value = 'all';
    writeUrl();
    applyFilters();
  }

  categoryButtons.forEach((button) => {
    button.addEventListener('click', () => {
      filters.category = button.dataset.category;
      writeUrl();
      applyFilters();
    });
  });

  sortSelect?.addEventListener('change', () => {
    filters.sort = sortSelect.value;
    writeUrl();
    applyFilters();
  });

  priceSelect?.addEventListener('change', () => {
    filters.price = priceSelect.value;
    writeUrl();
    applyFilters();
  });

  clearButton?.addEventListener('click', clearFilters);
  window.addEventListener('popstate', () => {
    readUrl();
    applyFilters();
  });

  // Prices and bucket labels follow the chosen currency without a reload.
  document.addEventListener('velune:currencychange', () => {
    relabelPriceOptions();
    applyFilters();
  });

  readUrl();
  syncControls();

  function revealActiveCategory() {
    const active = categoryButtons.find((button) => button.dataset.category === filters.category);
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderCatalogue() {
    if (!state.products.length) {
      if (grid) {
        grid.innerHTML = '<div class="empty-state"><h2>We could not load the collection.</h2><p>Please refresh the page to try again.</p></div>';
      }
      if (countNode) countNode.textContent = 'Collection unavailable';
      return false;
    }
    fillCounts();
    relabelPriceOptions();
    applyFilters();
    revealActiveCategory();
    return true;
  }

  ready.then(renderCatalogue);
  // A visitor can switch currency before the catalogue answers; re-label and
  // re-filter as soon as both are in place.
  window.VELUNE.currencyReady.then(() => {
    if (state.products.length) renderCatalogue();
  });
})();
