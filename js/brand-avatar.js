(function () {
    const depth = (location.pathname.match(/\//g) || []).length - 1;
    const base = depth > 0 ? '../'.repeat(depth) : '';
    const logo = base + 'Visuamall/logo.webp';
    const avatar = document.createElement('button');
    avatar.type = 'button';
    avatar.id = 'brandAvatar';
    avatar.className = 'brand-avatar';
    avatar.setAttribute('aria-label', 'Open VisuaHealth Market logo');
    const thumb = document.createElement('img');
    // Not lazy: this sits in the site header and is visible immediately. A
    // loading="lazy" here deferred a 5 KB image that was on screen from the first
    // frame, and it was the last request to finish before first paint. The page
    // preloads it in the head instead, so it is already in flight by the time
    // this script runs. The enlarged copy inside the hidden popup keeps its own
    // lazy behaviour, since it is not shown until the visitor clicks.
    thumb.src = logo; thumb.alt = 'VisuaHealth Market logo';
    thumb.decoding = 'async';
    avatar.append(thumb);
    const popup = document.createElement('div');
    popup.id = 'avatarPopup';
    popup.className = 'avatar-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-label', 'VisuaHealth Market logo');
    popup.hidden = true;
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'avatar-popup-close'; close.setAttribute('aria-label', 'Close'); close.textContent = '×';
    const big = document.createElement('img');
    // Stays lazy: this copy is only shown after the visitor clicks the logo, so
    // fetching the larger asset on every page view would waste bandwidth for
    // something most visitors never open.
    big.src = logo; big.alt = 'VisuaHealth Market logo'; big.loading = 'lazy'; big.decoding = 'async';
    popup.append(close, big);
    function openPopup() { popup.hidden = false; }
    function closePopup() { popup.hidden = true; }
    close.addEventListener('click', closePopup);
    document.addEventListener('click', (event) => {
        if (popup.hidden) return;
        if (event.target.closest && event.target.closest('.avatar-popup, #brandAvatar')) return;
        closePopup();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePopup(); });
    let brand = document.querySelector('.live-logo, .brand');
    if (!brand) {
        const header = document.createElement('header');
        header.className = 'site-header';
        const nav = document.createElement('nav');
        nav.className = 'nav';
        const link = document.createElement('a');
        link.className = 'brand';
        link.href = base + 'index.html';
        link.textContent = 'VHMART';
        nav.append(link);
        header.append(nav);
        const main = document.querySelector('main') || document.body.firstChild;
        document.body.insertBefore(header, main);
        brand = link;
    }
    brand.insertAdjacentElement('afterend', avatar);
    avatar.addEventListener('click', () => { if (popup.hidden) openPopup(); else closePopup(); });
    document.body.append(popup);
})();