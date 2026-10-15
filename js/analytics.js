import { database } from './firebase-db.js';
import { ref, get } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

const LONDON = 'Europe/London';

// A "day" for analytics is a London calendar day (so the daily counters reset at
// London midnight, wherever the visitor or the admin is). js/track.js uses the same rule.
export function londonDay(date = new Date()) {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    } catch (e) { return date.toISOString().slice(0, 10); }
}

// 24-hour London clock, for example "19:05".
export function londonClock(date = new Date()) {
    try {
        return new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
    } catch (e) { return date.toISOString().slice(11, 16); }
}

// Day keys step by calendar date, not by 24 hours, so clock changes can't skip or repeat a day.
export function shiftDay(key, delta) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// Recording happens in js/track.js (plain HTTPS, no SDK). This module only reads the
// totals back for the admin pages.
export async function recentTraffic(days = 30) {
    const out = [];
    const today = londonDay();
    for (let i = days - 1; i >= 0; i -= 1) out.push({ day: shiftDay(today, -i), views: 0, visitors: 0 });
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
