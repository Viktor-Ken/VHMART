import { requireAdmin, logout } from './auth.js';
import { database } from './firebase.js';
import { get, ref, update, push, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';
import { recentTraffic } from './analytics.js';

export function startAdmin() {
  logout(document.querySelector('#logout'));
  const root = document.querySelector('#adminContent');
  requireAdmin(async () => {
    try {
      const [vendors, products, enquiries, reports, traffic] = await Promise.all([
        get(ref(database, 'vendors')),
        get(ref(database, 'products')),
        get(ref(database, 'enquiries')),
        get(ref(database, 'reports')),
        recentTraffic(7)
      ]);
      const totalViews = traffic.reduce((sum, row) => sum + row.views, 0);
      const totalVisitors = traffic.reduce((sum, row) => sum + row.visitors, 0);
      const groups = [
        ['Total vendors', vendors.exists() ? Object.keys(vendors.val()).length : 0],
        ['Active vendors', count(vendors, 'ACTIVE')],
        ['Pending approvals', count(vendors, 'PENDING')],
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

// Soft delete, and reversible. A hard remove() would destroy the record an audit
// trail and any live enquiry reference, and the public read already excludes
// anything carrying deletedAt - so the product disappears from the marketplace
// while the data survives.
//
// Mirrors how accounts.html deletes a user, so an admin sees the same shape of
// action in both places.
export async function softDelete(path, id, actorUid, reason = '') {
  await update(ref(database, `${path}/${id}`), {
    status: 'SUSPENDED',
    deletedAt: serverTimestamp(),
    deletedBy: actorUid,
    deletedReason: String(reason).slice(0, 300),
    updatedAt: serverTimestamp()
  });
  const log = push(ref(database, 'audit_logs'));
  await update(log, {
    actor: actorUid,
    action: `delete_${path}`,
    target: id,
    reason: String(reason).slice(0, 300),
    timestamp: serverTimestamp()
  });
}

export async function restore(path, id, actorUid) {
  // ARCHIVED rather than PUBLISHED: restoring must not silently put a product
  // back on sale without the admin checking it. One further click publishes it.
  await update(ref(database, `${path}/${id}`), {
    status: 'ARCHIVED',
    deletedAt: null,
    deletedBy: '',
    deletedReason: '',
    updatedAt: serverTimestamp()
  });
  const log = push(ref(database, 'audit_logs'));
  await update(log, { actor: actorUid, action: `restore_${path}`, target: id, timestamp: serverTimestamp() });
}
