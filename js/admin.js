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
      const [vendors, products, enquiries, reports, traffic] = await Promise.all([
        get(ref(database, 'vendors')),
        get(ref(database, 'products')),
        get(ref(database, 'enquiries')),
        get(ref(database, 'reports')),
        // Traffic is a nicety on this page: if it cannot be read the rest still loads.
        recentTraffic(7).catch((error) => { console.warn('Traffic unavailable:', error); return []; })
      ]);
      const totalViews = traffic.reduce((sum, row) => sum + row.views, 0);
      const totalVisitors = traffic.reduce((sum, row) => sum + row.visitors, 0);
      const groups = [
        ['Total vendors', vendors.exists() ? Object.keys(vendors.val()).length : 0],
        ['Active vendors', count(vendors, 'ACTIVE')],
        ['Suspended vendors', count(vendors, 'SUSPENDED')],
        ['Total products', products.exists() ? Object.keys(products.val()).length : 0],
        ['Published products', count(products, 'PUBLISHED')],
        ['Archived products', count(products, 'ARCHIVED')],
        ['Total enquiries', enquiries.exists() ? Object.keys(enquiries.val()).length : 0],
        ['Open enquiries', count(enquiries, 'NEW')],
        ['Reports', reports.exists() ? Object.keys(reports.val()).length : 0],
        ['Visitors (7 days)', totalVisitors],
        ['Page views (7 days)', totalViews]
      ];
      root.replaceChildren();
      groups.forEach(([label, value]) => {
        const card = document.createElement('article');
        card.className = 'category-card';
        card.style.backgroundImage = 'linear-gradient(135deg,#176b55,#e76f51)';
        const title = document.createElement('h2');
        title.textContent = `${label}: ${value}`;
        card.append(title);
        root.append(card);
      });
    } catch (error) {
      console.error('Admin dashboard load failed:', error);
      root.replaceChildren();
      const message = document.createElement('p');
      message.className = 'error';
      message.textContent = 'We could not load the admin dashboard. Please refresh and try again.';
      root.append(message);
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
