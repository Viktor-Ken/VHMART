#!/usr/bin/env node
// Grant administrator access to an existing Firebase Auth account.
//
// Why this exists: admin authority lives in the `admins` node and the `admin`
// custom claim, but the rules that allow a grant to be written require the
// writer to already be an admin. The one exception is the bootstrap email while
// `admins` is still empty. If that node already holds an entry - or the account
// being granted is not the bootstrap email - there is no in-app path to the
// grant, and the owner is locked out of their own site. This is the recovery
// path, and it needs credentials the browser never has.
//
// It writes both sources of authority so the grant and the label agree:
//   admins/{uid}  - what isAdmin() and the database rules check
//   custom claims - what the admin claim check and the client token check
//
// The user's own `users/{uid}.role` is intentionally left alone. It is a display
// label, not a permission, and the admin pages now read the admins node instead.
// Changing it would also fail validation for a non-admin caller.
//
// Credentials:
//   GOOGLE_APPLICATION_CREDENTIALS - path to a service-account JSON key
//   FIREBASE_CONFIG                - the same JSON, inline
//
// Usage:
//   node scripts/grant-admin.js <email>            grant admin to an email
//   node scripts/grant-admin.js <email> --dry-run  report what would change
//   node scripts/grant-admin.js <email> --revoke   remove the grant
//
// Without credentials this exits cleanly rather than half-applying anything.

import process from 'node:process';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const revoke = argv.includes('--revoke');
const email = (argv.find((arg) => !arg.startsWith('--')) || '').trim().toLowerCase();

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: node scripts/grant-admin.js <email> [--dry-run] [--revoke]');
  process.exit(1);
}

const PROJECT_ID = 'visuamall-a620f';
const DATABASE_URL = 'https://visuamall-a620f-default-rtdb.firebaseio.com';

async function loadAdminSdk() {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const inline = process.env.FIREBASE_CONFIG;

  if (!keyFile && !inline) {
    console.error('No Admin SDK credentials found.');
    console.error('');
    console.error('Set one of:');
    console.error('  GOOGLE_APPLICATION_CREDENTIALS  path to a service-account JSON key');
    console.error('  FIREBASE_CONFIG                the same JSON, inline');
    console.error('');
    console.error('Firebase console -> Project settings -> Service accounts -> Generate new');
    console.error('private key, then point GOOGLE_APPLICATION_CREDENTIALS at the downloaded file.');
    console.error('');
    console.error('If the legacy FIREBASE_TOKEN variable is set, clear it first: the Admin SDK');
    console.error('picks it up automatically and it may not carry the right permissions.');
    process.exit(1);
  }

  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  const { getDatabase } = await import('firebase-admin/database');

  const { readFile } = await import('node:fs/promises');
  const json = keyFile ? await readFile(keyFile, 'utf8') : inline;

  // Unset the legacy variable so it cannot silently take precedence over the
  // credential we were explicitly told to use.
  delete process.env.FIREBASE_TOKEN;

  initializeApp({ credential: cert(JSON.parse(json)), databaseURL: DATABASE_URL, projectId: PROJECT_ID });
  return { auth: getAuth(), db: getDatabase() };
}

async function main() {
  console.log(`${revoke ? 'Revoke' : 'Grant'} admin for ${email} - ${dryRun ? 'DRY RUN' : 'APPLY'}`);

  const { auth, db } = await loadAdminSdk();

  // Resolve the account. An unknown email is a hard error: writing a grant to a
  // guessed uid would create an admin entry for nobody.
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (error) {
    if (String(error.code).includes('user-not-found')) {
      console.error(`No Firebase Auth account exists for ${email}.`);
      console.error('Create the account by signing in first, then re-run.');
      process.exit(1);
    }
    throw error;
  }

  console.log(`  uid: ${user.uid}`);
  console.log(`  email: ${user.email}`);
  console.log(`  currently disabled: ${user.disabled === true}`);

  if (user.disabled === true) {
    console.error('  WARNING: this account is disabled in Firebase Auth. Admin pages will still reject it.');
  }

  const entry = db.ref(`admins/${user.uid}`);
  const existing = await entry.get();
  const alreadyGranted = existing.exists();

  console.log(`  admins/${user.uid} exists: ${alreadyGranted}`);

  if (revoke) {
    if (!alreadyGranted) {
      console.log('  nothing to revoke');
      return;
    }
    if (dryRun) {
      console.log(`  would delete admins/${user.uid} and clear the admin claim`);
      return;
    }
    await entry.remove();
    // Keep any other claims (role, etc.) and drop only the admin flag.
    const claims = (await auth.getUser(user.uid)).customClaims || {};
    delete claims.admin;
    delete claims.role;
    await auth.setCustomUserClaims(user.uid, claims);
    console.log('  removed the admins entry and the admin claim');
    console.log('  the user must refresh their ID token (sign out and back in)');
    return;
  }

  if (alreadyGranted) {
    console.log('  admins entry already present; will refresh it and re-assert the claim');
  }

  if (dryRun) {
    console.log(`  would write admins/${user.uid} = { email, grantedAt }`);
    console.log('  would set custom claims { admin: true, role: admin }');
    return;
  }

  await entry.set({ email: user.email, grantedAt: Date.now() });
  console.log(`  wrote admins/${user.uid}`);

  await auth.setCustomUserClaims(user.uid, { admin: true, role: 'admin' });
  console.log('  set custom claims { admin: true, role: admin }');

  console.log('');
  console.log('Done. The user must sign out and back in to refresh their ID token.');
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  if (String(error.code).includes('permission-denied') || String(error.code).includes('UNAUTHENTICATED')) {
    console.error('The credentials lack Realtime Database and Auth admin access.');
    console.error('Check the service account role, and that FIREBASE_TOKEN is not set (the legacy');
    console.error('token env var would override the credential this script builds).');
  }
  process.exit(1);
});