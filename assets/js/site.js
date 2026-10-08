(() => {
  'use strict';

  const year = document.getElementById('copyright-year');
  if (!year) return;

  function updateCopyrightYear() {
    year.textContent = String(new Date().getFullYear());
  }

  updateCopyrightYear();
  window.addEventListener('pageshow', updateCopyrightYear);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateCopyrightYear();
  });
})();