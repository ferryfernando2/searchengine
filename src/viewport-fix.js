// viewport-fix.js
// Set a fixed CSS variable --vh based on the initial window.innerHeight
// and avoid updating it when the mobile keyboard opens (prevents layout jumps).

(function(){
  try {
    var initialInnerHeight = window.innerHeight;
    var setVh = function(h){
      document.documentElement.style.setProperty('--vh', (h * 0.01) + 'px');
    };

    // set initially
    setVh(initialInnerHeight);

    // Heuristic-based resize handler:
    // - if an input is focused and the viewport shrank significantly, assume keyboard opened -> ignore
    // - if the change is large and no input focused (orientation change / chrome UI) -> update
    var lastUpdate = Date.now();
    window.addEventListener('resize', function(){
      var ih = window.innerHeight;
      var focused = (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable));
      var diff = Math.abs(initialInnerHeight - ih);

      // If input focused and height decreased by > 100px, treat as keyboard open -> do not update --vh
      if (focused && (initialInnerHeight - ih) > 100) {
        return;
      }

      // If change is small (<100px), update (minor UI chrome changes)
      if (diff < 100) {
        initialInnerHeight = ih;
        setVh(ih);
        lastUpdate = Date.now();
        return;
      }

      // If enough time passed or not focused, treat as real resize (orientation change)
      if (!focused || (Date.now() - lastUpdate) > 300) {
        initialInnerHeight = ih;
        setVh(ih);
        lastUpdate = Date.now();
      }
    }, { passive: true });
  } catch (e) {
    // fail silently
    console.warn('viewport-fix init failed', e);
  }
})();
