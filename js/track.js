(function () {
    if (window.__vhmartAnalytics) return;
    window.__vhmartAnalytics = true;
    // Resolve relative to this script, not the page: this file is loaded from
    // the site root, /admin/ and /vendor/, so a bare './analytics.js' would
    // break on the nested pages.
    var scriptUrl = (document.currentScript && document.currentScript.src) || '';
    var moduleUrl = new URL('./analytics.js', scriptUrl || location.href).href;
    window.addEventListener('load', function () {
        import(moduleUrl).then(function (mod) {
            mod.trackPageView(location.pathname);
        }).catch(function () { /* analytics is best effort */ });
    });
})();
