const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

test('schema v3 migrates legacy profile JSON into normalized user tables', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-profile-migration-'));
  const dbPath = path.join(directory, 'app.db');
  let migratedDb = null;
  try {
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL,
        permissions_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
    legacyDb.prepare(`INSERT INTO users
      (id, username, display_name, password_hash, salt, role, permissions_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('legacy-user', 'legacy', '旧账号', 'hash', 'salt', 'operator', '[]', 'active', 1, 1);
    legacyDb.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)').run(
      'user.profile.legacy-user',
      JSON.stringify({
        displayName: '旧账号',
        title: '赛事主控',
        bio: '旧数据库个人简介',
        avatar: 'data:image/webp;base64,AQIDBA==',
        home: {
          defaultPage: 'materials',
          quickLinks: ['materials', 'logs'],
          accent: 'rose',
          layout: 'compact',
          greeting: 'compact',
          showGreeting: false,
          showQuickLinks: true,
          showSystemStatus: false
        },
        updatedAt: '2026-08-30T12:00:00.000Z'
      })
    );
    legacyDb.close();

    const result = spawnSync(process.execPath, ['-e', "require('./server/db').db.close()"], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        STELLA_DATA_DIR: directory,
        STELLA_DB_PATH: dbPath
      },
      encoding: 'utf8',
      windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    migratedDb = new DatabaseSync(dbPath);
    assert.equal(migratedDb.prepare('PRAGMA user_version').get().user_version, 23);
    const loginColumns = migratedDb.prepare('PRAGMA table_info(user_login_history)').all().map(column => column.name);
    assert(loginColumns.includes('ip_address'));
    assert(loginColumns.includes('device_fingerprint'));
    const auditColumns = migratedDb.prepare('PRAGMA table_info(account_operation_logs)').all().map(column => column.name);
    assert(auditColumns.includes('session_id'));
    assert(auditColumns.includes('user_agent'));
    assert(auditColumns.includes('actor_identity_key'));
    assert(auditColumns.includes('sensitive'));
    const bpHistoryColumns = migratedDb.prepare('PRAGMA table_info(bp_session_history)').all().map(column => column.name);
    const obsLogColumns = migratedDb.prepare('PRAGMA table_info(obs_operation_logs)').all().map(column => column.name);
    assert(bpHistoryColumns.includes('actor_identity_key'));
    assert(obsLogColumns.includes('actor_identity_key'));
    const countdownLogColumns = migratedDb.prepare('PRAGMA table_info(countdown_event_logs)').all()
      .map(column => column.name);
    assert(countdownLogColumns.includes('before_state_json'));
    assert(countdownLogColumns.includes('after_state_json'));
    assert(countdownLogColumns.includes('device_fingerprint'));
    assert.deepEqual(
      {
        ...migratedDb.prepare(`SELECT title, bio, default_page, accent, layout, greeting,
          show_greeting, show_quick_links, show_system_status
          FROM user_profiles WHERE user_id = ?`).get('legacy-user')
      },
      {
        title: '赛事主控',
        bio: '旧数据库个人简介',
        default_page: 'materials',
        accent: 'rose',
        layout: 'compact',
        greeting: 'compact',
        show_greeting: 0,
        show_quick_links: 1,
        show_system_status: 0
      }
    );
    assert.deepEqual(
      migratedDb.prepare(
        'SELECT page, sort_order FROM user_profile_quick_links WHERE user_id = ? ORDER BY sort_order')
        .all('legacy-user')
        .map(row => ({ ...row })),
      [{ page: 'materials', sort_order: 0 }, { page: 'logs', sort_order: 1 }]
    );
    const avatar = migratedDb.prepare(
      'SELECT mime_type, data, byte_size, sha256 FROM user_avatars WHERE user_id = ?').get('legacy-user');
    assert.equal(avatar.mime_type, 'image/webp');
    assert.deepEqual(Buffer.from(avatar.data), Buffer.from([1, 2, 3, 4]));
    assert.equal(avatar.byte_size, 4);
    assert.match(avatar.sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      migratedDb.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key = 'user.profile.legacy-user'").get().n,
      0
    );
    assert.deepEqual(
      migratedDb.prepare(`SELECT stat_key, sort_order FROM user_profile_stat_visibility
        WHERE user_id = ? ORDER BY sort_order`).all('legacy-user').map(row => ({ ...row })),
      [
        { stat_key: 'duty_time', sort_order: 0 },
        { stat_key: 'account_expiry', sort_order: 1 },
        { stat_key: 'event_count', sort_order: 2 },
        { stat_key: 'game_count', sort_order: 3 }
      ]
    );
    assert.equal(
      migratedDb.prepare('SELECT identity_key FROM user_profiles WHERE user_id = ?').get('legacy-user').identity_key,
      'administrator'
    );
    assert.equal(
      migratedDb.prepare('SELECT status FROM user_presence WHERE user_id = ?').get('legacy-user').status,
      'offline'
    );
    const presenceColumns = migratedDb.prepare('PRAGMA table_info(user_presence)').all().map(column => column.name);
    assert(presenceColumns.includes('manual_status'));
    assert(presenceColumns.includes('last_heartbeat_at'));
    assert(presenceColumns.includes('working_context_id'));
    const communicationMessageColumns = migratedDb.prepare(
      'PRAGMA table_info(communication_messages)').all().map(column => column.name);
    assert(communicationMessageColumns.includes('edited_at'));
    assert(communicationMessageColumns.includes('recalled_at'));
    assert(communicationMessageColumns.includes('recalled_by_user_id'));
    assert(communicationMessageColumns.includes('urgent'));
    const communicationTables = new Set(migratedDb.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
    assert(communicationTables.has('communication_message_edits'));
    assert(communicationTables.has('communication_message_deletions'));
    assert(communicationTables.has('communication_message_plus_ones'));
    assert(communicationTables.has('notifications'));
    assert(communicationTables.has('notification_recipients'));
    assert(communicationTables.has('character_skills'));
    const characterColumns = migratedDb.prepare('PRAGMA table_info(characters)').all().map(column => column.name);
    assert(characterColumns.includes('display_name'));
    assert(characterColumns.includes('release_date_text'));
    assert(characterColumns.includes('portrait_url'));
    assert.deepEqual(
      migratedDb.prepare('SELECT identity_key, sort_order FROM user_identity_assignments WHERE user_id = ? ORDER BY sort_order')
        .all('legacy-user').map(row => ({ ...row })),
      [{ identity_key: 'administrator', sort_order: 0 }]
    );
  } finally {
    migratedDb?.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('schema v7 migrates presence state into manual preference and heartbeat fields', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-presence-migration-'));
  const dbPath = path.join(directory, 'app.db');
  let migratedDb = null;
  try {
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL,
        permissions_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE user_presence (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'online'
          CHECK (status IN ('online', 'offline', 'away', 'working', 'busy')),
        updated_at INTEGER NOT NULL
      );
      INSERT INTO users VALUES
        ('away-user', 'away', 'Away', 'hash', 'salt', 'operator', '[]', 'active', 1, 1),
        ('working-user', 'working', 'Working', 'hash', 'salt', 'operator', '[]', 'active', 1, 1);
      INSERT INTO user_presence VALUES ('away-user', 'away', 1), ('working-user', 'working', 1);
      PRAGMA user_version = 7;
    `);
    legacyDb.close();

    const result = spawnSync(process.execPath, ['-e', "require('./server/db').db.close()"], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        STELLA_DATA_DIR: directory,
        STELLA_DB_PATH: dbPath
      },
      encoding: 'utf8',
      windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    migratedDb = new DatabaseSync(dbPath);
    assert.equal(migratedDb.prepare('PRAGMA user_version').get().user_version, 23);
    assert.deepEqual(
      migratedDb.prepare(`SELECT user_id, status, manual_status, last_heartbeat_at,
        activity_count, working_context_id FROM user_presence ORDER BY user_id`).all().map(row => ({ ...row })),
      [
        {
          user_id: 'away-user', status: 'offline', manual_status: 'away',
          last_heartbeat_at: null, activity_count: 0, working_context_id: null
        },
        {
          user_id: 'working-user', status: 'offline', manual_status: null,
          last_heartbeat_at: null, activity_count: 0, working_context_id: null
        }
      ]
    );
  } finally {
    migratedDb?.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
