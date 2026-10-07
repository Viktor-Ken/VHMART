import { auth, database } from './firebase.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import { get, ref } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

// Simple MVP admin access: the admin account is identified by its email.
// The admin never needs to know or copy a Firebase UID.
export const ADMIN_EMAIL = 'admin@vhmart.com';

export function isAdminEmail(user) {
    return !!user && (user.email || '').toLowerCase() === ADMIN_EMAIL;
}

export function requireUser(onReady, loginPath = '../login.html', onError) {
    onAuthStateChanged(auth, async (user) => {
        if (!user) { location.href = loginPath; return; }
        try {
            // Read the user's own profile first. Do not read vendors/{uid} for customers:
            // that path is intentionally protected and a denied read must not block normal login.
            const userSnapshot = await get(ref(database, `users/${user.uid}`));
            const userProfile = userSnapshot.val() || {};
            // A suspended or deleted account (set by an admin) is signed out and sent back
            // to the sign-in page, which explains why. The administrator is never blocked.
            if (!isAdminEmail(user) && (userProfile.active === false || userProfile.deletedAt)) {
                try { localStorage.removeItem('vhmart_session'); } catch (e) { /* private mode */ }
                await signOut(auth);
                location.href = `${loginPath}${loginPath.includes('?') ? '&' : '?'}blocked=1`;
                return;
            }
            const token = await user.getIdTokenResult();
            const role = isAdminEmail(user)
                ? 'admin'
                : (userProfile.role || token.claims.role || (token.claims.admin === true ? 'admin' : 'customer'));
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

export function logout(button) {
    // Always return to the site root, whichever folder the page is in, and forget the
    // menu hint so the public pages show "Sign in" again straight away.
    const root = new URL('../', import.meta.url).href;
    const finish = () => {
        try { localStorage.removeItem('vhmart_session'); } catch (e) { /* private mode */ }
        location.href = `${root}index.html`;
    };
    button?.addEventListener('click', () => signOut(auth).then(finish, finish));
}

export function escapeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
}
