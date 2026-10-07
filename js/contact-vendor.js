import { contactChannels, withPrefilledMessage } from './contact-links.js';

// Customer-facing "Contact vendor" panel.
//
// The customer reads the terms, ticks the agreement, and only then can they pick one
// of the vendor's own channels (phone, WhatsApp, a social page...). The channel is
// opened by this script rather than by a plain link, so there is no href to
// middle-click or copy before the terms are accepted.
//
// The terms text is loaded from the same terms-and-conditions page the footer links
// to, so there is one source of truth for the wording.

const DEFAULT_TERMS_URL = 'terms-and-conditions.html';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Copies the body of the terms page into the box. The page is first-party static
// HTML; script-like elements are stripped anyway so the box can only ever show text.
async function loadTerms(box, url) {
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const article = doc.querySelector('article');
    if (!article) throw new Error('Terms content not found');
    article.querySelectorAll('script, iframe, object, embed, style, link, form').forEach((node) => node.remove());
    box.replaceChildren(...Array.from(article.childNodes).map((node) => document.importNode(node, true)));
  } catch (error) {
    console.error('Could not load the terms inline:', error);
    const fallback = el('p', null, 'We could not show the terms here. Please open them in a new tab to read them: ');
    const link = el('a', null, 'Terms of Use');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    fallback.append(link);
    box.replaceChildren(fallback);
  }
}

// Opens a validated channel link. An anchor click is used instead of window.open so
// phone and email handlers open the same way as web links, and so browsers treat it
// as the user's own click.
function openChannel(url) {
  const anchor = document.createElement('a');
  anchor.href = url;
  if (url.startsWith('https://')) {
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  }
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Renders the panel into `mount`.
 *   vendor       the vendor record (already loaded by the page)
 *   vendorName   shown in the heading text
 *   productName  optional; used to prefill WhatsApp / email messages
 *   enquiryUrl   optional; offered when the vendor has published no channel
 *   termsUrl     optional; defaults to the site terms page
 */
export function renderContactPanel(mount, { vendor, vendorName, productName, enquiryUrl, termsUrl }) {
  const url = termsUrl || DEFAULT_TERMS_URL;
  const channels = contactChannels(vendor);

  mount.replaceChildren();
  mount.classList.add('is-open');
  mount.append(el('h2', null, 'Contact vendor'));

  if (!channels.length) {
    mount.append(el('p', 'empty', 'This vendor has not published a phone number or social link yet.'));
    if (enquiryUrl) {
      const link = el('a', 'button button--primary', 'Make an enquiry instead');
      link.href = enquiryUrl;
      mount.append(link);
    }
    return;
  }

  mount.append(el('p', 'contact-panel__hint', vendorName
    ? `Read and accept the terms below, then choose how to reach ${vendorName}.`
    : 'Read and accept the terms below, then choose how to reach the vendor.'));

  const termsBox = el('div', 'terms-box');
  termsBox.tabIndex = 0;
  termsBox.setAttribute('role', 'region');
  termsBox.setAttribute('aria-label', 'VHMART Terms of Use');
  termsBox.append(el('p', null, 'Loading the terms of use...'));
  mount.append(termsBox);
  loadTerms(termsBox, url);

  const agree = el('label', 'contact-agree');
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.id = 'agreeTerms';
  const agreeText = el('span');
  const link = el('a', null, 'Terms of Use');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  agreeText.append('I have read and I agree to the VHMART ', link, '.');
  agree.append(check, agreeText);
  mount.append(agree);

  const warning = el('p', 'error', 'Please tick the box to confirm you agree to the Terms of Use before contacting the vendor.');
  warning.hidden = true;
  warning.setAttribute('role', 'alert');
  mount.append(warning);

  const options = el('div', 'contact-options');
  options.setAttribute('role', 'group');
  options.setAttribute('aria-label', 'Ways to contact the vendor');
  const message = `Hello${vendorName ? ` ${vendorName}` : ''}, I found you on VHMART and I am interested in ${productName ? `"${String(productName).slice(0, 120)}"` : 'your products'}.`;

  const buttons = channels.map((channel) => {
    const button = el('button', 'button button--quiet contact-option');
    button.type = 'button';
    button.setAttribute('aria-disabled', 'true');
    button.append(el('span', null, channel.label));
    // Show the number or address so the customer can see what they are about to use.
    if (channel.key === 'phone' || channel.key === 'whatsapp' || channel.key === 'email') {
      button.append(el('span', 'contact-option__value', channel.raw));
    }
    button.addEventListener('click', () => {
      if (!check.checked) {
        warning.hidden = false;
        check.focus();
        check.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      warning.hidden = true;
      openChannel(withPrefilledMessage(channel.url, message));
    });
    options.append(button);
    return button;
  });
  mount.append(options);

  check.addEventListener('change', () => {
    buttons.forEach((button) => button.setAttribute('aria-disabled', check.checked ? 'false' : 'true'));
    if (check.checked) warning.hidden = true;
  });
}
