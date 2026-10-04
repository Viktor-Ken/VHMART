import { auth, database } from './firebase.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import { get, ref } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

// Admin access has three sources, all of which the database rules honour:
//   1. an `admin` custom claim, granted with scripts/set-role.js
//   2. an entry in the `admins` node, granted from the admin Accounts page
//   3. the bootstrap email below, but only while `admins` is still empty
export const ADMIN_EMAIL = 'admin@vhmart.com';

export function isAdminEmail(user) {
    return !!user && (user.email || '').toLowerCase() === ADMIN_EMAIL;
}

// Mirrors the `admins` node write rule in firebase/database.rules.json.
export async function isAdmin(user, token) {
    if (!user) return false;
    if (token && token.claims && token.claims.admin === true) return true;
    try {
        const snapshot = await get(ref(database, `admins/${user.uid}`));
        if (snapshot.exists()) return true;
        const all = await get(ref(database, 'admins'));
        if (!all.exists()) return isAdminEmail(user);
    } catch (error) {
        console.warn('Could not verify admin access:', error && error.message);
    }
    return false;
}

export function requireUser(onReady, loginPath = '../login.html', onError) {
    onAuthStateChanged(auth, async (user) => {
        if (!user) { location.href = loginPath; return; }
        try {
            // Read the user's own profile first. Do not read vendors/{uid} for customers:
            // that path is intentionally protected and a denied read must not block normal login.
            const userSnapshot = await get(ref(database, `users/${user.uid}`));
            const userProfile = userSnapshot.val() || {};
            const token = await user.getIdTokenResult();
            const admin = await isAdmin(user, token);
            const role = admin
                ? 'admin'
                : (userProfile.role || token.claims.role || (token.claims.admin === true ? 'admin' : 'customer'));

            // A deleted or suspended account is treated as signed out everywhere.
            if (role !== 'admin' && (userProfile.deletedAt || userProfile.active === false)) {
                const page = location.pathname.includes('/admin/') || location.pathname.includes('/vendor/')
                    ? new URL('account-deleted.html', new URL('../', import.meta.url)).pathname
                    : new URL('account-deleted.html', import.meta.url).pathname;
                location.href = page;
                return;
            }

            let vendorProfile = {};
            if (role === 'vendor') {
                const vendorSnapshot = await get(ref(database, `vendors/${user.uid}`));
                vendorProfile = vendorSnapshot.val() || {};
                if (!vendorProfile.ownerUid || vendorProfile.ownerUid !== user.uid) {
                    throw new Error('Vendor profile is missing or invalid.');
                }
            }
            onReady(user, {
                ...userProfile,
                ...vendorProfile,
                role,
                status: vendorProfile.status || userProfile.status || null,
                declinedReason: vendorProfile.declinedReason || userProfile.declinedReason || '',
                deletedAt: userProfile.deletedAt || vendorProfile.deletedAt || null,
                vendorId: token.claims.vendorId || userProfile.vendorId || (role === 'vendor' ? user.uid : undefined)
            });
        } catch (error) {
            console.error('Authentication/profile load failed:', error);
            if (onError) onError(error);
            else {
                const message = document.querySelector('[data-auth-error]');
                if (message) message.textContent = 'We could not load your account. Please refresh and try again.';
            }
        }
    });
}

// Single entry point for admin pages. Refuses non-admins before any admin data
// is requested, so a signed-in customer never sees a half-rendered page.
//
// Authority is decided by isAdmin(), which checks the admin claim and the
// `admins` node - the same conditions the database rules enforce. Checking
// profile.role instead was wrong: role is a label that can lag behind the real
// grant, so a genuine administrator holding role "customer" was bounced to the
// homepage while the rules would have allowed every read they attempted.
export function requireAdmin(onReady, loginPath = '../login.html') {
    requireUser(async (user, profile) => {
        let allowed = false;
        try {
            const token = await user.getIdTokenResult();
            allowed = await isAdmin(user, token);
        } catch (error) {
            console.warn('Could not verify admin access:', error && error.message);
        }
        if (!allowed) {
            location.href = '../index.html';
            return;
        }
        onReady(user, profile);
    }, loginPath);
}

export function logout(button) {
    button?.addEventListener('click', () => signOut(auth).then(() => {
        location.href = '../index.html';
    }));
}

export function escapeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
}
