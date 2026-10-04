// Point vhmart.online at Cloudflare by changing the nameservers at Namecheap.
//
// This is the only irreversible step in the migration, so it is gated behind
// typing the domain name, it refuses to run unless the Cloudflare side is
// already serving, and it can restore the previous nameservers.
//
// Why setCustom and not setHosts: namecheap.domains.dns.setHosts only works on
// domains using Namecheap's own DNS (FreeDNS), and it replaces the entire record
// set in one call. vhmart.online currently uses Netlify's nameservers
// (dns1-4.p03.nsone.net), so setHosts would fail outright and would be the wrong
// tool if it worked. Changing delegation is the correct mechanism: Cloudflare
// then answers authoritatively.
//
// Credentials:
//   NAMECHEAP_API_USER   the Namecheap account username (the API user, not email)
//   NAMECHEAP_API_KEY    from Advanced -> API
//   NAMECHEAP_CLIENT_IP  optional; Namecheap whitelists API access by IP
//
// Run: node scripts/namecheap-nameservers.mjs            (shows current state)
//      node scripts/namecheap-nameservers.mjs --apply    (asks for confirmation)
//      node scripts/namecheap-nameservers.mjs --restore  (back to Netlify)

const DOMAIN = 'vhmart.online';
const SLD = 'vhmart';
const TLD = 'online';

// Where the domain is now. Kept so --restore can put it back.
const NETLIFY_NS = [
  'dns1.p03.nsone.net',
  'dns2.p03.nsone.net',
  'dns3.p03.nsone.net',
  'dns4.p03.nsone.net'
];

const apply = process.argv.includes('--apply');
const restore = process.argv.includes('--restore');
const log = (message) => console.log(`  ${message}`);

function credentials() {
  const user = process.env.NAMECHEAP_API_USER;
  const key = process.env.NAMECHEAP_API_KEY;
  if (!user || !key) {
    console.error('Missing NAMECHEAP_API_USER and/or NAMECHEAP_API_KEY.');
    process.exit(1);
  }
  return {
    user,
    params: {
      ApiUser: user,
      ApiKey: key,
      // Namecheap refuses API calls from unlisted IPs. Defaults to the value
      // Namecheap shows on the API page rather than guessing the egress IP,
      // which changes on most connections.
      ClientIp: process.env.NAMECHEAP_CLIENT_IP || ''
    }
  };
}

async function call(command, { user, params }, extra = {}) {
  const query = new URLSearchParams({ ...params, ...extra, UserName: user, Command: command });
  // The API key must not land in a URL that gets logged or echoed on error.
  const url = `https://api.namecheap.com/xml.response?${query.toString()}`;
  const response = await fetch(url, { headers: { Accept: 'application/xml' } });
  const xml = await response.text();

  if (xml.includes('Status="ERROR"') || xml.includes('<Status>ERROR</Status>')) {
    // Namecheap puts the text in <Error Number="...">, not <Message>.
    const errors = [...xml.matchAll(/<Error(?:\s+Number="([^"]*)")?>([^<]*)<\/Error>/g)]
      .map((m) => (m[1] ? `${m[1]}: ${m[2].trim()}` : m[2].trim()))
      .filter(Boolean);
    throw new Error(`${command} failed: ${errors.join('; ') || 'unknown error'}`);
  }
  if (!xml.includes('Status="OK"')) {
    throw new Error(`${command} returned an unexpected response (HTTP ${response.status}).`);
  }
  return xml;
}

async function currentNameservers({ user, params }) {
  const xml = await call('namecheap.domains.dns.getList', { user, params }, { SLD, TLD });
  const list = [...xml.matchAll(/<Nameserver>([^<]+)<\/Nameserver>/g)].map((m) => m[1]);
  if (!list.length) throw new Error('Could not read the current nameserver list.');
  return list;
}

// Refuse to cut over unless the Cloudflare project is actually serving. If it is
// not, moving delegation would take a site that is merely erroring down to one
// that returns nothing at all, which is much harder to diagnose.
async function cloudflareIsServing() {
  const project = process.env.CLOUDFLARE_PAGES_PROJECT || 'vhmart';
  const host = `${project}.pages.dev`;
  try {
    const response = await fetch(`https://${host}/`, { redirect: 'manual' });
    const body = response.status === 200 ? await response.text() : '';
    const looksRight = body.includes('<html') || body.includes('<!doctype html');
    return { host, ok: response.status === 200 && looksRight, status: response.status };
  } catch (error) {
    return { host, ok: false, status: error.message };
  }
}

async function main() {
  console.log(`Nameservers for ${DOMAIN} at Namecheap - ${restore ? 'RESTORE' : apply ? 'APPLY' : 'READ ONLY'}`);

  const creds = credentials();

  let current;
  try {
    current = await currentNameservers(creds);
  } catch (error) {
    console.error(`\n${error.message}`);
    console.error('');
    console.error('If this is an IP whitelist error, add your current public IP under');
    console.error('Namecheap -> Advanced -> API -> Add IP. It changes often on most connections.');
    process.exit(1);
  }
  log(`current: ${current.join(', ')}`);

  const isNetlify = NETLIFY_NS.every((ns) => current.includes(ns));
  log(isNetlify ? 'on Netlify nameservers' : 'not on the Netlify nameservers listed in this script');

  if (!apply && !restore) {
    const check = await cloudflareIsServing();
    log(`Cloudflare project ${check.host}: HTTP ${check.status}${check.ok ? ' and serving HTML' : ' - not serving'}`);
    log('');
    log(restore
      ? `To restore: --restore  (back to ${NETLIFY_NS[0]} etc)`
      : `To move: --apply, after adding ${DOMAIN} to Cloudflare and creating the CNAMEs.`);
    return;
  }

  const target = restore ? NETLIFY_NS : null;

  if (apply) {
    const check = await cloudflareIsServing();
    log(`checking ${check.host}: HTTP ${check.status}`);
    if (!check.ok) {
      console.error('');
      console.error(`Refusing to switch nameservers: ${check.host} is not serving the site.`);
      console.error('Delegating to Cloudflare before it serves would take the site fully down.');
      console.error('Create the project and confirm it responds, then re-run.');
      process.exit(1);
    }

    // Two Cloudflare nameservers, read from the zone rather than assumed.
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) {
      console.error('Missing CLOUDFLARE_API_TOKEN, needed to read the assigned nameservers.');
      process.exit(1);
    }
    const zones = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${DOMAIN}`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then((r) => r.json());
    const zone = zones.result && zones.result[0];
    if (!zone) {
      console.error(`No Cloudflare zone named ${DOMAIN}. Add the domain in the dashboard first.`);
      process.exit(1);
    }
    const assigned = zone.name_servers;
    if (!assigned || assigned.length < 2) {
      console.error('Cloudflare did not report nameservers for this zone.');
      process.exit(1);
    }
    log(`Cloudflare assigned: ${assigned.join(', ')}`);

    await call('namecheap.domains.dns.setCustom', creds, { SLD, TLD, NamesServers: assigned.join(',') });
    log(`delegation moved to Cloudflare: ${assigned.join(', ')}`);
    log('');
    log(`Previous nameservers, for reference: ${current.join(', ')}`);
    log('To undo: node scripts/namecheap-nameservers.mjs --restore');
    return;
  }

  if (restore) {
    await call('namecheap.domains.dns.setCustom', creds, { SLD, TLD, NamesServers: target.join(',') });
    log(`restored Netlify nameservers: ${target.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});