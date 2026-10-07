// Shows whether the visitor is signed in, on every page that has a public menu.
//
// Classic script, so it can be dropped on any page. It paints the menu straight away
// from a small hint saved on the previous visit, so a signed-in person does not see a
// "Sign in" link flash up, then asks Firebase (loaded lazily, after the page is
// usable) for the real state and corrects the menu if the hint was out of date.
//
// It also guards the sign-in and sign-up pages: someone who is already signed in is
// offered "Continue" or "Sign out" instead of a form that would silently sign a second
// person in over them.
(function () {
    if (window.__vhmartSession) return;
    window.__vhmartSession = true;

    var KEY = 'vhmart_session';
    var script = document.currentScript;
    var root = new URL('../', (script && script.src) || location.href).href; // site root
    var coreUrl = new URL('./session-core.js', (script && script.src) || location.href).href;
    var core = null;

    function readHint() { try { var v = JSON.parse(localStorage.getItem(KEY)); return v && v.role ? v : null; } catch (e) { return null; } }
    function saveHint(state) { try { if (state) localStorage.setItem(KEY, JSON.stringify({ role: state.role, name: state.name })); else localStorage.removeItem(KEY); } catch (e) { } }
    function homeFor(role) { return role === 'admin' ? root + 'admin/dashboard.html' : role === 'vendor' ? root + 'vendor/dashboard.html' : root + 'index.html'; }

    function loadCore() { return core || (core = import(coreUrl)); }

    function signOutClick(event) {
        event.preventDefault();
        var done = function () { saveHint(null); location.href = root + 'index.html'; };
        loadCore().then(function (mod) { return mod.signOutNow(); }).then(done, done);
    }

    function paintMenu(state) {
        var containers = document.querySelectorAll('.live-links, .nav-links, #mobileDrawer');
        for (var i = 0; i < containers.length; i += 1) {
            var box = containers[i];
            var signIn = box.querySelector('a[data-session-signin], a[href$="login.html"], a[href$="/login"], a[href="login"]');
            if (!signIn) continue;
            signIn.setAttribute('data-session-signin', '');
            var added = box.querySelectorAll('[data-session-added]');
            for (var j = 0; j < added.length; j += 1) added[j].remove();
            if (!state) { signIn.style.display = ''; continue; }
            signIn.style.display = 'none';
            if (state.role === 'vendor' || state.role === 'admin') {
                var dash = document.createElement('a');
                dash.href = homeFor(state.role);
                dash.textContent = state.role === 'admin' ? 'Admin' : 'My dashboard';
                dash.setAttribute('data-session-added', '');
                box.appendChild(dash);
            }
            var out = document.createElement('button');
            out.type = 'button';
            out.className = 'session-signout';
            out.textContent = 'Sign out';
            out.title = state.name ? 'Signed in as ' + state.name : 'Sign out';
            out.setAttribute('data-session-added', '');
            out.addEventListener('click', signOutClick);
            box.appendChild(out);
        }
    }

    // Sign-in / sign-up pages: do not let a second person sign in over the first.
    function guardAuthPage(state, reason) {
        var form = document.querySelector('#loginForm, #registerForm');
        if (!form) return;
        var panel = form.closest('.form-panel');
        if (!panel) return;
        var existing = document.querySelector('#sessionNotice');
        if (existing) existing.remove();
        if (!state) {
            form.hidden = false;
            panel.querySelectorAll('[data-session-hidden]').forEach(function (n) { n.hidden = false; });
            if (reason === 'blocked' || /[?&]blocked=1/.test(location.search)) {
                var msg = document.querySelector('#message');
                if (msg) msg.textContent = 'This account has been suspended or deleted. Please contact VHMART support.';
            }
            return;
        }
        var notice = document.createElement('div');
        notice.id = 'sessionNotice';
        notice.className = 'notice';
        var p = document.createElement('p');
        var strong = document.createElement('strong');
        strong.textContent = 'You are already signed in' + (state.name ? ' as ' + state.name : '') + '.';
        p.append(strong, ' Sign out first if you want to use a different account.');
        var row = document.createElement('div');
        row.className = 'button-row';
        var go = document.createElement('a');
        go.className = 'button button--primary';
        go.href = homeFor(state.role);
        go.textContent = state.role === 'customer' ? 'Continue browsing' : 'Go to my dashboard';
        var out = document.createElement('button');
        out.type = 'button';
        out.className = 'button button--quiet';
        out.textContent = 'Sign out';
        out.addEventListener('click', signOutClick);
        row.append(go, out);
        notice.append(p, row);
        Array.prototype.forEach.call(panel.children, function (child) { if (child.tagName !== 'H1' && child.id !== 'sessionNotice') { child.setAttribute('data-session-hidden', ''); child.hidden = true; } });
        panel.appendChild(notice);
    }

    function storageWorks() { try { localStorage.setItem(KEY + '_t', '1'); localStorage.removeItem(KEY + '_t'); return true; } catch (e) { return false; } }

    var hint = readHint();
    function start() {
        paintMenu(hint);
        var first = true;
        var begin = function () {
            loadCore().then(function (mod) {
                mod.watchSession(function (state, reason) {
                    saveHint(state);
                    paintMenu(state);
                    // Only the first answer guards the page; sign-in and sign-up
                    // themselves change the state mid-form and must not be interrupted.
                    if (first) { first = false; guardAuthPage(state, reason); }
                });
            }).catch(function (error) { console.warn('Session check unavailable:', error && error.message); });
        };
        var onAuthPage = !!document.querySelector('#loginForm, #registerForm');
        // An anonymous visitor (no saved hint) has no session to check, so the Firebase
        // SDK is not downloaded at all on public pages. It loads when a hint says
        // someone is signed in, on the sign-in/sign-up pages, or when the browser
        // cannot keep a hint (storage blocked), so the real state is never missed.
        if (!onAuthPage && !hint && storageWorks()) return;
        if (onAuthPage || typeof window.requestIdleCallback !== 'function') { begin(); }
        else { window.requestIdleCallback(begin, { timeout: 2500 }); }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
