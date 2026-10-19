import { requireUser, logout } from './auth.js';
import { database } from './firebase.js';
import { get, ref, update, push, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';
import { recentTraffic } from './analytics.js';

export function startAdmin() {
  logout(document.querySelector('#logout'));
  const root = document.querySelector('#adminContent');
  requireUser(async (user, profile) => {
    if (profile.role !== 'admin') { location.href = '../index.html'; return; }
    try {
      // The cards appear straight away (with the numbers from the last visit, if any) and each
      // one updates as soon as its own data arrives, so a slow list - the products, which carry
      // their photos - no longer holds up the whole page.
      const CACHE_KEY = 'vhmart-admin-stats';
      let cached = {};
      try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) { cached = {}; }
      const labels = ['Total vendors', 'Active vendors', 'Pending vendor approvals', 'Suspended vendors',
        'Total products', 'Published products', 'Archived products', 'Total enquiries', 'Open enquiries',
        'Reports', 'Visitors (7 days)', 'Page views (7 days)'];
      const titles = new Map();
      root.replaceChildren();
      labels.forEach((label) => {
        const card = document.createElement('article');
        card.className = 'category-card';
        card.style.backgroundImage = 'linear-gradient(135deg,#176b55,#e76f51)';
        const title = document.createElement('h2');
        title.textContent = `${label}: ${label in cached ? cached[label] : '…'}`;
        card.append(title);
        root.append(card);
        titles.set(label, title);
      });
      const set = (label, value) => {
        titles.get(label).textContent = `${label}: ${value}`;
        cached[label] = value;
      };
      const total = (snapshot) => (snapshot.exists() ? Object.keys(snapshot.val()).length : 0);
      const jobs = [
        get(ref(database, 'vendors')).then((vendors) => {
          set('Total vendors', total(vendors));
          set('Active vendors', count(vendors, 'ACTIVE'));
          set('Pending vendor approvals', count(vendors, 'PENDING'));
          set('Suspended vendors', count(vendors, 'SUSPENDED'));
        }),
        get(ref(database, 'products')).then((products) => {
          set('Total products', total(products));
          set('Published products', count(products, 'PUBLISHED'));
          set('Archived products', count(products, 'ARCHIVED'));
        }),
        get(ref(database, 'enquiries')).then((enquiries) => {
          set('Total enquiries', total(enquiries));
          set('Open enquiries', count(enquiries, 'NEW'));
        }),
        get(ref(database, 'reports')).then((reports) => set('Reports', total(reports))),
        // Traffic is a nicety on this page: if it cannot be read the rest still loads.
        recentTraffic(7).catch((error) => { console.warn('Traffic unavailable:', error); return []; }).then((traffic) => {
          set('Visitors (7 days)', traffic.reduce((sum, row) => sum + row.visitors, 0));
          set('Page views (7 days)', traffic.reduce((sum, row) => sum + row.views, 0));
        })
      ];
      await Promise.all(jobs);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cached)); } catch (e) { /* private mode */ }
    } catch (error) {
      console.error('Admin dashboard load failed:', error);
      root.replaceChildren();
      const message = document.createElement('p');
      message.className = 'error';
      const denied = /permission[_ ]denied/i.test(`${error.code || ''} ${error.message || ''}`);
      message.textContent = denied
        ? 'The database refused to show the dashboard to this account. Add an entry for this account under "admins" in the Realtime Database (or remove the "admins" node so the admin email works again). Your account ID is shown below.'
        : 'We could not load the admin dashboard. Please refresh and try again.';
      root.append(message);
      if (denied) {
        const uid = document.createElement('p');
        uid.className = 'error';
        uid.textContent = `Account ID: ${user.uid}`;
        root.append(uid);
      }
    }
  }, 'login.html');
}

function count(snapshot, status) {
  return snapshot.exists() ? Object.values(snapshot.val()).filter((item) => item.status === status).length : 0;
}

export async function moderate(path, id, status, actorUid) {
  await update(ref(database, `${path}/${id}`), { status, updatedAt: serverTimestamp() });
  const log = push(ref(database, 'audit_logs'));
  await update(log, { actor: actorUid, action: `${status}_${path}`, target: id, timestamp: serverTimestamp() });
}
