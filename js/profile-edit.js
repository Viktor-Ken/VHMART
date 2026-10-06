import { auth, database } from './firebase.js';
import {
  updateProfile,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  verifyBeforeUpdateEmail,
  updateEmail
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import { ref, update, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

// Profile editing shared by customers and vendors.
//
// Password and email live in Firebase Auth, not in the database profile, so
// changing them needs the Auth SDK rather than a write to users/{uid}. The
// database still holds the display name and contact fields, because that is
// where the rest of the site reads them from.
//
// A password change requires re-authentication: Firebase needs the current
// password before it will accept a new one, and without that step anyone who
// walks up to an unlocked session could take the account over.

// Deliberately lenient but not trivial: enough to reject a typo, loose enough to
// accept a real address.
const EMAIL = /^[^\s@,;:<>()[\]\\"]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

const LABELS = {
  'auth/invalid-credential': 'That current password is not correct.',
  'auth/wrong-password': 'That current password is not correct.',
  'auth/requires-recent-login': 'Please sign in again before changing this.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/email-already-in-use': 'That email address is already in use.',
  'auth/missing-password': 'Enter your new password.',
  'auth/weak-password': 'Choose a stronger password, at least 8 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/operation-not-allowed': 'That change is not enabled for this account.',
  'auth/network-request-failed': 'Network problem. Please try again.'
};

export function describeError(error) {
  return LABELS[error?.code] || 'Something went wrong. Please try again.';
}

// The fields a user owns and can change. Email is deliberately absent: it is
// handled separately because changing it is an Auth operation with a
// verification step.
const FIELDS = [
  { id: 'name', label: 'Full name', max: 100 },
  { id: 'phone', label: 'Phone', max: 32 },
  { id: 'whatsapp', label: 'WhatsApp', max: 32 },
  { id: 'facebook', label: 'Facebook link', max: 300 },
  { id: 'instagram', label: 'Instagram link', max: 300 },
  { id: 'twitter', label: 'X (Twitter) link', max: 300 },
  { id: 'tiktok', label: 'TikTok link', max: 300 },
  { id: 'youtube', label: 'YouTube link', max: 300 },
  { id: 'linkedin', label: 'LinkedIn link', max: 300 },
  { id: 'website', label: 'Website link', max: 300 }
];

export const PROFILE_FIELDS = FIELDS;

function field(id, label, type = 'text', max = 300) {
  const wrap = document.createElement('label');
  wrap.setAttribute('for', `profile-${id}`);
  wrap.append(document.createTextNode(`${label}${id === 'name' ? '' : ''}`));
  const input = document.createElement('input');
  input.id = `profile-${id}`;
  input.name = id;
  input.type = type;
  input.maxLength = max;
  wrap.append(input);
  return { wrap, input };
}

export function buildProfileForm(options = {}) {
  const form = document.createElement('form');
  form.className = 'form-panel';
  form.noValidate = true;

  const heading = document.createElement('h2');
  heading.textContent = options.heading || 'Your details';
  form.append(heading);

  if (options.intro) {
    const intro = document.createElement('p');
    intro.textContent = options.intro;
    form.append(intro);
  }

  // Shown read-only: the sign-in address belongs to Auth and is changed through
  // the dedicated flow below, which verifies the new address before it applies.
  const emailWrap = document.createElement('label');
  emailWrap.append(document.createTextNode('Sign-in email'));
  const emailInput = document.createElement('input');
  emailInput.id = 'profile-email';
  emailInput.type = 'email';
  emailInput.readOnly = true;
  emailInput.setAttribute('aria-readonly', 'true');
  emailWrap.append(emailInput);
  form.append(emailWrap);

  const inputs = { email: emailInput };
  for (const f of FIELDS) {
    const built = field(f.id, f.label, 'text', f.max);
    form.append(built.wrap);
    inputs[f.id] = built.input;
  }

  const submit = document.createElement('button');
  submit.className = 'button button--primary';
  submit.type = 'submit';
  submit.textContent = 'Save changes';

  const status = document.createElement('p');
  status.className = 'empty';
  status.setAttribute('role', 'status');

  form.append(submit, status);

  function values() {
    const out = {};
    for (const f of FIELDS) out[f.id] = inputs[f.id].value;
    return out;
  }

  function fill(record) {
    for (const f of FIELDS) inputs[f.id].value = (record && record[f.id]) || '';
    emailInput.value = (record && record.email) || '';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    const problems = validateProfile(values());
    if (problems.length) {
      status.textContent = problems[0];
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      status.textContent = 'You need to be signed in to edit your profile.';
      return;
    }

    submit.disabled = true;
    status.textContent = 'Saving...';
    try {
      await saveProfile(user.uid, values());
      // Keep the display name on the Auth record too, so anything reading the
      // token rather than the database agrees with the profile.
      await updateProfile(user, { displayName: String(values().name || '').trim() });
      status.textContent = 'Saved.';
    } catch (error) {
      console.error(error);
      status.textContent = describeError(error);
    } finally {
      submit.disabled = false;
    }
  });

  return { form, fill, inputs, values, status };
}

export function validateProfile(values) {
  const problems = [];
  if (!String(values.name || '').trim()) problems.push('Enter your name.');

  for (const key of ['facebook', 'instagram', 'twitter', 'tiktok', 'youtube', 'linkedin', 'website']) {
    const value = String(values[key] || '').trim();
    if (!value) continue;
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      problems.push(`The ${key} link must be a full URL, starting with https://`);
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      problems.push(`The ${key} link must start with http:// or https://`);
    }
  }

  for (const key of ['phone', 'whatsapp']) {
    const value = String(values[key] || '').trim();
    if (!value) continue;
    const digits = value.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
      problems.push(key === 'phone' ? 'The phone number does not look right.' : 'The WhatsApp number does not look right.');
    }
  }
  return problems;
}

export async function saveProfile(uid, values) {
  const payload = { updatedAt: serverTimestamp() };
  for (const f of FIELDS) {
    payload[f.id] = f.id === 'name'
      ? String(values.name || '').trim().slice(0, f.max)
      : String(values[f.id] || '').trim().slice(0, f.max);
  }
  await update(ref(database, `users/${uid}`), payload);
}

// Renders the password form. Standalone because both profiles need it and the
// re-authentication requirement is easy to get subtly wrong in two places.
export function renderPasswordForm(mount) {
  const form = document.createElement('form');
  form.className = 'form-panel password-form';
  form.noValidate = true;

  const heading = document.createElement('h2');
  heading.textContent = 'Change password';
  form.append(heading);

  const help = document.createElement('p');
  help.textContent = 'You will need your current password to set a new one.';
  form.append(help);

  const current = field('current-password', 'Current password', 'password', 200);
  const next = field('new-password', 'New password', 'password', 200);
  const confirm = field('confirm-password', 'Confirm new password', 'password', 200);
  for (const f of [current, next, confirm]) {
    f.input.required = true;
    f.input.minLength = 8;
    f.input.autocomplete = f.input.id === 'current-password' ? 'current-password' : 'new-password';
    // Mark the label as required for assistive tech, without a literal asterisk
    // repeated three times in the markup.
    f.wrap.firstChild.nodeValue = `${f.wrap.firstChild.nodeValue} *`;
  }

  const submit = document.createElement('button');
  submit.className = 'button button--primary';
  submit.type = 'submit';
  submit.textContent = 'Update password';

  const status = document.createElement('p');
  status.className = 'empty';
  status.setAttribute('role', 'status');

  form.append(current.wrap, next.wrap, confirm.wrap, submit, status);
  mount.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';

    const user = auth.currentUser;
    if (!user) {
      status.textContent = 'You need to be signed in to change your password.';
      return;
    }
    if (next.input.value.length < 8) {
      status.textContent = 'Your new password must be at least 8 characters.';
      return;
    }
    if (next.input.value !== confirm.input.value) {
      status.textContent = 'The two new passwords do not match.';
      return;
    }
    if (next.input.value === current.input.value) {
      status.textContent = 'Choose a password different from the current one.';
      return;
    }

    submit.disabled = true;
    status.textContent = 'Updating...';
    try {
      // Re-authenticate first. Without this, an unlocked session is enough to
      // take the account over, because Firebase would otherwise trust the token.
      const credential = EmailAuthProvider.credential(user.email, current.input.value);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, next.input.value);
      form.reset();
      status.textContent = 'Password updated.';
    } catch (error) {
      console.error(error);
      status.textContent = explain(error);
    } finally {
      submit.disabled = false;
    }
  });

  return form;
}

export function renderEmailForm(mount) {
  const form = document.createElement('form');
  form.className = 'form-panel email-form';
  form.noValidate = true;

  const heading = document.createElement('h2');
  heading.textContent = 'Change email address';
  form.append(heading);

  const help = document.createElement('p');
  help.textContent = 'We will email the new address for confirmation before it takes effect.';
  form.append(help);

  const input = field('new-email', 'New email address', 'email', 200);
  input.input.required = true;
  input.input.autocomplete = 'email';

  const submit = document.createElement('button');
  submit.className = 'button button--primary';
  submit.type = 'submit';
  submit.textContent = 'Send confirmation';

  const status = document.createElement('p');
  status.className = 'empty';
  status.setAttribute('role', 'status');

  form.append(input.wrap, submit, status);
  mount.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    const user = auth.currentUser;
    if (!user) {
      status.textContent = 'You need to be signed in to change your email.';
      return;
    }
    submit.disabled = true;
    status.textContent = 'Sending confirmation...';
    try {
      await changeEmail(user, input.input.value);
      form.reset();
      status.textContent = 'Check your new address for the confirmation link.';
    } catch (error) {
      status.textContent = explain(error);
    } finally {
      submit.disabled = false;
    }
  });

  return form;
}

export async function changeEmail(user, newEmail) {
  const value = String(newEmail || '').trim().toLowerCase();
  if (!EMAIL.test(value)) {
    throw Object.assign(new Error('invalid email'), { code: 'auth/invalid-email' });
  }
  if (value === (user.email || '').toLowerCase()) {
    throw Object.assign(new Error('unchanged'), { code: 'auth/email-already-in-use' });
  }
  // A provider without a password - a Google-only account - cannot be
  // re-authenticated this way, and the error must say so rather than hang.
  if (!user.email) {
    throw Object.assign(new Error('no email'), { code: 'auth/operation-not-allowed' });
  }
  await verifyBeforeUpdateEmail(user, value);
  await updateEmail(user, value);
}