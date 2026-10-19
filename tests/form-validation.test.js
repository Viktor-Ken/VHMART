import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FORM_PAGES = [
  'login.html', 'register.html', 'enquiry.html', 'admin/login.html', 'admin/categories.html',
  'vendor/add-product.html', 'vendor/edit-product.html', 'vendor/profile.html', 'vendor/register.html'
];

test('every form page loads the field checker', () => {
  for (const page of FORM_PAGES) {
    assert.match(fs.readFileSync(page, 'utf8'), /<script src="(\.\.\/)?js\/form-validate\.js"><\/script>/, page);
  }
});

test('the field checker blocks submit and explains each field', () => {
  const code = fs.readFileSync('js/form-validate.js', 'utf8');
  assert.match(code, /addEventListener\('submit'[\s\S]*stopImmediatePropagation/);
  assert.match(code, /aria-invalid/);
  assert.match(code, /noValidate = true/);
  assert.match(fs.readFileSync('css/main.css', 'utf8'), /\.field-error/);
});

test('sign-in errors point at the email or password field', () => {
  const login = fs.readFileSync('login.html', 'utf8');
  assert.match(login, /'auth\/user-not-found':\[\['email'/);
  assert.match(login, /'auth\/wrong-password':\[\['password'/);
});
