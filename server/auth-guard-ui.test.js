const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('auth guard wraps fetch once and redirects 401 to login', () => {
  const guard = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'auth-guard.js'), 'utf8');

  assert.match(guard, /const originalFetch = window\.fetch/);
  assert.match(guard, /window\.fetch = function \(...args\)/);
  assert.match(guard, /response\.status === 401/);
  assert.match(guard, /location\.replace\('\/'\)/);
  assert.match(guard, /return response/);
});

test('control page delegates 401 handling to the shared auth guard without an inline patch', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');

  const textTag = html.indexOf('assets/js/text.js');
  const guardTag = html.indexOf('assets/js/auth-guard.js');
  const dataCacheTag = html.indexOf('assets/js/data-cache.js');

  assert.ok(guardTag !== -1, 'control.html must reference assets/js/auth-guard.js');
  assert.ok(textTag !== -1 && textTag < guardTag, 'text.js must stay first');
  assert.ok(guardTag < dataCacheTag, 'auth-guard must execute before data-cache issues requests');
  assert.doesNotMatch(html, /<script>\s*\(function \(\) \{\s*const originalFetch/);
});
