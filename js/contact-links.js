// Link building for vendor-supplied contact details.
//
// Kept free of Firebase and the DOM so it can be unit tested directly. This is the
// part that decides where a customer's click ends up, and it handles values that
// came from a vendor-edited profile form.
//
// A vendor-submitted value is untrusted input used as a link target. An href of
// `javascript:alert(1)` or `data:text/html,...` would run on our own origin the
// moment a customer clicked, so nothing outside a strict allow-list gets through.
// Values are validated, never sanitised: no real contact channel needs an exotic
// scheme, so discarding is simpler and safer than rewriting.

const SAFE_SCHEMES = new Set(['http:', 'https:']);

const LABELS = {
  whatsapp: 'WhatsApp',
  phone: 'Call',
  email: 'Email',
  facebook: 'Facebook',
  instagram: 'Instagram',
  twitter: 'X (Twitter)',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  website: 'Website'
};

// The order the panel presents, most direct first.
const ORDER = ['whatsapp', 'phone', 'email', 'facebook', 'instagram', 'twitter', 'tiktok', 'youtube', 'linkedin', 'website'];

// A social link must point at that network, otherwise a vendor could label a link
// "Facebook" and send customers anywhere.
const SOCIAL_HOSTS = {
  facebook: ['facebook.com', 'fb.com', 'fb.me'],
  instagram: ['instagram.com'],
  twitter: ['twitter.com', 'x.com'],
  tiktok: ['tiktok.com'],
  youtube: ['youtube.com', 'youtu.be'],
  linkedin: ['linkedin.com']
};

// What an "@handle" expands to, for vendors who type a handle instead of a link.
const HANDLE_BASE = {
  facebook: { base: 'https://www.facebook.com/', keepAt: false },
  instagram: { base: 'https://www.instagram.com/', keepAt: false },
  twitter: { base: 'https://x.com/', keepAt: false },
  tiktok: { base: 'https://www.tiktok.com/', keepAt: true },
  youtube: { base: 'https://www.youtube.com/', keepAt: true }
};

const DEFAULT_COUNTRY_CODE = '234'; // VHMART is a Nigerian marketplace.

function isKnownSocialHost(hostname, key) {
  const allowed = SOCIAL_HOSTS[key];
  if (!allowed) return false;
  const host = hostname.toLowerCase();
  return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

// Turns a phone number as a person types it into international digits (no plus),
// which is the form wa.me and tel: both want. Returns null when it cannot be one.
//
//   +2348027187963   -> 2348027187963
//   08027187963      -> 2348027187963   (Nigerian local format)
//   +23408027187963  -> 2348027187963   (trunk zero typed after the country code)
//   8027187963       -> 2348027187963   (Nigerian mobile without the leading 0)
export function normalisePhone(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value || value.length > 40) return null;
  const international = value.startsWith('+');
  let digits = value.replace(/\D/g, '');
  if (!international) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (digits.startsWith('0')) digits = DEFAULT_COUNTRY_CODE + digits.slice(1);
    else if (digits.length === 10 && /^[789]/.test(digits)) digits = DEFAULT_COUNTRY_CODE + digits;
  }
  if (digits.startsWith(`${DEFAULT_COUNTRY_CODE}0`)) digits = DEFAULT_COUNTRY_CODE + digits.slice(DEFAULT_COUNTRY_CODE.length + 1);
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

// Accepts what a vendor would actually type: a full link, a bare domain
// ("facebook.com/mypage") or an "@handle" for the networks that have them.
function parseWebValue(key, raw) {
  let value = String(raw).trim();
  const handle = HANDLE_BASE[key];
  if (handle && /^@[A-Za-z0-9._-]{1,60}$/.test(value)) {
    value = handle.base + (handle.keepAt ? value : value.slice(1));
  }
  // Anything that already carries a scheme is parsed as-is, so a hostile scheme is
  // seen and rejected rather than being quietly prefixed with https://.
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) value = `https://${value.replace(/^\/+/, '')}`;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// Returns a safe URL for a vendor-supplied value, or null when it must not be used
// as a link target.
export function safeContactUrl(key, raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value || value.length > 300) return null;

  if (key === 'email') {
    // A bare address only: no display name (so no header injection) and no
    // separators (so one value cannot smuggle in a second recipient).
    if (!/^[^\s@,;:<>()[\]\\"]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value)) return null;
    return `mailto:${value}`;
  }

  if (key === 'phone' || key === 'whatsapp') {
    const digits = normalisePhone(value);
    if (!digits) return null;
    return key === 'whatsapp' ? `https://wa.me/${digits}` : `tel:+${digits}`;
  }

  const parsed = parseWebValue(key, value);
  if (!parsed || !SAFE_SCHEMES.has(parsed.protocol)) return null;
  if (!parsed.hostname.includes('.')) return null;
  if (key !== 'website' && !isKnownSocialHost(parsed.hostname, key)) return null;
  // Contact links are always https, so a plain http link is upgraded.
  parsed.protocol = 'https:';
  return parsed.href;
}

// Builds the selectable channel list from a vendor record, skipping anything that
// fails validation.
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

// Prefills the outgoing message on channels that support one, so the vendor is not
// dropped into a blank chat with no idea which product prompted it. Only wa.me and
// mailto accept a body; every other link is returned unchanged.
export function withPrefilledMessage(url, message) {
  const text = String(message == null ? '' : message).replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!text) return url;
  if (url.startsWith('https://wa.me/')) return `${url}?text=${encodeURIComponent(text)}`;
  if (url.startsWith('mailto:')) return `${url}?subject=${encodeURIComponent('VHMART enquiry')}&body=${encodeURIComponent(text)}`;
  return url;
}

export { LABELS, ORDER };
