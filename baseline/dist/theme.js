// Baseline's theme: light, unless dark was chosen in this browser with the
// button at the top right of the page. The system's own setting plays no part.
//
// index.html and the policy page load this in the <head>, ahead of the
// stylesheet and not as a module, so it runs before anything is drawn and the
// page never shows in the other theme first. It sets data-theme on <html>,
// which styles.css reads, and keeps in step the two <meta> tags the browser
// reads for its own toolbar, scrollbars and form controls.
//
// The choice is kept in localStorage under THEME_KEY. It isn't part of the
// log, so signing out leaves it (see clearLogCache in account.mjs). Where
// storage can't be used, as in some private windows, the button still works
// for as long as the page stays open.
(() => {
  const THEME_KEY = "baseline.theme.v1";
  // --paper in each theme (see styles.css), for the browser's toolbar.
  const PAPER = { light: "#fdfdf7", dark: "#0d0e0b" };
  const root = document.documentElement;

  function saved() {
    try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; } catch { return "light"; }
  }

  function show(theme) {
    root.dataset.theme = theme;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", PAPER[theme]);
    // The button isn't there on the first call, which runs before the <body>.
    document.getElementById("theme-toggle")?.setAttribute("aria-pressed", String(theme === "dark"));
  }

  function toggle() {
    const theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* It lasts for this page only. */ }
    show(theme);
  }

  show(saved());
  const ready = () => {
    show(root.dataset.theme);
    document.getElementById("theme-toggle")?.addEventListener("click", toggle);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
  // Another tab of Baseline changed it, or the browser's storage was cleared.
  addEventListener("storage", event => { if (event.key === THEME_KEY || event.key === null) show(saved()); });
})();
