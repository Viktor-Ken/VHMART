// Keeps fonts, images and the product list on the visitor's device so repeat visits
// and weak connections feel instant. It never touches pages, stylesheets or scripts,
// so a release is always picked up normally. Bump CACHE to throw everything away.
const CACHE = 'vhmart-static-v2';
// Images and the product list are capped: when the cache is full, the ones looked at
// longest ago are removed first, so it can never grow without limit on a phone.
importScripts('/js/lru-cache.js');
const MAX_ENTRIES = 150;
const ORDER_KEY = '/__recent-order.json';
const recent = new LRUCache(MAX_ENTRIES, (url) => {
    caches.open(CACHE).then((cache) => cache.delete(url)).catch(() => {});
});
let restored = null;

// The worker can be stopped at any time, so the usage order is saved alongside the files.
function restoreOrder() {
    if (!restored) {
        restored = (async () => {
            try {
                const cache = await caches.open(CACHE);
                const saved = await cache.match(ORDER_KEY);
                const urls = saved ? await saved.json() : [];
                for (const url of urls) if (!recent.has(url)) recent.set(url, true);
            } catch (error) { /* start with an empty order */ }
        })();
    }
    return restored;
}

async function saveOrder() {
    try {
        const cache = await caches.open(CACHE);
        await cache.put(ORDER_KEY, new Response(JSON.stringify(recent.keys()), { headers: { 'content-type': 'application/json' } }));
    } catch (error) { /* order is only a hint */ }
}

async function use(request) {
    // Fonts are tiny and few, so only images and the product list are counted.
    const path = new URL(request.url).pathname;
    if (FONTS.test(path)) return;
    await restoreOrder();
    recent.set(request.url, true);
    await saveOrder();
}
const FONTS = /^\/fonts\//;
const IMAGES = /^\/(Visuamall|icons|product\/thumb)\/|^\/product\/[^/]+\.(jpg|jpeg|png|webp|avif)$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) {
            if (key.startsWith('vhmart-') && key !== CACHE) await caches.delete(key);
        }
        await self.clients.claim();
    })());
});

async function remember(request, response) {
    // Only complete, same-origin answers; never partial (206) or error responses.
    if (response && response.status === 200 && response.type === 'basic') {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
        await use(request);
    }
    return response;
}

// Fonts never change under the same name: answer from the cache, fetch only on a miss.
async function cacheFirst(request) {
    const cached = await caches.match(request);
    return cached || remember(request, await fetch(request));
}

// Show what is stored straight away, and refresh it in the background for next time.
async function staleWhileRevalidate(event) {
    const request = event.request;
    const cached = await caches.match(request);
    const refresh = fetch(request).then((response) => remember(request, response)).catch(() => null);
    if (cached) {
        event.waitUntil(Promise.all([refresh, use(request)]));
        return cached;
    }
    return (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || request.headers.has('range')) return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (FONTS.test(url.pathname)) event.respondWith(cacheFirst(request));
    else if (url.pathname === '/products.json' || IMAGES.test(url.pathname)) event.respondWith(staleWhileRevalidate(event));
});
