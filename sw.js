// Keeps fonts, images and the product list on the visitor's device so repeat visits
// and weak connections feel instant. It never touches pages, stylesheets or scripts,
// so a release is always picked up normally. Bump CACHE to throw everything away.
const CACHE = 'vhmart-static-v1';
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
        event.waitUntil(refresh);
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
