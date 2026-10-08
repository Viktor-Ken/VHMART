(function () {
    // Light or dark follows the visitor's device setting until they press the
    // toggle; after that their own choice is remembered and wins.
    var KEY = 'vhmart-theme';
    var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    var saved = null;
    try { var value = localStorage.getItem(KEY); if (value === 'dark' || value === 'light') saved = value; } catch (e) { }
    function systemTheme() { return media && media.matches ? 'dark' : 'light'; }
    var theme = saved || systemTheme();
    var icon;
    function apply(t) {
        theme = t;
        document.documentElement.setAttribute('data-theme', t);
        if (icon) {
            icon.textContent = t === 'dark' ? '☾' : '☀';
            icon.parentNode.setAttribute('aria-pressed', String(t === 'dark'));
        }
    }
    apply(theme);
    // Follow the device live (for example sunset auto-switching) while no choice is saved.
    if (media) {
        var onChange = function () { if (!saved) apply(systemTheme()); };
        if (media.addEventListener) media.addEventListener('change', onChange);
        else if (media.addListener) media.addListener(onChange);
    }
    function makeToggle() {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'themeToggle';
        btn.className = 'theme-toggle';
        btn.setAttribute('aria-label', 'Toggle light or dark mode');
        icon = document.createElement('span');
        icon.className = 'theme-toggle__icon';
        icon.setAttribute('aria-hidden', 'true');
        btn.append(icon);
        btn.addEventListener('click', function () {
            saved = theme === 'dark' ? 'light' : 'dark';
            try { localStorage.setItem(KEY, saved); } catch (e) { }
            apply(saved);
        });
        apply(theme);
        return btn;
    }
    function mount() {
        var target = document.querySelector('.live-nav') || document.querySelector('.nav') || document.querySelector('body');
        target.appendChild(makeToggle());
    }
    if (document.body) { mount(); } else { document.addEventListener('DOMContentLoaded', mount); }
})();
