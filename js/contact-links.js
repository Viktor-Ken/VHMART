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
    const digits = value.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return null;
    return key === 'whatsapp' ? `https://wa.me/${digits}` : `tel:${digits}`;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!SAFE_SCHEMES.has(parsed.protocol)) return null;
  if (key !== 'website' && !isKnownSocialHost(parsed.hostname, key)) return null;
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

export { LABELS, ORDER };