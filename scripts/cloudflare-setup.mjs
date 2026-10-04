// Prepare the Cloudflare side of the vhmart.online move: create the Pages
// project, then attach the custom domain.
//
// This script does NOT switch nameservers. That step lives at the registrar
// (Namecheap) and is deliberately a separate, human-confirmed action because it
// is the only irreversible part: if the Cloudflare side is wrong, delegation
// points at a zone that serves nothing and the site stays down.
//
// Credentials, if set:
//   CLOUDFLARE_API_TOKEN   scoped to Zone:DNS:Edit + Zone:Zone:Read
//   CLOUDFLARE_ACCOUNT_ID  the account that will own the Pages project
//
// Run: node scripts/cloudflare-setup.mjs --dry-run   (default; changes nothing)
//      node scripts/cloudflare-setup.mjs --apply

import { readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZONE_NAME = 'vhmart.online';
const DOMAIN = 'vhmart.online';
const PROJECT = process.env.CLOUDFLARE_PAGES_PROJECT || 'vhmart';

const apply = process.argv.includes('--apply');
const log = (message) => console.log(`  ${message}`);

function requireToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    console.error('Missing CLOUDFLARE_API_TOKEN and/or CLOUDFLARE_ACCOUNT_ID.');
    console.error('Run with --dry-run to see the plan without credentials.');
    process.exit(1);
  }
  return { token, account };
}

async function api(pathname, { token, method = 'GET', body } = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${pathname} returned HTTP ${response.status}, not JSON: ${text.slice(0, 200)}`);
  }
  if (!json.success) {
    const errors = (json.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ');
    throw new Error(`${method} ${pathname} failed - ${errors || `HTTP ${response.status}`}`);
  }
  return json.result;
}

// The Pages project builds from this repo. Cloudflare reads the build settings
// from the dashboard or the API; wrangler.toml only tells wrangler where the
// output is, so the build command has to be set here explicitly.
const BUILD_SETTINGS = {
  build_command: 'npm run publish:prepare',
  // No dependency install: every script in the publish pipeline imports only Node
  // builtins, verified in a clean clone with no node_modules.
  // destination_dir: 'public',
  root_dir: '',
  skip_dependencies_installation: true
};

async function main() {
  console.log(`Cloudflare setup for ${ZONE_NAME} - ${apply ? 'APPLY' : 'DRY RUN'}`);

  // Fail early and clearly if the build output is not staged, rather than
  // creating a project that would serve an empty directory.
  if (!existsSync(path.join(root, 'public', 'index.html'))) {
    throw new Error('public/index.html is missing. Run "npm run publish:prepare" first.');
  }
  log('publish output present');

  // The Google Search Console verification file must survive the move or the
  // property loses its verification.
  const verification = path.join(root, 'public', 'bb655a6631c7b369a1312173279cf045.txt');
  if (existsSync(verification)) {
    log('Search Console verification file present in publish output');
  } else {
    log('WARNING: Search Console verification file not in publish output');
  }

  if (!apply) {
    log('no credentials needed for a dry run');
    log(`would create Pages project "${PROJECT}" from Viktor-Ken/VHMART`);
    log(`  production branch: master`);
    log(`  build command   : ${BUILD_SETTINGS.build_command}`);
    log('  install deps    : skipped (Node builtins only)');
    log(`  output directory: public`);
    log(`would attach custom domain ${DOMAIN}`);
    log('');
    log('DNS records to create in the Cloudflare zone:');
    log(`  CNAME  ${DOMAIN}  -> ${PROJECT}.pages.dev`);
    log(`  CNAME  www        -> ${PROJECT}.pages.dev`);
    log('');
    log('NOT done here: changing nameservers at the registrar.');
    return;
  }

  const { token, account } = requireToken();

  const existing = await api(`/accounts/${account}/pages/projects/${PROJECT}`, { token })
    .then(() => true)
    .catch(() => false);

  if (existing) {
    log(`Pages project "${PROJECT}" already exists, leaving it alone`);
  } else {
    await api(`/accounts/${account}/pages/projects`, {
      token,
      method: 'POST',
      body: {
        name: PROJECT,
        production_branch: 'master',
        source: { type: 'github', config: { owner: 'Viktor-Ken', repo_name: 'VHMART', production_branch: 'master' } },
        build_config: BUILD_SETTINGS
      }
    });
    log(`created Pages project "${PROJECT}"`);
  }

  // Attaching the domain is separate from the project so an existing project is
  // never rebuilt just to add a hostname.
  const attached = await api(`/accounts/${account}/pages/projects/${PROJECT}/domains`, { token })
    .then((domains) => domains.some((d) => d.name === DOMAIN))
    .catch(() => false);

  if (attached) {
    log(`custom domain ${DOMAIN} already attached`);
  } else {
    await api(`/accounts/${account}/pages/projects/${PROJECT}/domains`, {
      token,
      method: 'POST',
      body: { name: DOMAIN }
    });
    log(`attached custom domain ${DOMAIN}`);
  }

  console.log('');
  log('Cloudflare side done. Remaining manual steps:');
  log('  1. Add the CNAME records for the apex and www in the Cloudflare zone.');
  log('  2. Change nameservers at Namecheap to the two Cloudflare nameservers.');
  log('  3. Wait for propagation, then confirm the site serves.');
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});