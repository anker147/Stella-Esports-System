const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('notification publisher keeps target controls compact and conditional', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'notification-management.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'assets', 'css', 'notifications.css'), 'utf8');
  const publisher = html.match(/<form class="notification-publisher"[\s\S]*?<\/form>/)?.[0] || '';

  assert.match(publisher, /notification-target-heading[\s\S]*notification-target-tabs/);
  assert.match(publisher, /data-notification-target-control="identity" hidden/);
  assert.match(publisher, /data-notification-target-control="account" hidden/);
  assert.match(script, /control\.hidden = !active/);
  assert.match(script, /control\.querySelector\('select'\)\.disabled = !active/);
  assert.match(css, /\.notification-publish-fields\s*\{[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(css, /\.notification-target-tabs\s*\{[\s\S]*width: min\(100%, 330px\)/);
});
