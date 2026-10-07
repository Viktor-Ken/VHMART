import { database } from './firebase-db.js';
import { ref, get } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

const DAY_MS = 86400000;

// Recording happens in js/track.js (plain HTTPS, no SDK). This module only reads the
// totals back for the admin pages.
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
