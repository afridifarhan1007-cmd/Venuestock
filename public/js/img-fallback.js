/* Broken-image recovery for product photography.
   CSP sets script-src 'self', so fallbacks cannot use inline onerror handlers. */
(function () {
  const PLACEHOLDER =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" role="img">' +
        '<rect width="400" height="500" fill="#efe9df"/>' +
        '<rect x="24" y="24" width="352" height="452" fill="none" stroke="#d8cfc1" stroke-width="1"/>' +
        '<text x="200" y="243" font-family="Inter,sans-serif" font-size="13" letter-spacing="2" fill="#8a7f70" text-anchor="middle">PHOTO COMING SOON</text>' +
        '</svg>'
    );

  function recover(img) {
    if (img.dataset.fallbackStage === 'done') return;
    const next = img.getAttribute('data-fallback-src') || img.dataset.fallbackSrc;
    img.dataset.fallbackStage = 'done';
    // A surviving srcset keeps winning over the replacement src.
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    if (next && next !== img.getAttribute('src')) {
      img.src = next;
    } else {
      img.src = PLACEHOLDER;
    }
  }

  // 'error' does not bubble, so capture phase is required to catch images added later.
  document.addEventListener(
    'error',
    (event) => {
      const target = event.target;
      if (target && target.tagName === 'IMG') recover(target);
    },
    true
  );

  // Images that failed before this script ran (complete + naturalWidth 0).
  window.addEventListener('load', () => {
    document.querySelectorAll('img').forEach((img) => {
      if (img.complete && img.naturalWidth === 0 && !img.src.startsWith('data:')) recover(img);
    });
  });
})();
