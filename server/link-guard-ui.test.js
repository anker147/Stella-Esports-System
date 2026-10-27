const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('link guard module ships the documented detection surface', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'link-guard.js'), 'utf8');

  assert.match(source, /window\.LinkGuard = \{[\s\S]*snapshot\(\)/);
  assert.match(source, /\/api\/system\/health/);
  assert.match(source, /guards\?\.link/);
  assert.match(source, /stella:link-guard/);
  // Detection only: the guard must never rewrite or queue page assets.
  assert.doesNotMatch(source, /Image\s*\(|\.src\s*=|MutationObserver/);
});

test('control and login pages load link-guard right after text.js', () => {
  for (const page of ['control.html', 'login.html']) {
    const html = fs.readFileSync(path.join(root, 'public', page), 'utf8');
    const textTag = html.indexOf('assets/js/text.js');
    const guardTag = html.indexOf('assets/js/link-guard.js');
    assert.ok(guardTag !== -1, `${page} must reference assets/js/link-guard.js`);
    assert.ok(textTag !== -1 && textTag < guardTag, `${page} must load link-guard after text.js`);
  }

  for (const page of ['overlay.html']) {
    const html = fs.readFileSync(path.join(root, 'public', page), 'utf8');
    assert.equal(html.includes('assets/js/link-guard.js'), false, `${page} is an OBS surface and must stay guard-free`);
  }
});

test('health endpoint exposes the guard switch and settings routes stay gated', () => {
  const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');

  assert.match(server, /guards:\s*\{\s*link:\s*linkGuardSettings\(db\)\.link\s*\}/);
  assert.match(server, /'GET \/api\/admin\/link-guard-settings': 'system\.manage'/);
  assert.match(server, /'PUT \/api\/admin\/link-guard-settings': 'system\.manage'/);
  assert.match(server, /route\('PUT', '\/api\/admin\/link-guard-settings'/);
});

test('system settings page keeps the guard panel', () => {
  const script = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'operations-center.js'), 'utf8');
  const settingsBlock = script.match(/function renderSettings\(data\) \{[\s\S]*?return fragment;\r?\n  \}/)?.[0] || '';

  assert.match(settingsBlock, /text\('ops\.guardTitle'/);
  assert.match(settingsBlock, /\/api\/admin\/link-guard-settings/);
  assert.match(settingsBlock, /stella:link-guard/);
  assert.doesNotMatch(settingsBlock, /运行策略|访问与会话|素材索引/);

  const service = fs.readFileSync(path.join(root, 'server', 'operations-service.js'), 'utf8');
  const snapshot = service.match(/function settingsSnapshot\(database, runtime = \{\}\) \{[\s\S]*?\r?\n\}/)?.[0] || '';
  assert.match(snapshot, /guards: linkGuardSettings\(database\)/);
});
