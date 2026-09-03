const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('system messages use the shared accessible center dialog', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'system-dialog.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'assets', 'css', 'control.css'), 'utf8');

  assert.match(html, /<dialog class="confirm-dialog system-dialog" id="systemDialog"/);
  assert.match(html, /aria-labelledby="systemDialogTitle" aria-describedby="systemDialogMessage"/);
  assert.ok(html.indexOf('assets/js/system-dialog.js') < html.indexOf('assets/js/accounts.js'));
  assert.match(script, /window\.StellaDialog = Object\.freeze/);
  assert.match(script, /alert\(options\)/);
  assert.match(script, /confirm\(options\)/);
  assert.match(script, /prompt\(options\)/);
  assert.match(script, /request\.trigger\.focus\(\)/);
  assert.match(script, /dialog\?\.addEventListener\('close', finish\)/);
  assert.match(css, /\.system-dialog\[open\][\s\S]*animation: system-dialog-in/);
});

test('business scripts do not invoke native browser message dialogs', () => {
  const scriptsDirectory = path.join(root, 'public', 'assets', 'js');
  const violations = fs.readdirSync(scriptsDirectory)
    .filter(file => file.endsWith('.js') && file !== 'system-dialog.js')
    .flatMap(file => {
      const content = fs.readFileSync(path.join(scriptsDirectory, file), 'utf8');
      const nativeCall = /window\.(?:alert|confirm|prompt)\s*\(/.test(content)
        || /(^|[^.\w])(?:alert|confirm|prompt)\s*\(/m.test(content);
      return nativeCall ? [file] : [];
    });

  assert.deepEqual(violations, []);
});
