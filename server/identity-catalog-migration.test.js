const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

test('schema v20 migrates administrator identity and retires removed identities without deleting accounts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-identity-v20-'));
  const dbPath = path.join(directory, 'app.db');
  let migratedDb = null;
  try {
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT,
        password_hash TEXT NOT NULL, salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'developer', 'operator', 'user')),
        permissions_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        expires_at INTEGER, last_login_at INTEGER, last_login_ip_hash TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE user_profiles (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '',
        default_page TEXT NOT NULL DEFAULT 'countdown', accent TEXT NOT NULL DEFAULT 'blue',
        layout TEXT NOT NULL DEFAULT 'comfortable', greeting TEXT NOT NULL DEFAULT 'friendly',
        show_greeting INTEGER NOT NULL DEFAULT 1, show_quick_links INTEGER NOT NULL DEFAULT 1,
        show_system_status INTEGER NOT NULL DEFAULT 1, gender TEXT NOT NULL DEFAULT 'unspecified',
        birth_date TEXT, region TEXT NOT NULL DEFAULT '未知地区', region_source TEXT NOT NULL DEFAULT 'login_ip',
        identity_key TEXT NOT NULL DEFAULT 'operator'
          CHECK (identity_key IN ('developer', 'operator', 'director', 'commentator', 'technical', 'referee', 'analyst', 'guest')),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE user_identity_assignments (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        identity_key TEXT NOT NULL
          CHECK (identity_key IN ('developer', 'operator', 'director', 'commentator', 'technical', 'referee', 'analyst', 'guest')),
        sort_order INTEGER NOT NULL, PRIMARY KEY (user_id, identity_key), UNIQUE (user_id, sort_order)
      );
      CREATE TABLE identity_permission_policies (
        identity_key TEXT NOT NULL
          CHECK (identity_key IN ('developer', 'operator', 'director', 'commentator', 'technical', 'referee', 'analyst', 'guest')),
        permission_key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL, updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        PRIMARY KEY (identity_key, permission_key)
      );
      CREATE TABLE communication_channels (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        identity_key TEXT, owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE, private_key TEXT UNIQUE,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        CHECK ((kind = 'identity') = (identity_key IS NOT NULL))
      );
      PRAGMA user_version = 19;
    `);
    const insertUser = legacyDb.prepare(`INSERT INTO users
      (id, username, display_name, password_hash, salt, role, permissions_json, status, created_at, updated_at)
      VALUES (?, ?, ?, 'hash', 'salt', 'operator', '[]', 'active', 1, 1)`);
    const insertProfile = legacyDb.prepare(`INSERT INTO user_profiles
      (user_id, identity_key, created_at, updated_at) VALUES (?, ?, 1, 1)`);
    const insertIdentity = legacyDb.prepare(`INSERT INTO user_identity_assignments
      (user_id, identity_key, sort_order) VALUES (?, ?, ?)`);
    for (const [id, identity] of [['admin-user', 'operator'], ['technical-user', 'technical'], ['multi-user', 'director']]) {
      insertUser.run(id, id, id);
      insertProfile.run(id, identity);
      insertIdentity.run(id, identity, 0);
    }
    insertIdentity.run('multi-user', 'technical', 1);
    legacyDb.prepare(`INSERT INTO identity_permission_policies
      (identity_key, permission_key, enabled, updated_at) VALUES ('operator', 'bp.view', 1, 1)`).run();
    const insertChannel = legacyDb.prepare(`INSERT INTO communication_channels
      (id, kind, name, description, identity_key, created_at, updated_at)
      VALUES (?, 'identity', ?, '', ?, 1, 1)`);
    insertChannel.run('identity:operator', '操作员公聊', 'operator');
    insertChannel.run('identity:technical', '技术支持公聊', 'technical');
    legacyDb.close();

    const result = spawnSync(process.execPath, ['-e', "require('./server/db').db.close()"], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, STELLA_DB_PATH: dbPath, STELLA_DATA_DIR: directory },
      encoding: 'utf8',
      windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    migratedDb = new DatabaseSync(dbPath);
    assert.equal(migratedDb.prepare('PRAGMA user_version').get().user_version, 23);
    assert.equal(migratedDb.prepare(`SELECT COUNT(*) AS n FROM sqlite_master
      WHERE type = 'table' AND name = 'character_portraits'`).get().n, 1);
    assert.equal(migratedDb.prepare(`SELECT COUNT(*) AS n FROM sqlite_master
      WHERE type = 'table' AND name = 'character_skill_icons'`).get().n, 1);
    assert.equal(migratedDb.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('characters')
      WHERE name = 'nickname'`).get().n, 1);
    assert.deepEqual(
      migratedDb.prepare('SELECT username, role FROM users ORDER BY username').all().map(row => ({ ...row })),
      [
        { username: 'admin-user', role: 'admin' },
        { username: 'multi-user', role: 'user' },
        { username: 'technical-user', role: 'user' }
      ]
    );
    assert.deepEqual(
      migratedDb.prepare(`SELECT user_id, identity_key, sort_order FROM user_identity_assignments
        ORDER BY user_id, sort_order`).all().map(row => ({ ...row })),
      [
        { user_id: 'admin-user', identity_key: 'administrator', sort_order: 0 },
        { user_id: 'multi-user', identity_key: 'director', sort_order: 0 },
        { user_id: 'technical-user', identity_key: 'guest', sort_order: 0 }
      ]
    );
    assert.equal(migratedDb.prepare(`SELECT identity_key FROM identity_permission_policies
      WHERE permission_key = 'bp.view'`).get().identity_key, 'administrator');
    assert.deepEqual(
      migratedDb.prepare(`SELECT id, kind, identity_key FROM communication_channels
        WHERE id IN ('identity:operator', 'identity:technical') ORDER BY id`).all().map(row => ({ ...row })),
      [
        { id: 'identity:operator', kind: 'identity', identity_key: 'administrator' },
        { id: 'identity:technical', kind: 'custom', identity_key: null }
      ]
    );
    assert.equal(migratedDb.prepare("SELECT COUNT(*) AS n FROM identity_permission_policies WHERE identity_key = 'scorer'").get().n, 0);
  } finally {
    migratedDb?.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
