import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from '@firebase/rules-unit-testing';

const root = process.cwd();
const rules = fs.readFileSync(path.join(root, 'firebase/database.rules.json'), 'utf8');
const PROJECT = 'demo-vhmart';
const ADMIN = 'admin@vhmart.com';

let env;

const day = '2026-09-28';
const visitorA = 'a'.repeat(32);
const visitorB = 'b'.repeat(32);

// Seeds helper: writes that intentionally bypass rules.
async function seed(entries) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    const payload = {};
    for (const [key, value] of Object.entries(entries)) payload[key] = value;
    await db.ref().update(payload);
  });
}

async function fresh() {
  if (env) await env.clearDatabase();
  // A live, active customer account used as the base fixture.
  await seed({
    'users/customer1': { name: 'Casey', email: 'casey@example.com', role: 'customer', active: true },
    'users/vendor1': { name: 'Vic', email: 'vic@example.com', role: 'vendor', active: true },
    'users/vendor2': { name: 'Dana', email: 'dana@example.com', role: 'vendor', active: true },
    'vendors/vendor1': { ownerUid: 'vendor1', businessName: 'Vic Stores', categoryId: 'general', status: 'ACTIVE' },
    'vendors/vendor2': { ownerUid: 'vendor2', businessName: 'Dana Stores', categoryId: 'general', status: 'PENDING' }
  });
}

const asGuest = () => env.unauthenticatedContext().database();
const asUser = (uid, email) => env.authenticatedContext(uid, { email }).database();
const asAdmin = () => env.authenticatedContext('admin1', { email: ADMIN }).database();

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, database: { rules } });
});

test.after(async () => {
  await env.cleanup();
});

/* ------------------------------------------------------------------ */
/* 1. Vendor registration must not be self-approving                    */
/* ------------------------------------------------------------------ */

test('a new vendor account can register but cannot self-approve', async () => {
  await fresh();
  const db = asUser('newvendor', 'new@example.com');

  await assertSucceeds(
    db.ref('users/newvendor').set({ name: 'New', email: 'new@example.com', role: 'vendor', active: true }),
    'registration must be able to label the account as a vendor'
  );

  await assertFails(
    db.ref('vendors/newvendor').set({ ownerUid: 'newvendor', businessName: 'Shop', categoryId: 'general', status: 'ACTIVE' }),
    'a vendor must not be able to register directly as ACTIVE'
  );

  await assertSucceeds(
    db.ref('vendors/newvendor').set({ ownerUid: 'newvendor', businessName: 'Shop', categoryId: 'general', status: 'PENDING' })
  );

  // The role label must not become a privilege after registration.
  await assertFails(db.ref('users/newvendor').update({ role: 'admin' }), 'role must be immutable after creation');
});

test('a user cannot register themselves as an admin', async () => {
  await fresh();

  // The important case: creating the record already claiming admin, rather than
  // updating an existing customer into one. If this ever passed, the whole
  // moderation surface would be reachable from a public sign-up form.
  await assertFails(
    asUser('newadmin', 'new@example.com').ref('users/newadmin')
      .set({ name: 'Sneaky', email: 'new@example.com', role: 'admin', active: true }),
    'self-registration must not allow role admin'
  );

  // The two legitimate self-assignable roles must still work. Each needs its own
  // uid and matching token email: the rules require newData.email to equal the
  // signed-in user's email.
  await assertSucceeds(
    asUser('newcustomer', 'cust@example.com').ref('users/newcustomer')
      .set({ name: 'Casey', email: 'cust@example.com', role: 'customer', active: true }),
    'a customer must still be able to register'
  );
  await assertSucceeds(
    asUser('newvendor', 'vendor@example.com').ref('users/newvendor')
      .set({ name: 'Vic', email: 'vendor@example.com', role: 'vendor', active: true }),
    'a vendor must still be able to register'
  );

  // And nobody may plant an admin while creating someone else's record.
  await assertFails(
    asUser('attacker', 'attacker@example.com').ref('users/victim')
      .set({ name: 'Victim', email: 'victim@example.com', role: 'admin', active: true }),
    'must not create another user as admin'
  );
});

test('vendor registration succeeds when written one path at a time', async () => {
  await fresh();
  const db = asUser('newvendor', 'new@example.com');
  await assertSucceeds(db.ref('users/newvendor').set({ name: 'New', email: 'new@example.com', role: 'vendor', active: true }));
  await assertSucceeds(db.ref('vendors/newvendor').set({ ownerUid: 'newvendor', businessName: 'Shop', categoryId: 'general', status: 'PENDING' }));
});

test('only an admin can promote a pending vendor to active', async () => {
  await fresh();
  await assertFails(
    asUser('vendor2', 'dana@example.com').ref('vendors/vendor2').update({ status: 'ACTIVE' }),
    'a pending vendor must not approve themselves'
  );
  await assertSucceeds(asAdmin().ref('vendors/vendor2').update({ status: 'ACTIVE' }));
});

test('a pending vendor cannot publish products, an approved one can', async () => {
  await fresh();
  const pending = { ownerUid: 'vendor2', vendorId: 'vendor2', name: 'Pending Item', categoryId: 'general', status: 'PUBLISHED' };
  await assertFails(asUser('vendor2', 'dana@example.com').ref('products/p1').set(pending), 'pending vendors must not publish');

  const active = { ownerUid: 'vendor1', vendorId: 'vendor1', name: 'Live Item', categoryId: 'general', status: 'PUBLISHED' };
  await assertSucceeds(asUser('vendor1', 'vic@example.com').ref('products/p1').set(active));
});

/* ------------------------------------------------------------------ */
/* 2. Admin writes to another user's record (was blocked by .validate)  */
/* ------------------------------------------------------------------ */

test('an admin can approve, suspend, disable and restore another user record', async () => {
  await fresh();
  const db = asAdmin();

  await assertSucceeds(db.ref('users/vendor1').update({ active: false }), 'admin suspend');
  await assertSucceeds(db.ref('users/vendor1').update({ active: true }), 'admin restore');
  await assertSucceeds(
    db.ref('users/vendor1').update({ active: false, deletedAt: Date.now(), deletedBy: 'admin1', deleteReason: 'policy' }),
    'admin soft delete'
  );
  await assertSucceeds(
    db.ref('users/vendor1').update({ active: true, deletedAt: null }),
    'admin clear deletion marker'
  );
  await assertSucceeds(db.ref('users/vendor2').update({ role: 'customer' }), 'admin role change');
});

test('an admin approval of a vendor updates the user record', async () => {
  await fresh();
  // admin/vendors.html writes these sequentially at their exact paths. A single
  // root-scoped multi-path update is denied; see the rule-shape test below.
  await assertSucceeds(asAdmin().ref('users/vendor2').update({ active: true }));
  await assertSucceeds(asAdmin().ref('vendors/vendor2').update({ status: 'ACTIVE' }));
});

test('a root-scoped multi-path update is denied even when each child path is writable', async () => {
  await fresh();
  // Realtime Database rules cascade downwards only, so this pattern is refused.
  // Every client write must target its own exact path instead.
  await assertFails(
    asAdmin().ref().update({ 'vendors/vendor2': { status: 'ACTIVE' }, 'users/vendor2': { active: true } }),
    'root-scoped multi-path update'
  );
  await assertFails(
    asAdmin().ref('users').update({ vendor2: { active: true } }),
    'update scoped to the parent of a wildcard'
  );
  // The same write at the exact path is allowed.
  await assertSucceeds(asAdmin().ref('users/vendor2').update({ active: true }));
});

/* ------------------------------------------------------------------ */
/* 3. Self-delete (was rejected, and rolled back by audit_logs)        */
/* ------------------------------------------------------------------ */

test('a user can soft-delete their own account', async () => {
  await fresh();
  await assertSucceeds(
    asUser('customer1', 'casey@example.com').ref('users/customer1').update({
      active: false,
      deletedAt: Date.now(),
      deletedBy: 'customer1'
    })
  );
});

test('a user can update their own profile but not their identity or privilege', async () => {
  await fresh();
  const db = asUser('customer1', 'casey@example.com');

  await assertSucceeds(db.ref('users/customer1').update({ name: 'Casey Renamed', phone: '0800' }));

  await assertFails(db.ref('users/customer1').update({ email: 'attacker@example.com' }), 'email is immutable');
  await assertFails(db.ref('users/customer1').update({ role: 'admin' }), 'role must be immutable');
});

test('a disabled account cannot reactivate itself or erase its deletion marker', async () => {
  await fresh();
  await seed({
    'users/gone': { name: 'Gone', email: 'gone@example.com', role: 'customer', active: false, deletedAt: 1700000000000 }
  });
  const db = asUser('gone', 'gone@example.com');

  await assertFails(db.ref('users/gone').update({ active: true }), 'no self-reactivation');
  await assertFails(db.ref('users/gone').update({ deletedAt: null }), 'no clearing the deletion marker');
});

test('a user cannot hard delete their own record', async () => {
  await fresh();
  await assertFails(asUser('customer1', 'casey@example.com').ref('users/customer1').remove());
});

test('the self-delete flow completes and the audit entry is written', async () => {
  await fresh();
  // account.html writes these at their exact paths, account first.
  await assertSucceeds(
    asUser('customer1', 'casey@example.com').ref('users/customer1').update({
      active: false, deletedAt: Date.now(), deletedBy: 'customer1'
    })
  );
  await assertSucceeds(
    asUser('customer1', 'casey@example.com').ref('audit_logs/entry1').set({
      actor: 'customer1', action: 'self_delete_user', target: 'customer1', detail: 'Deleted by the account holder'
    })
  );
});

test('audit logging cannot be forged', async () => {
  await fresh();
  const db = asUser('customer1', 'casey@example.com');

  await assertFails(
    db.ref('audit_logs/x1').set({ actor: 'customer1', action: 'self_delete_user', target: 'vendor1' }),
    'cannot log an action against another user'
  );
  await assertFails(
    db.ref('audit_logs/x2').set({ actor: 'customer1', action: 'delete_user', target: 'customer1' }),
    'cannot forge a different action'
  );
  await assertFails(
    db.ref('audit_logs/x3').set({ actor: 'admin1', action: 'self_delete_user', target: 'admin1' }),
    'cannot impersonate the admin'
  );
  await assertSucceeds(asAdmin().ref('audit_logs/x4').set({ actor: 'admin1', action: 'delete_user', target: 'vendor1' }));
});

test('the audit log is not publicly or user readable', async () => {
  await fresh();
  await assertFails(asGuest().ref('audit_logs').once('value'));
  await assertFails(asUser('customer1', 'casey@example.com').ref('audit_logs').once('value'));
  await assertSucceeds(asAdmin().ref('audit_logs').once('value'));
});

/* ------------------------------------------------------------------ */
/* 4. Analytics (counted nothing: no read rule, homepage skipped, race) */
/* ------------------------------------------------------------------ */

test('an anonymous visitor can be counted and marked unique', async () => {
  await fresh();
  const db = asGuest();

  await assertSucceeds(db.ref(`analytics/unique/${day}/${visitorA}`).set(true));
  await assertSucceeds(db.ref(`analytics/daily/${day}/views`).set(1));
});

test('the view counter cannot be inflated by a direct write', async () => {
  await fresh();
  const db = asGuest();

  await assertFails(db.ref(`analytics/daily/${day}/views`).set(9999), 'first write must be exactly 1');
  await assertSucceeds(db.ref(`analytics/daily/${day}/views`).set(1));
  await assertFails(db.ref(`analytics/daily/${day}/views`).set(500), 'may only increment by one');
  await assertSucceeds(db.ref(`analytics/daily/${day}/views`).set(2));
  await assertFails(db.ref(`analytics/daily/${day}/views`).set(-1), 'must not go negative');
});

test('analytics day keys must be date shaped', async () => {
  await fresh();
  await assertFails(asGuest().ref('analytics/daily/junk-node/views').set(1));
  await assertFails(asGuest().ref('analytics/daily/2026-09-28-not-a-day/views').set(1));
});

test('visitor identity and page-view events are not publicly readable', async () => {
  await fresh();
  const guest = asGuest();
  await guest.ref(`analytics/unique/${day}/${visitorA}`).set(true);
  await guest.ref('analytics/page_views/e1').set({ path: '/', visitorId: visitorA });

  await assertFails(guest.ref('analytics/unique').once('value'), 'visitor ids must stay private');
  await assertFails(guest.ref(`analytics/unique/${day}`).once('value'));
  await assertFails(guest.ref('analytics/page_views').once('value'));
  await assertFails(asUser('customer1', 'casey@example.com').ref('analytics/unique').once('value'));

  await assertSucceeds(asAdmin().ref('analytics/unique').once('value'), 'admins report on traffic');
  await assertSucceeds(asAdmin().ref('analytics/page_views').once('value'));
  await assertSucceeds(asAdmin().ref('analytics/daily').once('value'));
});

test('a repeated visitor is deduped by the visitor-keyed write', async () => {
  await fresh();
  const db = asGuest();
  await db.ref(`analytics/unique/${day}/${visitorA}`).set(true);
  await db.ref(`analytics/unique/${day}/${visitorA}`).set(true);
  await db.ref(`analytics/unique/${day}/${visitorB}`).set(true);

  const snap = await asAdmin().ref(`analytics/unique/${day}`).once('value');
  assert.equal(Object.keys(snap.val()).length, 2, 'two visitors, despite three writes');
});

test('a malformed page-view event is rejected', async () => {
  await fresh();
  const db = asGuest();
  await assertFails(db.ref('analytics/page_views/bad').set({ path: 42, visitorId: visitorA }));
  await assertFails(db.ref('analytics/page_views/bad2').set({ path: '/' }), 'visitorId is required');
});

/* ------------------------------------------------------------------ */
/* 6. Admin access: granting, revoking, and self-promotion             */
/* ------------------------------------------------------------------ */

const CLAIM_ADMIN = { admin: true, role: 'admin' };

test('a normal user cannot promote themselves to admin', async () => {
  await fresh();
  const db = asUser('customer1', 'casey@example.com');
  await assertFails(db.ref('admins/customer1').set({ email: 'casey@example.com', grantedAt: Date.now() }));
  await assertFails(db.ref('users/customer1').update({ role: 'admin' }));
});

test('the bootstrap admin can grant itself, and nobody else can', async () => {
    // The deadlock this covers: isAdmin() read admins/{uid}, which the rules only
    // permitted for someone already listed there. A real administrator holding no
    // grant was therefore denied the read, never reached the bootstrap fallback,
    // and could never write their own entry to get in.
    await fresh();

    const boot = asUser('boot1', ADMIN);

    // Reading one's own entry must be allowed, so isAdmin() can find it.
    await assertSucceeds(boot.ref('admins/boot1').once('value'),
      'a user must be able to read their own admin entry');

    // And the bootstrap grant must actually succeed while admins is empty.
    await assertSucceeds(boot.ref('admins/boot1').set({ email: ADMIN, grantedAt: Date.now() }),
      'the bootstrap admin must be able to grant itself');
    await assertSucceeds(boot.ref('users/customer1').update({ active: false }),
      'the bootstrapped admin can then moderate accounts');

    // Once admins exists, the bootstrap email loses its backdoor.
    await assertFails(
      asUser('boot2', ADMIN).ref('admins/boot2').set({ email: ADMIN, grantedAt: Date.now() }),
      'the bootstrap grant must not be repeatable'
    );

    // A non-admin must still not be able to grant themselves, nor read the roster.
    const nobody = asUser('customer1', 'casey@example.com');
    await assertFails(
      nobody.ref('admins/customer1').set({ email: 'casey@example.com', grantedAt: Date.now() }),
      'a customer must not be able to grant themselves admin'
    );
    await assertFails(nobody.ref('admins').once('value'), 'the admin roster must stay private');

    // Knowing the bootstrap email must not grant read access to someone else.
    await assertFails(
      asUser('impostor', ADMIN).ref('admins/boot1').once('value'),
      'sharing the bootstrap email must not expose another admin entry'
    );
  });

  test('an admin granted through the admins node can act as an admin', async () => {
  await fresh();
  await seed({ 'admins/staff1': { email: 'staff1@vhmart.com', grantedAt: Date.now() } });
  const staff = asUser('staff1', 'staff1@vhmart.com');

  // The point of the fix: a granted admin is a real admin, not just in the UI.
  await assertSucceeds(staff.ref('admins').once('value'), 'admins node must be readable by admins');
  await assertSucceeds(staff.ref('users/customer1').update({ active: false }), 'may moderate accounts');
  await assertSucceeds(staff.ref('analytics/unique').once('value'), 'may view analytics');
  await assertSucceeds(staff.ref('vendors').once('value'), 'may review vendors');
});

test('an admin can grant and revoke admin access for someone else', async () => {
  await fresh();
  await seed({ 'admins/staff1': { email: 'staff1@vhmart.com', grantedAt: Date.now() } });
  const staff = asUser('staff1', 'staff1@vhmart.com');

  await assertSucceeds(staff.ref('admins/staff2').set({ email: 'staff2@vhmart.com', grantedAt: Date.now() }));
  await assertSucceeds(asUser('staff2', 'staff2@vhmart.com').ref('users/customer1').update({ active: false }));
  await assertSucceeds(staff.ref('admins/staff2').set(null), 'revoke by nulling the node');
  await assertFails(asUser('staff2', 'staff2@vhmart.com').ref('users/customer1').update({ active: true }));
});

test('an admin cannot remove their own access', async () => {
  await fresh();
  await seed({ 'admins/staff1': { email: 'staff1@vhmart.com', grantedAt: Date.now() } });
  await assertFails(
    asUser('staff1', 'staff1@vhmart.com').ref('admins/staff1').set(null),
    'self-revocation must be blocked in the UI and by the rules'
  );
});

test('the admin list is not readable by ordinary users', async () => {
  await fresh();
  await seed({ 'admins/staff1': { email: 'staff1@vhmart.com', grantedAt: Date.now() } });
  await assertFails(asGuest().ref('admins').once('value'));
  await assertFails(asUser('customer1', 'casey@example.com').ref('admins').once('value'));
  await assertFails(asUser('customer1', 'casey@example.com').ref('admins/staff1').once('value'));
});

test('a malformed admin entry is rejected', async () => {
  await fresh();
  await seed({ 'admins/staff1': { email: 'staff1@vhmart.com', grantedAt: Date.now() } });
  const staff = asUser('staff1', 'staff1@vhmart.com');
  await assertFails(staff.ref('admins/bad1').set({ email: 42, grantedAt: Date.now() }), 'email must be a string');
  await assertFails(staff.ref('admins/bad2').set({ email: 'x@vhmart.com' }), 'grantedAt is required');
});

test('the bootstrap email only works while no admins exist', async () => {
  await env.clearDatabase();
  const bootstrap = asUser('boss', ADMIN);
  await assertSucceeds(
    bootstrap.ref('admins/boss').set({ email: ADMIN, grantedAt: Date.now() }),
    'the first admin can bootstrap without a custom claim'
  );

  // With admins in place the email shortcut must stop granting access.
  await assertFails(
    asUser('second', ADMIN).ref('admins/second').set({ email: ADMIN, grantedAt: Date.now() }),
    'the bootstrap email must not create a second admin'
  );
});

test('a bootstrap admin becomes a full admin once listed in admins', async () => {
  await env.clearDatabase();
  await seed({ 'users/customer1': { name: 'Casey', email: 'casey@example.com', role: 'customer', active: true } });
  const bootstrap = asUser('boss', ADMIN);
  await assertSucceeds(bootstrap.ref('admins/boss').set({ email: ADMIN, grantedAt: Date.now() }));
  await assertSucceeds(bootstrap.ref('users/customer1').update({ active: false }), 'and is then a full admin');
  await assertSucceeds(bootstrap.ref('analytics/unique').once('value'));
});

test('a custom claim admin is a full admin and cannot edit its own list entry', async () => {
  await fresh();
  const claimed = env.authenticatedContext('boss', { email: 'boss@vhmart.com', admin: true, role: 'admin' }).database();
  await assertSucceeds(claimed.ref('users/customer1').update({ active: false }));
  await assertSucceeds(claimed.ref('analytics/unique').once('value'));
  await assertFails(claimed.ref('admins/boss').set(null), 'self-revocation must be blocked');
  // It can still manage other admins.
  await assertSucceeds(claimed.ref('admins/staff1').set({ email: 'staff1@vhmart.com', grantedAt: Date.now() }));
});


test('a deleted vendor and their products are no longer publicly readable', async () => {
  await fresh();
  await seed({
    'products/visible': { ownerUid: 'vendor1', vendorId: 'vendor1', name: 'Visible', categoryId: 'general', status: 'PUBLISHED' },
    'products/gone': { ownerUid: 'vendor1', vendorId: 'vendor1', name: 'Gone', categoryId: 'general', status: 'SUSPENDED', deletedAt: 1700000000000 }
  });

  await assertSucceeds(asGuest().ref('products/visible').once('value'));
  await assertFails(asGuest().ref('products/gone').once('value'), 'soft-deleted products must be private');
  await assertFails(asGuest().ref('products').orderByChild('status').equalTo('SUSPENDED').once('value'));
});

test('a soft-deleted vendor storefront is no longer publicly readable', async () => {
  await fresh();
  await assertSucceeds(asGuest().ref('vendors/vendor1').once('value'));
  await seed({
    'vendors/vendor1': { ownerUid: 'vendor1', businessName: 'Vic Stores', categoryId: 'general', status: 'SUSPENDED', deletedAt: 1700000000000 }
  });
  await assertFails(asGuest().ref('vendors/vendor1').once('value'), 'deleted vendors must be private');
  await assertSucceeds(asUser('vendor1', 'vic@example.com').ref('vendors/vendor1').once('value'), 'the owner can still see it');
});

  test('an admin can read the whole users and vendors list', async () => {
    // The accounts page reads users and vendors as whole nodes to build the
    // moderation list. A .read on users/{uid} only grants that one child, so
    // without a node-level rule the aggregate read is denied for every account
    // and the page reports "Could not load accounts" no matter who is signed in.
    await fresh();

    const admin = asAdmin();
    await assertSucceeds(admin.ref('users').once('value'), 'an admin must be able to list every account');
    await assertSucceeds(admin.ref('vendors').once('value'), 'an admin must be able to list every vendor');

    // A granted admin node entry must work too, not just the claim.
    await seed({ 'admins/staff1': { email: 'staff1@vhmart.com', grantedAt: Date.now() } });
    await assertSucceeds(
      asUser('staff1', 'staff1@vhmart.com').ref('users').once('value'),
      'an admin listed in the admins node must be able to list accounts'
    );

    // And it must stay closed to everyone else. A customer reading the whole
    // user list would expose every account, so this is the important half.
    const customer = asUser('customer1', 'casey@example.com');
    await assertFails(customer.ref('users').once('value'), 'a customer must not list every account');
    await assertFails(customer.ref('vendors').once('value'), 'a customer must not list every vendor');

    // A signed-out visitor must be refused as well.
    await assertFails(asGuest().ref('users').once('value'), 'a guest must not list accounts');

    // Reading one's own record must still work for a customer: that path does not
    // depend on the node-level rule.
    await assertSucceeds(customer.ref('users/customer1').once('value'), 'a customer must still read their own profile');
  });

test('a contact enquiry must name a real channel and record the terms acceptance', async () => {
    await fresh();
    const customer = asUser('customer1', 'casey@example.com');

    // An enquiry is only writable for a live product belonging to an active
    // vendor, so arrange exactly that rather than weakening the rule.
    await seed({ 'products/p1': { ownerUid: 'vendor1', vendorId: 'vendor1', name: 'Scrubs', categoryId: 'general', status: 'PUBLISHED' } });

    const base = {
      productId: 'p1',
      vendorId: 'vendor1',
      customerUid: 'customer1',
      message: 'Contact request for "Scrubs" via whatsapp.',
      status: 'NEW',
      createdAt: 1700000000000
    };

    // The normal path: a channel plus a terms timestamp.
    await assertSucceeds(
      customer.ref('enquiries/e1').set({ ...base, channel: 'whatsapp', termsAcceptedAt: 1700000000000 }),
      'a contact enquiry must be allowed'
    );

    // Channel is a fixed set. Free text here would be written straight to a
    // vendor-facing surface, so anything unrecognised is rejected.
    await assertFails(
      customer.ref('enquiries/e2').set({ ...base, channel: 'javascript' }),
      'an invented channel must be rejected'
    );

    // Terms acceptance must be a timestamp, not an arbitrary value.
    await assertFails(
      customer.ref('enquiries/e3').set({ ...base, channel: 'email', termsAcceptedAt: 'yes' }),
      'termsAcceptedAt must be a number'
    );

    // The acceptance is optional so pre-existing enquiries stay valid, but a
    // customer cannot forge the vendorId or productId pairing.
    await assertSucceeds(
      customer.ref('enquiries/e4').set(base),
      'an enquiry without a channel is still valid'
    );
    await assertFails(
      customer.ref('enquiries/e5').set({ ...base, vendorId: 'vendor2' }),
      'a customer must not enquire about another vendors product'
    );

    // The vendor still owns and reads their own enquiries.
    await assertSucceeds(asUser('vendor1', 'vic@example.com').ref('enquiries/e1').once('value'),
      'the vendor must be able to read the enquiry');
    // And a different vendor must not.
    await assertFails(asUser('vendor2', 'dana@example.com').ref('enquiries/e1').once('value'),
      'another vendor must not read it');
  });
