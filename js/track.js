(function () {
    if (window.__vhmartAnalytics) return;
    window.__vhmartAnalytics = true;
    // Resolve relative to this script, not the page: this file is loaded from
    // the site root, /admin/ and /vendor/, so a bare './analytics.js' would
    // break on the nested pages.
    var scriptUrl = (document.currentScript && document.currentScript.src) || '';
    var moduleUrl = new URL('./analytics.js', scriptUrl || location.href).href;

    // Loading this module pulls in the Firebase SDK - roughly 490 KB across four
    // gstatic files - and a signed-out visitor on the marketing pages does not
    // need any of it before the page is usable. It used to start on 'load',
    // which competed with the page the visitor was actually waiting for.
    //
    // Wait for the page to be interactive, then for the browser to be idle, so
    // analytics never sits in front of content. requestIdleCallback is not
    // available in Safari before 16.4, hence the timeout fallback, and the
    // timeout also stops a page that never goes idle from never recording.
    var start = function () {
        import(moduleUrl).then(function (mod) {
            return mod.trackPageView(location.pathname);
        }).catch(function () { /* analytics is best effort */ });
    };

    if (document.readyState === 'complete') {
        whenIdle(start);
        return;
    }

    window.addEventListener('load', function () { whenIdle(start); });
})();

// Runs fn when the browser is idle, or after a short delay if idle callbacks are
// unsupported or never fire. Analytics must never block or delay the page.
function whenIdle(fn) {
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(fn, { timeout: 3000 });
        return;
    }
    window.setTimeout(fn, 1200);
}