const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stella-permissions-'));
process.env.STELLA_DB_PATH = path.join(root, 'permissions.db');

const { db } = require('./db');
const {
  PERMISSION_CATALOG,
  effectivePermissionDetails,
  hasPermission,
  permissionCenterSnapshot,
  saveIdentityPermissions,
  saveAccountOverrides
} = require('./permissions-service');

function insertUser(id, role, identityKey) {
  const now = Date.now();
  db.prepare(`INSERT INTO users
    (id, username, display_name, password_hash, salt, role, permissions_json, status, created_at, updated_at)
    VALUES (?, ?, ?, 'hash', 'salt', ?, '[]', 'active', ?, ?)`)
    .run(id, id, id, role, now, now);
  db.prepare(`INSERT INTO user_identity_assignments (user_id, identity_key, sort_order)
    VALUES (?, ?, 0)`).run(id, identityKey);
}

test('identity baselines provide the expected effective permissions', () => {
  insertUser('operator-user', 'admin', 'administrator');
  const details = effectivePermissionDetails({ userId: 'operator-user', activeIdentityKey: 'administrator' });
  assert.equal(details.effective.includes('bp.operate'), true);
  assert.equal(details.effective.includes('system.manage'), true);
  assert.equal(details.effective.includes('operations.view'), true);
  assert.equal(details.effective.includes('friends.manage'), true);
  assert.equal(details.effective.includes('characterStats.manage'), true);
  assert.equal(hasPermission({ userId: 'operator-user', activeIdentityKey: 'administrator' }, 'materials.view'), true);
  insertUser('scorer-user', 'user', 'scorer');
  assert.deepEqual(effectivePermissionDetails({ userId: 'scorer-user', activeIdentityKey: 'scorer' }).effective, []);
});

test('dependent permissions fail closed when their viewing prerequisite is missing', () => {
  insertUser('guest-user', 'user', 'guest');
  saveIdentityPermissions('guest', ['bp.operate'], null);
  const details = effectivePermissionDetails({ userId: 'guest-user', activeIdentityKey: 'guest' });
  assert.equal(details.inherited.includes('bp.operate'), true);
  assert.equal(details.effective.includes('bp.operate'), false);
  assert.equal(details.sources['bp.operate'], 'dependency');
});

test('account deny wins over grant and identity inheritance', () => {
  saveAccountOverrides('operator-user', ['system.manage'], ['bp.operate'], 'operator-user');
  const details = effectivePermissionDetails({ userId: 'operator-user', activeIdentityKey: 'administrator' });
  assert.equal(details.effective.includes('system.manage'), true);
  assert.equal(details.sources['system.manage'], 'grant');
  assert.equal(details.effective.includes('bp.operate'), false);
  assert.equal(details.sources['bp.operate'], 'deny');
});

test('developer identity remains immutable even with account denies', () => {
  insertUser('developer-user', 'developer', 'developer');
  saveAccountOverrides('developer-user', [], ['system.manage', 'bp.operate'], 'developer-user');
  const details = effectivePermissionDetails({ userId: 'developer-user', activeIdentityKey: 'developer' });
  assert.equal(details.effective.length, PERMISSION_CATALOG.length);
  assert.equal(details.sources['system.manage'], 'developer');
  assert.equal(hasPermission({ userId: 'developer-user', activeIdentityKey: 'developer' }, 'bp.operate'), true);
  assert.equal(hasPermission({ userId: 'developer-user', activeIdentityKey: 'developer' }, 'characterStats.manage'), true);
});

test('saving an identity policy changes every account inheriting that identity', () => {
  saveIdentityPermissions('administrator', ['materials.view'], 'developer-user');
  const details = effectivePermissionDetails({ userId: 'operator-user', activeIdentityKey: 'administrator' });
  assert.equal(details.effective.includes('materials.view'), true);
  assert.equal(details.effective.includes('countdown.operate'), false);
  assert.equal(details.effective.includes('system.manage'), true);
});

test('permission snapshot exposes account overrides and protected developer policy', () => {
  const snapshot = permissionCenterSnapshot();
  const developer = snapshot.identities.find(identity => identity.key === 'developer');
  const operator = snapshot.accounts.find(account => account.id === 'operator-user');
  assert.equal(developer.immutable, true);
  assert.equal(developer.permissions.length, PERMISSION_CATALOG.length);
  assert.deepEqual(operator.grants, ['system.manage']);
  assert.deepEqual(operator.denies, ['bp.operate']);
  assert.equal(snapshot.catalog.some(item => item.key === 'system.status.view'), true);
  assert.deepEqual(snapshot.catalog.find(item => item.key === 'obs.manage').dependsOn, ['obs.view']);
  assert.deepEqual(snapshot.catalog.find(item => item.key === 'characterStats.manage').dependsOn, ['characterStats.view']);
  assert.equal(snapshot.safeguards.length >= 10, true);
});

test('permission center uses four bounded pages with independently scrolling columns', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'public', 'control.html'), 'utf8');
  const css = fs.readFileSync(path.join(projectRoot, 'public', 'assets', 'css', 'permissions-center.css'), 'utf8');
  const client = fs.readFileSync(path.join(projectRoot, 'public', 'assets', 'js', 'permissions-center.js'), 'utf8');
  assert.equal((html.match(/data-permissions-tab=/g) || []).length, 4);
  assert.equal((html.match(/id="permissionsPanel[^" ]*" role="tabpanel"/g) || []).length, 4);
  assert.match(css, /\[data-permissions-panel\]\[hidden\]\s*\{\s*display:\s*none !important/);
  assert.match(css, /\.permissions-page\s*\{[\s\S]*?height:\s*100%[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.permissions-selector-list\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.permissions-groups\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.permissions-editor-heading\s*\{[\s\S]*?z-index:\s*2/);
  assert.match(html, /permissions-editor-actions[\s\S]*permissionAccountSave/);
  assert.match(client, /ArrowLeft[\s\S]*ArrowRight[\s\S]*Home[\s\S]*End/);
});

test('invalid and conflicting account overrides are rejected', () => {
  assert.throws(
    () => saveAccountOverrides('operator-user', ['bp.view'], ['bp.view'], 'developer-user'),
    /不能同时允许和拒绝/
  );
  assert.throws(
    () => saveIdentityPermissions('developer', [], 'developer-user'),
    /不可修改/
  );
});

test.after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});
