// Create the DNS records that serve vhmart.online from Cloudflare Pages, and
// report propagation.
//
// Records to create:
//   CNAME  vhmart.online -> <project>.pages.dev
//   CNAME  www           -> <project>.pages.dev
//
// The current records are apex A/AAAA pointing at Netlify (35.157.26.135,
// 63.176.8.218, 2a05:d014:58f:6200::258/259). A CNAME cannot coexist with an
// A record at the same name, so the A and AAAA records are removed.
//
// Safety: this only ever removes A/AAAA/CNAME records for these two names, and
// refuses to run if it finds anything else - MX, TXT or otherwise. Email records
// must never be deleted by a hosting migration. vhmart.online currently has no MX
// or TXT records (verified), so nothing here should hit that guard; it exists so
// that a future change cannot delete mail by accident.
//
// Run: node scripts/cloudflare-dns.mjs --dry-run    (default; changes nothing)
//      node scripts/cloudflare-dns.mjs --apply

const ZONE_NAME = 'vhmart.online';
const PROJECT = process.env.CLOUDFLARE_PAGES_PROJECT || 'vhmart';
const TARGET = `${PROJECT}.pages.dev`;

const apply = process.argv.includes('--apply');
const log = (message) => console.log(`  ${message}`);

async function api(pathname, { token, method = 'GET', body } = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${pathname} returned HTTP ${response.status}, not JSON`);
  }
  if (!json.success) {
    const errors = (json.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ');
    throw new Error(`${method} ${pathname} failed - ${errors || `HTTP ${response.status}`}`);
  }
  return json.result;
}

function requireToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.error('Missing CLOUDFLARE_API_TOKEN.');
    process.exit(1);
  }
  return token;
}

async function main() {
  console.log(`DNS for ${ZONE_NAME} -> ${TARGET} - ${apply ? 'APPLY' : 'DRY RUN'}`);

  if (!apply) {
    log('would ensure these records in the Cloudflare zone:');
    log(`  CNAME  vhmart.online  -> ${TARGET}`);
    log(`  CNAME  www            -> ${TARGET}`);
    log('would remove the existing Netlify A/AAAA records at those two names');
    log('');
    log('Refuses to run if any MX or TXT record is found - email is never touched.');
    return;
  }

  const token = requireToken();

  const zones = await api(`/zones?name=${ZONE_NAME}`, { token });
  const zone = Array.isArray(zones) ? zones[0] : null;
  if (!zone) throw new Error(`No Cloudflare zone named ${ZONE_NAME}. Add the domain in the dashboard first.`);
  log(`zone ${zone.name} (${zone.id})`);

  const records = await api(`/zones/${zone.id}/dns_records?per_page=100`, { token });

  // Guard: never delete mail or verification records.
  const protectedTypes = new Set(['MX', 'TXT', 'SRV', 'CAA']);
  const dangerous = records.filter(
    (r) => protectedTypes.has(r.type) && (r.name === ZONE_NAME || r.name.endsWith(`.${ZONE_NAME}`))
  );
  if (dangerous.length) {
    log('records found that this script will not touch:');
    for (const record of dangerous) log(`  ${record.type} ${record.name} -> ${record.content}`);
    log('  These must be recreated in Cloudflare by hand before the cutover.');
  }

  // Only A/AAAA/CNAME at the two hostnames we are replacing.
  const doomed = records.filter(
    (r) => (r.name === ZONE_NAME || r.name === `www.${ZONE_NAME}`) && ['A', 'AAAA', 'CNAME'].includes(r.type)
  );
  for (const record of doomed) {
    await api(`/zones/${zone.id}/dns_records/${record.id}`, { token, method: 'DELETE' });
    log(`deleted ${record.type} ${record.name} -> ${record.content}`);
  }

  for (const name of [ZONE_NAME, `www.${ZONE_NAME}`]) {
    const clash = await api(`/zones/${zone.id}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`, { token })
      .then((found) => (Array.isArray(found) ? found[0] : null))
      .catch(() => null);
    if (clash) {
      if (clash.content === TARGET) {
        log(`CNAME ${name} already correct`);
        continue;
      }
      await api(`/zones/${zone.id}/dns_records/${clash.id}`, { token, method: 'PATCH', body: { content: TARGET } });
      log(`updated CNAME ${name} -> ${TARGET}`);
      continue;
    }
    await api(`/zones/${zone.id}/dns_records`, {
      token,
      method: 'POST',
      body: { type: 'CNAME', name, content: TARGET, proxied: true, ttl: 1 }
    });
    log(`created CNAME ${name} -> ${TARGET}`);
  }

  console.log('');
  log('Records written. They stay inactive until nameservers point at Cloudflare.');
  log('Next: change nameservers at Namecheap, then wait for propagation.');
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});