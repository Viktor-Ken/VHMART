import { database } from './firebase.js';
import { ref, get, set, push, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

const VISITOR_KEY = 'vhmart_visitor_id';
const DAY_MS = 86400000;
const IGNORED = ['/css/', '/js/', '/Visuamall/', '/.github/', '/scripts/', '/tests/', '/firebase/'];
const BOT = /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|curl|wget|python-requests/i;

function visitorId() {
    let id = null;
    try { id = localStorage.getItem(VISITOR_KEY); } catch { id = null; }
    if (!id || !/^[a-f0-9]{32}$/.test(id)) {
        const bytes = new Uint8Array(16);
        (crypto.getRandomValues ? crypto : { getRandomValues: (a) => a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); }) }).getRandomValues(bytes);
        id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        try { localStorage.setItem(VISITOR_KEY, id); } catch { /* private mode */ }
    }
    return id;
}

function dayKey() {
    return new Date().toISOString().slice(0, 10);
}

function device() {
    const ua = navigator.userAgent || '';
    if (/ipad|tablet|kindle/i.test(ua)) return 'tablet';
    if (/mobi|iphone|android/i.test(ua)) return 'mobile';
    if (/windows|macintosh|linux|cros/i.test(ua)) return 'desktop';
    return 'other';
}

export async function trackPageView(path) {
    const route = String(path || location.pathname).slice(0, 200);
    if (IGNORED.some((prefix) => route.startsWith(prefix))) return;
    if (BOT.test(navigator.userAgent || '')) return;

    const day = dayKey();
    const id = visitorId();
    const record = {
        path: route,
        visitorId: id,
        device: device(),
        referrer: (document.referrer || '').slice(0, 200),
        at: serverTimestamp()
    };

    try {
        // Unique visitors: a blind write to a visitor-keyed path is idempotent,
        // so no read (and no leaked visitor list) and no lost-update race.
        await set(ref(database, `analytics/unique/${day}/${id}`), true);

        // Page views: a transaction on a bare number is race-free under load.
        const counter = ref(database, `analytics/daily/${day}/views`);
        await runTransaction(counter, (value) => (typeof value === 'number' ? value + 1 : 1));

        await set(push(ref(database, 'analytics/page_views')), record);
    } catch (error) {
        console.warn('Analytics not recorded:', error && error.message);
    }
}

export async function recentTraffic(days = 30) {
    const out = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date(now.getTime() - i * DAY_MS);
        out.push({ day: d.toISOString().slice(0, 10), views: 0, visitors: 0 });
    }
    const byDay = new Map(out.map((row) => [row.day, row]));

    const [daily, unique] = await Promise.all([
        get(ref(database, 'analytics/daily')),
        get(ref(database, 'analytics/unique'))
    ]);

    if (daily.exists()) {
        daily.forEach((value) => {
            const row = byDay.get(value.key);
            if (!row) return;
            row.views = value.child('views').val() || 0;
        });
    }

    if (unique.exists()) {
        unique.forEach((dayNode) => {
            const row = byDay.get(dayNode.key);
            if (!row) return;
            let count = 0;
            dayNode.forEach(() => { count += 1; });
            row.visitors = count;
        });
    }

    return out;
}
