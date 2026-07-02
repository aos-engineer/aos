// Theme init + toggle, served from same origin so it satisfies the site's
// strict CSP (`script-src 'self'`). Inline scripts are blocked by that policy,
// which is why the toggle previously did nothing. Loaded render-blocking in
// <head> so the initial theme is set before first paint (no flash), and the
// toggle uses event delegation so it works even though this runs before the
// button is parsed.
(function () {
  var root = document.documentElement;

  function apply(dark) {
    root.classList.toggle('dark', dark);
    // Reflect the scheme on the root so the browser honors it (and won't force-dark).
    root.style.colorScheme = dark ? 'dark' : 'light';
  }

  var stored = null;
  try {
    stored = localStorage.getItem('aos-theme');
  } catch (e) {
    /* localStorage may be unavailable (private mode / blocked) */
  }
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  apply(stored === 'dark' || (!stored && prefersDark));

  document.addEventListener('click', function (event) {
    var target = event.target;
    var toggle = target && target.closest ? target.closest('[data-theme-toggle]') : null;
    if (!toggle) return;
    var next = !root.classList.contains('dark');
    apply(next);
    try {
      localStorage.setItem('aos-theme', next ? 'dark' : 'light');
    } catch (e) {
      /* ignore persistence failure */
    }
  });
})();
