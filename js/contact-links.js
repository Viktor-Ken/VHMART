// Link validation for vendor-supplied contact details.
//
// Kept free of Firebase and the DOM so it can be unit tested directly: this is
// the part that decides what URL a customer's click ends up at, and it handles
// values that came from a public sign-up form.
//
// A vendor-submitted value is untrusted input used as a link target. An href of
// `javascript:alert(1)` or `data:text/html,...` would execute on our own origin
// the moment a customer clicked, so nothing outside a strict allow-list is
// allowed through. Values are validated, never sanitised: there is no legitimate
// contact channel that needs an exotic scheme, so discarding is simpler and
// safer than trying to rewrite it.

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

const LABELS = {
  whatsapp: 'WhatsApp',
  phone: 'Phone',
  email: 'Email',
  facebook: 'Facebook',
  instagram: 'Instagram',
  twitter: 'X (Twitter)',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  website: 'Website'
};

// Order the panel presents, most direct first.
const ORDER = ['whatsapp', 'phone', 'email', 'facebook', 'instagram', 'twitter', 'tiktok', 'youtube', 'linkedin', 'website'];

// A social link must point at that network, otherwise a vendor could label a
// link "Facebook" and send customers anywhere.
const SOCIAL_HOSTS = {
  facebook: ['facebook.com', 'fb.com', 'm.facebook.com'],
  instagram: ['instagram.com'],
  twitter: ['twitter.com', 'x.com'],
  tiktok: ['tiktok.com'],
  youtube: ['youtube.com', 'youtu.be'],
  linkedin: ['linkedin.com']
};

// Nigeria and most countries write a trunk 0 in front of the national number.
// It must not survive into international format: +234 0803... is not a valid
// number, and it is the single easiest way for a vendor to break their own
// contact links by typing the number the way they always write it.
const TRUNK_ZERO = /^0+/;

// Digits only, with any international access prefix removed. `00` is how most
// of the world writes a country code outside the + form, so it is normalised
// away here rather than being read as part of the number.
export function phoneDigits(raw) {
  let digits = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits;
}

function looksInternational(raw) {
  const value = String(raw == null ? '' : raw).trim();
  return value.startsWith('+') || value.replace(/\D/g, '').startsWith('00');
}

// Combines a selected dialling code with a locally typed number and returns
// international form (+2348031234567), which is what tel: and wa.me need.
//
// Being forgiving matters more than being strict here: a vendor who types a
// trunk 0, or pastes a number that already carries the country code, must still
// end up with a link that works.
export function joinPhone(code, local) {
  const localDigits = phoneDigits(local);
  if (!localDigits) return '';

  // Already international - honour what was typed and ignore the selector
  // rather than producing +234234803...
  if (looksInternational(local)) return `+${localDigits}`;

  const codeDigits = phoneDigits(code);
  if (!codeDigits) return localDigits;
  // Already carries the country code.
  if (localDigits.startsWith(codeDigits)) return `+${localDigits}`;
  return `+${codeDigits}${localDigits.replace(TRUNK_ZERO, '')}`;
}

// Preselects a country-code <select> to match a number that is already stored,
// so opening an existing vendor profile does not silently reset their country to
// the default. Longest codes are tried first so +1 never shadows a longer match.
export function selectCountryFor(select, stored) {
  if (!select || !select.options) return false;
  const digits = phoneDigits(stored);
  if (!digits) return false;

  const codes = [...select.options]
    .map((option) => phoneDigits(option.value))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const code of codes) {
    if (digits.startsWith(code)) {
      select.value = `+${code}`;
      return true;
    }
  }
  return false;
}

function isKnownSocialHost(hostname, key) {
  const allowed = SOCIAL_HOSTS[key];
  if (!allowed) return false;
  const host = hostname.toLowerCase();
  return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

// Returns a safe URL for a vendor-supplied value, or null when it must not be
// used as a link target.
export function safeContactUrl(key, raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value || value.length > 300) return null;

  if (key === 'email') {
    // A bare address only: no display name, so no header injection, and no
    // separators, so a single value cannot smuggle a second recipient.
    if (!/^[^\s@,;:<>()[\]\\"]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value)) return null;
    return `mailto:${value}`;
  }

  if (key === 'phone' || key === 'whatsapp') {
    const digits = phoneDigits(value);
    if (digits.length < 7 || digits.length > 15) return null;
    // wa.me needs the bare country code and national number with no punctuation.
    // tel: keeps the + so a dialer reads it as international rather than local.
    return key === 'whatsapp' ? `https://wa.me/${digits}` : `tel:${looksInternational(value) ? '+' : ''}${digits}`;
  }

  // A vendor who types "facebook.com/chelsy" means exactly that address, so a
  // missing scheme is filled in rather than treated as a bad value. Rejecting it
  // instead meant perfectly good links silently vanished from the panel.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (!SAFE_SCHEMES.has(parsed.protocol)) return null;
  if (key !== 'website' && !isKnownSocialHost(parsed.hostname, key)) return null;
  // A dotless host parses but cannot resolve. Left in, it becomes a button that
  // goes nowhere, which is worse for the vendor than not showing it at all.
  if (!parsed.hostname.includes('.')) return null;
  // A bare http link is upgraded: contact links should not be downgradable.
  return parsed.protocol === 'http:' ? `https://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
}

// Builds the selectable channel list from a vendor record, skipping anything
// that fails validation.
export function contactChannels(vendor) {
  if (!vendor || typeof vendor !== 'object') return [];
  const channels = [];
  for (const key of ORDER) {
    const url = safeContactUrl(key, vendor[key]);
    if (!url) continue;
    channels.push({ key, label: LABELS[key] || key, url, raw: String(vendor[key]).trim() });
  }
  return channels;
}

// Prefills the outgoing message on channels that support it, so the vendor is
// not dropped into a blank chat with no idea which product prompted it.
//
// Only wa.me and mailto accept a body. A social or website link cannot carry
// one, and tel: cannot either, so those are returned unchanged.
export function withPrefilledMessage(url, message) {
  const text = String(message == null ? '' : message).replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!text) return url;
  if (url.startsWith('https://wa.me/')) {
    return `${url}?text=${encodeURIComponent(text)}`;
  }
  if (url.startsWith('mailto:')) {
    return `${url}?subject=${encodeURIComponent('VHMART enquiry')}&body=${encodeURIComponent(text)}`;
  }
  return url;
}

export { LABELS, ORDER };