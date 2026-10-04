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

## Hosting (Cloudflare Pages)

The static site is served by Cloudflare Pages. Firebase still provides Authentication, Realtime Database and Storage; only the static host moved.

- **Build command:** `npm run publish:prepare`
- **Build output directory:** `public`
- **Root directory:** repository root

No dependency install is needed for the build. `scripts/build-publish.js`, `scripts/build-seo.js`, `scripts/seo-heads.js`, `scripts/seo-check.js` and `scripts/check-publish.js` import only Node builtins, so the build works in a clean checkout with no `node_modules`. `npm install` is still required locally for the emulator, rules tests and Playwright.

`publish:prepare` is idempotent: it rewrites nothing when the catalogue has not changed, so a build does not leave the working tree dirty.

The build publishes `public/`, which stages only site files. This is deliberate. Uploading a folder publishes its whole contents, and during the earlier Netlify setup both `.netlifyignore` and `.gitignore` were ignored during upload, which exposed `firebase/database.rules.json` and `package.json`. `scripts/check-publish.js` fails the build if any such path appears in the output.

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
