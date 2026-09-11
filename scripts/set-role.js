#!/usr/bin/env node
import process from 'node:process';

const [uid, role] = process.argv.slice(2);
const allowed = new Set(['customer', 'vendor', 'admin']);
if (!uid || !allowed.has(role) || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) { console.error('Usage: node scripts/set-role.js <uid> customer|vendor|admin'); process.exit(1); }
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_CONFIG) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account file or FIREBASE_CONFIG to trusted Admin SDK configuration.'); process.exit(1); }
const { initializeApp, applicationDefault, cert } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const config = process.env.GOOGLE_APPLICATION_CREDENTIALS ? { credential: applicationDefault() } : { credential: cert(JSON.parse(process.env.FIREBASE_CONFIG)) };
initializeApp(config);
await getAuth().setCustomUserClaims(uid, { role, admin: role === 'admin' });
console.log(`Assigned ${role} claim to ${uid}. The user must refresh their ID token.`);
