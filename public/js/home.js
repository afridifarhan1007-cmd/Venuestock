/* Home — curated grids */
(() => {
  'use strict';
  const { ready, state, renderGrid, $ } = window.VELUNE;

  const curated = {
    new: ['first-dew-essence', 'neroli-comfort-cream', 'cushion-lip-tint', 'fig-leaf-water-eau-de-toilette'],
    best: ['vitamin-c-15-brightening-serum', 'ceramide-barrier-cream', 'ivory-thread-eau-de-parfum', 'argan-and-camellia-hair-oil']
  };

  const newGrid = $('[data-grid="new"]');
  const bestGrid = $('[data-grid="best"]');
  let shown = { new: [], best: [] };

  function pick(names, fallbackFilter) {
    const bySlug = new Map(state.products.map((product) => [product.slug, product]));
    const chosen = names.map((name) => bySlug.get(name)).filter(Boolean);
    if (chosen.length < 4) {
      const extra = state.products
        .filter((product) => fallbackFilter(product) && !chosen.some((entry) => entry.slug === product.slug))
        .slice(0, 4 - chosen.length);
      chosen.push(...extra);
    }
    if (chosen.length < 4) {
      for (const product of state.products) {
        if (chosen.length >= 4) break;
        if (!chosen.some((entry) => entry.slug === product.slug)) chosen.push(product);
      }
    }
    return chosen.slice(0, 4);
  }

  function draw() {
    if (!state.products.length) {
      const message = '<div class="empty-state"><h2>The collection is resting.</h2><p>Please refresh in a moment.</p></div>';
      if (newGrid) newGrid.innerHTML = message;
      if (bestGrid) bestGrid.innerHTML = message;
      return;
    }
    shown = {
      new: pick(curated.new, (product) => product.isNew),
      best: pick(curated.best, (product) => product.featured)
    };
    if (newGrid) renderGrid(newGrid, shown.new);
    if (bestGrid) renderGrid(bestGrid, shown.best);
  }

  ready.then(draw);

  // The teasers are the same product cards as the grid, so they repaint with
  // the chosen currency instead of staying in the language they loaded in.
  document.addEventListener('velune:currencychange', () => {
    if (!state.products.length) return;
    if (newGrid) renderGrid(newGrid, shown.new);
    if (bestGrid) renderGrid(bestGrid, shown.best);
  });
})();
