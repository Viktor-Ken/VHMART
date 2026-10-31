// A light, client-only brake on repeated sign-in attempts from the same browser.
//
// This is not the real security boundary: anyone can clear their browser storage,
// use a private window, or call Firebase's API directly, bypassing this entirely.
// The actual, unavoidable protection is Firebase Authentication's own server-side
// throttling, which answers a brute-forced account with `auth/too-many-requests`
// regardless of what the page does. This file only adds friction for the common
// case (someone repeatedly mistyping a password in the form) and gives a clearer
// countdown than Firebase's own error text.
//
// Classic script so both login.html and admin/login.html can use it the same way.
(function () {
    function Lockout(key, opts) {
        opts = opts || {};
        var MAX_ATTEMPTS = opts.maxAttempts || 5;
        var BASE_MS = opts.baseMs || 30000; // first lockout: 30 seconds
        var MAX_MS = opts.maxMs || 5 * 60 * 1000; // never more than 5 minutes
        var STORE_KEY = 'vhmart-lockout:' + key;

        function read() {
            try {
                var value = JSON.parse(localStorage.getItem(STORE_KEY));
                return value && typeof value === 'object' ? value : { fails: 0, until: 0 };
            } catch (e) { return { fails: 0, until: 0 }; }
        }
        function write(state) { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ } }
        function secondsLeft() {
            var state = read();
            var left = Math.ceil((state.until - Date.now()) / 1000);
            return left > 0 ? left : 0;
        }

        return {
            secondsLeft: secondsLeft,
            recordFailure: function () {
                var state = read();
                state.fails = (state.fails || 0) + 1;
                if (state.fails >= MAX_ATTEMPTS) {
                    var extra = state.fails - MAX_ATTEMPTS;
                    var waitMs = Math.min(BASE_MS * Math.pow(2, extra), MAX_MS);
                    state.until = Date.now() + waitMs;
                }
                write(state);
                return secondsLeft();
            },
            recordSuccess: function () { write({ fails: 0, until: 0 }); }
        };
    }

    // Disables `button` and counts down inside `messageEl` until the lockout clears,
    // then re-enables the button and returns. `label(seconds)` builds the message text.
    function countdown(button, messageEl, seconds, label) {
        button.disabled = true;
        var remaining = seconds;
        messageEl.textContent = label(remaining);
        var timer = setInterval(function () {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(timer);
                button.disabled = false;
                messageEl.textContent = '';
                return;
            }
            messageEl.textContent = label(remaining);
        }, 1000);
    }

    window.VHMARTLockout = { create: Lockout, countdown: countdown };
})();
