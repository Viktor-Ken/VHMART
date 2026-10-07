// Signed-in state for the whole site, shared by every page.
//
// Firebase keeps a customer or vendor signed in across pages, but the public pages
// are static HTML whose menu always said "Sign in". The person looked signed out
// while still having access to everything, had no Sign out button, and the sign-in
// page happily let a second person sign in over them. js/session.js uses this module
// to show the real state and to offer a way out.
import { auth, database } from './firebase.js';
import { isAdminEmail } from './auth.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import { get, ref } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

// A suspended or deleted account (set from the admin Accounts page) must not stay
// signed in. The administrator account is never blocked, so it cannot lock itself out.
export function isBlocked(profile) {
    return !!profile && (profile.active === false || !!profile.deletedAt);
}

// Calls back with { user, role, name } for a signed-in person, or null when signed
// out. The second argument is 'blocked' when a suspended/deleted account was signed out.
export function watchSession(callback) {
    onAuthStateChanged(auth, async (user) => {
        if (!user) { callback(null); return; }
        // Save a provisional hint straight away. A sign-in page redirects as soon as it
        // has signed in, which can be before the profile below has loaded, and the next
        // page decides from this hint whether it needs to load Firebase at all.
        try { if (!localStorage.getItem('vhmart_session')) localStorage.setItem('vhmart_session', JSON.stringify({ role: isAdminEmail(user) ? 'admin' : 'customer', name: user.displayName || user.email || '' })); } catch (error) { /* private mode */ }
        let profile = {};
        try { profile = (await get(ref(database, `users/${user.uid}`))).val() || {}; } catch (error) { console.warn('Profile unavailable:', error && error.message); }
        const admin = isAdminEmail(user);
        if (!admin && isBlocked(profile)) {
            try { await signOut(auth); } catch (error) { console.error(error); }
            callback(null, 'blocked');
            return;
        }
        callback({ user, role: admin ? 'admin' : (profile.role || 'customer'), name: profile.name || user.displayName || user.email || '' });
    });
}

export async function signOutNow() {
    await signOut(auth);
}
