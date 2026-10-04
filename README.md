# VHMART MVP

VHMART is a discovery marketplace for health, wellness, apparel and learning products. The customer journey is **discover, browse, search, view, contact**. It intentionally has no cart, checkout, payment, wallet, order or delivery workflow.

## Architecture

The current static HTML architecture is retained. Shared browser modules live in `js/`, shared presentation in `css/main.css`, and original imagery remains under `Visuamall/`. Firebase Authentication provides signed sessions; Realtime Database stores normalized users, vendors, products, applications and enquiries; Storage is reserved for validated image uploads.

## Firebase setup

1. Enable Email/Password Authentication.
2. Configure the existing project values in `js/firebase.js` for the intended Firebase project.
3. Deploy rules with `firebase deploy --only database,storage` after installing and logging into the Firebase CLI.
4. Provision admin custom claims and vendor claims with a trusted Admin SDK process. Never set these claims from browser code.

The web API key is a Firebase client identifier, not an authorization mechanism. Access control is enforced by rules and claims.

## Analytics

Traffic is measured without any third-party script, so no visitor data leaves the Firebase project.

- `js/track.js` is loaded on every page except `account-deleted.html`, `admin/login.html`, `admin/categories.html` and `vendor/deleted.html`. Sign-in and dead-end pages are deliberately not counted.
- `js/analytics.js` records a daily view counter, a unique-visitor flag per day, and a `page_views` log entry containing the path, a random visitor id, a coarse device class and the referrer. No IP address, no fingerprint, no email.
- Bots are filtered by user agent, and asset paths are ignored, so the counts reflect people rather than crawlers.

Read it at `/admin/analytics.html`, which plots views and unique visitors for the last 30 days. Only an admin can open that page.

Privacy boundary: the aggregate `daily` counter is publicly readable, but `unique` and `page_views` require an authenticated admin. Writes are open to anonymous visitors, because counting a visit cannot require an account, so the `.validate` rules are what constrain what can be written: a visitor row may only ever be the boolean `true`, and the view counter may only ever be a number.

## Admin access

An administrator is never created through the sign-up form, and cannot end up as a customer.

The `users` write rule restricts self-registration to exactly two roles, `customer` and `vendor`. Submitting `role: 'admin'` from a public signup form is denied by the database rules, not merely hidden in the UI. Admin identity comes from one of:

1. the `admin` custom claim, or
2. an entry in the `admins` node, or
3. the bootstrap email, but only while `admins` is still empty

`js/auth.js` exposes `requireAdmin()`, which every admin page calls before loading any data, and `firebase/database.rules.json` independently enforces the same condition on the reads and writes those pages need. Hiding a page is not the control; the rules are.

Moderation is admin-only and enforced in the rules:

| Action | Who can do it |
| --- | --- |
| approve or decline a vendor application | admin only |
| suspend or reinstate an account | admin only |
| delete an account (reversible, sets `deletedAt`) | admin only, never your own |
| restore a deleted account and its products | admin only |

A vendor can only ever create their own record as `PENDING`, and cannot move it to `ACTIVE`. An administrator cannot delete their own account, and administrators are excluded from the manageable accounts list, so the last admin cannot be locked out.

## Hosting (Cloudflare Pages)

The static site is served by Cloudflare Pages. Firebase still provides Authentication, Realtime Database and Storage; only the static host moved.

- **Build command:** `npm run publish:prepare`
- **Build output directory:** `public`
- **Root directory:** repository root

No dependency install is needed for the build. `scripts/build-publish.js`, `scripts/build-seo.js`, `scripts/seo-heads.js`, `scripts/seo-check.js` and `scripts/check-publish.js` import only Node builtins, so the build works in a clean checkout with no `node_modules`. `npm install` is still required locally for the emulator, rules tests and Playwright.

`publish:prepare` is idempotent: it rewrites nothing when the catalogue has not changed, so a build does not leave the working tree dirty.

The build publishes `public/`, which stages only site files. This is deliberate. Uploading a folder publishes its whole contents, and during the earlier Netlify setup both `.netlifyignore` and `.gitignore` were ignored during upload, which exposed `firebase/database.rules.json` and `package.json`. `scripts/check-publish.js` fails the build if any such path appears in the output.

## Moving off Netlify

Three scripts cover the move. All of them default to changing nothing and need an explicit `--apply`, because DNS and delegation are not casually reversible.

```sh
node scripts/cloudflare-setup.mjs --dry-run   # plan: project, build settings, domain
node scripts/cloudflare-dns.mjs --dry-run     # plan: the CNAMEs and what is removed
node scripts/namecheap-nameservers.mjs        # read the current delegation
```

Credentials come from the environment, never from a file in the repository:

| Variable | Needed for |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | project creation and DNS records |
| `CLOUDFLARE_ACCOUNT_ID` | project creation |
| `NAMECHEAP_API_USER` | reading and changing delegation |
| `NAMECHEAP_API_KEY` | reading and changing delegation |
| `NAMECHEAP_CLIENT_IP` | required if the IP is not already whitelisted |

Order of operations, because two of these steps depend on the one before:

1. `cloudflare-setup.mjs --apply` creates the Pages project and attaches the domain.
2. `cloudflare-dns.mjs --apply` writes the CNAMEs and removes the Netlify records.
3. Confirm `<project>.pages.dev` serves the site.
4. `namecheap-nameservers.mjs --apply` switches delegation to Cloudflare.

`namecheap-nameservers.mjs` refuses to run step 4 unless the Pages project is already serving, and `--restore` puts the previous Netlify nameservers back.

Two details worth knowing. Namecheap's `domains.dns.setHosts` is not usable here: it only works on domains using Namecheap's own DNS and it replaces the entire record set, so changing delegation with `setCustom` is the correct mechanism. And the DNS script will not delete `MX`, `TXT`, `SRV` or `CAA` records even if they exist, so a hosting move cannot silently break email.

## Data model

Use `users/{uid}`, `vendor_applications/{id}`, `vendors/{vendorId}`, `products/{productId}`, `product_images/{productId}/{imageId}`, `categories/{categoryId}`, `enquiries/{id}`, `favourites/{uid}/{productId}`, `reports/{id}` and `audit_logs/{id}`. Public reads are limited to active vendors, published products and active categories.

## Migration

Do not delete `pending_vendors` or `approved_vendors`. Export the live database first. A trusted migration script should copy vendor profile fields to `vendors`, create one product record for each valid legacy `featuredItem`, and record the source key for traceability. Review base64 images manually and upload them to Storage; do not copy them into the new database. Existing records must be verified before publishing.

## Local development and testing

Because the application uses ES modules, serve this directory through a local static server rather than opening files directly, for example `python -m http.server 8080`. Use the Firebase Emulator Suite for rules tests and a test Firebase project for Authentication and Storage tests. Never test destructive migrations against production.

Run `npm install` from the project root before using `npm run emulators`, `npm run test:rules` or `npm run test:e2e`. The repository includes rules tests and Playwright specs, but those commands require the Firebase CLI, emulator binaries and Playwright browsers to be installed. A failed or partial npm install must be repaired before interpreting those test results.

## Known environment steps

The hosted admin area uses the dedicated `admin@vhmart.com` account; vendor registration is immediate and does not use an approval queue. Keep any Firebase Admin SDK credentials outside the hosted directory. Production migration additionally requires an owner-supplied verified export and written approval of the generated migration report.


## Vendor sign-in setup
Vendor registration uses Firebase Authentication email/password for the vendor's private dashboard. In the Firebase console, enable Authentication → Sign-in method → Email/Password for the configured project. Vendor approval is not used. A successful registration immediately creates the vendor profile as ACTIVE and the first product as PUBLISHED.
