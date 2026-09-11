(function () {
    var KEY = 'vhmart-theme';
    var theme = 'light';
    try { var saved = localStorage.getItem(KEY); if (saved === 'dark' || saved === 'light') theme = saved; } catch (e) { }
    function apply(t) { document.documentElement.setAttribute('data-theme', t); }
    apply(theme);
    function makeToggle() {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'themeToggle';
        btn.className = 'theme-toggle';
        btn.setAttribute('aria-label', 'Toggle light or dark mode');
        var icon = document.createElement('span');
        icon.className = 'theme-toggle__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = theme === 'dark' ? '☾' : '☀';
        btn.append(icon);
        btn.addEventListener('click', function () {
            theme = theme === 'dark' ? 'light' : 'dark';
            try { localStorage.setItem(KEY, theme); } catch (e) { }
            apply(theme);
            icon.textContent = theme === 'dark' ? '☾' : '☀';
        });
        return btn;
    }
    function mount() {
        var target = document.querySelector('.live-nav') || document.querySelector('.nav') || document.querySelector('body');
        var btn = makeToggle();
        target.appendChild(btn);
    }
    if (document.body) { mount(); } else { document.addEventListener('DOMContentLoaded', mount); }
})();