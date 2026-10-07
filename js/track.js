// Privacy-friendly traffic counting, with no Firebase SDK.
//
// This used to import js/analytics.js, which pulled the whole Firebase SDK (several
// files, roughly 490 KB) onto every page view just to write three small records.
// The Realtime Database accepts the same writes over plain HTTPS, so an ordinary
// visitor now downloads nothing extra: a few tiny requests after the page is idle.
//
// What is recorded is unchanged: a daily view counter, a unique-visitor flag per day
// and a page_views entry (path, random visitor id, coarse device class, referrer).
// No IP address, no fingerprint, no email. The database rules decide what may be
// written; they accept exactly these shapes from anonymous visitors.
(function () {
    if (window.__vhmartAnalytics) return;
    window.__vhmartAnalytics = true;

    var DB = 'https://visuamall-a620f-default-rtdb.firebaseio.com';
    var VISITOR_KEY = 'vhmart_visitor_id';
    var IGNORED = ['/css/', '/js/', '/Visuamall/', '/.github/', '/scripts/', '/tests/', '/firebase/'];
    var BOT = /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|curl|wget|python-requests/i;

    function visitorId() {
        var id = null;
        try { id = localStorage.getItem(VISITOR_KEY); } catch (e) { id = null; }
        if (!id || !/^[a-f0-9]{32}$/.test(id)) {
            var bytes = new Uint8Array(16);
            if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
            else for (var i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
            id = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
            try { localStorage.setItem(VISITOR_KEY, id); } catch (e) { /* private mode */ }
        }
        return id;
    }

    function device() {
        var ua = navigator.userAgent || '';
        if (/ipad|tablet|kindle/i.test(ua)) return 'tablet';
        if (/mobi|iphone|android/i.test(ua)) return 'mobile';
        if (/windows|macintosh|linux|cros/i.test(ua)) return 'desktop';
        return 'other';
    }

    function send(method, path, body) {
        return fetch(DB + path + '.json', { method: method, body: JSON.stringify(body), keepalive: true, mode: 'cors', credentials: 'omit' });
    }

    function record() {
        var route = String(location.pathname || '/').slice(0, 200);
        if (IGNORED.some(function (prefix) { return route.indexOf(prefix) === 0; })) return;
        if (BOT.test(navigator.userAgent || '')) return;

        var day = new Date().toISOString().slice(0, 10);
        var id = visitorId();
        // Unique visitor: a blind write to a visitor-keyed path is idempotent.
        // Views: the server adds one itself, so two simultaneous visitors cannot overwrite each other.
        send('PUT', '/analytics/unique/' + day + '/' + id, true).catch(function () { });
        send('PUT', '/analytics/daily/' + day + '/views', { '.sv': { increment: 1 } }).catch(function () { });
        send('POST', '/analytics/page_views', {
            path: route,
            visitorId: id,
            device: device(),
            referrer: (document.referrer || '').slice(0, 200),
            at: { '.sv': 'timestamp' }
        }).catch(function () { });
    }

    // Never in front of content: wait until the page is loaded, then idle.
    function whenIdle(fn) {
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 4000 });
        else window.setTimeout(fn, 1500);
    }
    if (document.readyState === 'complete') whenIdle(record);
    else window.addEventListener('load', function () { whenIdle(record); });
})();
