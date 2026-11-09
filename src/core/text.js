// Small text helpers shared by all modules.
// Every file is a plain <script> (not an ES module) so the page still opens from file://.
// Modules share one namespace object: window.LT.
(() => {
  const LT = globalThis.LT ??= {};

  LT.text = {
    split: t => (t || '').trim().split(/\s+/).filter(Boolean),
    cap: t => t.charAt(0).toUpperCase() + t.slice(1),
  };
})();
