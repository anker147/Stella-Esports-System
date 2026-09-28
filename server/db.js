const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATA_ROOT } = require('./data-paths');

const SCHEMA_VERSION = 35;
const DB_PATH = process.env.STELLA_DB_PATH || path.join(DATA_ROOT, 'app.db');
const IN_MEMORY = DB_PATH === ':memory:';

if (!IN_MEMORY) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA foreign_keys = ON');
if (!IN_MEMORY) db.exec('PRAGMA journal_mode = WAL');

// 事务嵌套深度跟踪：必须在迁移链执行前初始化（迁移在模块加载期运行）
const transactionDepths = new WeakMap();

const { SCHEMA_OBJECTS, SCHEMA_DDL } = require('./schema');


const PROFILE_PAGES = new Set(['countdown', 'bp', 'bracket', 'materials', 'logs', 'updates', 'profile']);
const PROFILE_ACCENTS = new Set(['blue', 'green', 'purple', 'rose']);
const PROFILE_LAYOUTS = new Set(['comfortable', 'compact']);
const PROFILE_GREETINGS = new Set(['friendly', 'compact']);

function legacyChoice(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function legacyText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function legacyTimestamp(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function legacyAvatar(value) {
  const source = String(value || '');
  if (!source) return null;
  const match = source.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('旧个人资料中的头像格式无效');
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > 600 * 1024) throw new Error('旧个人资料中的头像数据无效');
  return {
    mimeType: match[1],
    data,
    byteSize: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex')
  };
}

function migrateUserProfilesV2() {
  const rows = db.prepare("SELECT key, value_json FROM app_settings WHERE key LIKE 'user.profile.%' ORDER BY key").all();
  if (!rows.length) return;
  const userExists = db.prepare('SELECT 1 FROM users WHERE id = ?');
  const upsertProfile = db.prepare(`INSERT INTO user_profiles
    (user_id, title, bio, default_page, accent, layout, greeting,
      show_greeting, show_quick_links, show_system_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      title = excluded.title, bio = excluded.bio, default_page = excluded.default_page,
      accent = excluded.accent, layout = excluded.layout, greeting = excluded.greeting,
      show_greeting = excluded.show_greeting, show_quick_links = excluded.show_quick_links,
      show_system_status = excluded.show_system_status, updated_at = excluded.updated_at`);
  const deleteLinks = db.prepare('DELETE FROM user_profile_quick_links WHERE user_id = ?');
  const insertLink = db.prepare(
    'INSERT INTO user_profile_quick_links (user_id, page, sort_order) VALUES (?, ?, ?)');
  const upsertAvatar = db.prepare(`INSERT INTO user_avatars
    (user_id, mime_type, data, byte_size, sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      mime_type = excluded.mime_type, data = excluded.data, byte_size = excluded.byte_size,
      sha256 = excluded.sha256, updated_at = excluded.updated_at`);
  const deleteSetting = db.prepare('DELETE FROM app_settings WHERE key = ?');

  for (const row of rows) {
    const userId = row.key.slice('user.profile.'.length);
    if (!userId || !userExists.get(userId)) continue;
    let saved;
    try {
      saved = JSON.parse(row.value_json);
    } catch {
      throw new Error(`旧个人资料无法解析: ${row.key}`);
    }
    const home = saved && typeof saved.home === 'object' ? saved.home : {};
    const updatedAt = legacyTimestamp(saved.updatedAt);
    upsertProfile.run(
      userId,
      legacyText(saved.title, 40),
      legacyText(saved.bio, 160),
      legacyChoice(home.defaultPage, PROFILE_PAGES, 'countdown'),
      legacyChoice(home.accent, PROFILE_ACCENTS, 'blue'),
      legacyChoice(home.layout, PROFILE_LAYOUTS, 'comfortable'),
      legacyChoice(home.greeting, PROFILE_GREETINGS, 'friendly'),
      home.showGreeting === false ? 0 : 1,
      home.showQuickLinks === false ? 0 : 1,
      home.showSystemStatus === false ? 0 : 1,
      updatedAt,
      updatedAt
    );
    const quickLinks = [...new Set((Array.isArray(home.quickLinks) ? home.quickLinks : [])
      .filter(page => PROFILE_PAGES.has(page)))].slice(0, 4);
    const migratedLinks = quickLinks.length ? quickLinks : ['countdown', 'bp', 'materials', 'logs'];
    deleteLinks.run(userId);
    migratedLinks.forEach((page, index) => insertLink.run(userId, page, index));
    const avatar = legacyAvatar(saved.avatar);
    if (avatar) {
      upsertAvatar.run(userId, avatar.mimeType, avatar.data, avatar.byteSize, avatar.sha256, updatedAt, updatedAt);
    }
    deleteSetting.run(row.key);
  }
}

function tableHasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column);
}

function migrateTeamDivisionV27() {
  if (!tableHasColumn('teams', 'division')) {
    db.exec("ALTER TABLE teams ADD COLUMN division TEXT CHECK (division IN ('pc', 'mobile'))");
  }
  // 回填：按赛事与比赛数据推导，参赛历史只覆盖单一分区的战队取该分区，混合或无数据保持 NULL（未分区）
  db.exec(`UPDATE teams SET division = (
    SELECT CASE WHEN COUNT(DISTINCT e.division) = 1 THEN MIN(e.division) ELSE NULL END
    FROM (
      SELECT et.event_id AS event_id FROM event_teams et WHERE et.team_id = teams.id
      UNION
      SELECT m.event_id AS event_id FROM matches m
        JOIN match_rooms mr ON mr.match_id = m.id
        WHERE mr.escape_team_id = teams.id OR mr.hunter_team_id = teams.id
    ) part
    JOIN events e ON e.id = part.event_id
    WHERE e.division IN ('pc', 'mobile')
  )`);
}

function migrateCommunicationChannelExtrasV30() {
  const channels = 'communication_channels';
  if (!tableHasColumn(channels, 'announcement')) {
    db.exec("ALTER TABLE " + channels + " ADD COLUMN announcement TEXT NOT NULL DEFAULT '' CHECK (length(announcement) <= 500)");
  }
  if (!tableHasColumn(channels, 'avatar')) {
    db.exec('ALTER TABLE ' + channels + ' ADD COLUMN avatar BLOB');
  }
  if (!tableHasColumn(channels, 'avatar_mime')) {
    db.exec("ALTER TABLE " + channels + " ADD COLUMN avatar_mime TEXT CHECK (avatar_mime IS NULL OR avatar_mime IN ('image/png', 'image/jpeg', 'image/webp'))");
  }
  if (!tableHasColumn(channels, 'avatar_updated_at')) {
    db.exec('ALTER TABLE ' + channels + ' ADD COLUMN avatar_updated_at INTEGER');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS communication_channel_prefs (
    channel_id TEXT NOT NULL REFERENCES communication_channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
    PRIMARY KEY (channel_id, user_id)
  )`);
}
function migrateBpRoomV29() {
  if (!tableHasColumn('tournament_stage_matches', 'bp_room')) {
    db.exec("ALTER TABLE tournament_stage_matches ADD COLUMN bp_room TEXT NOT NULL DEFAULT 'A' CHECK (bp_room IN ('A', 'B'))");
  }
}

function migrateStageRuntimeV28() {
  if (!tableHasColumn('tournament_stages', 'division')) {
    db.exec("ALTER TABLE tournament_stages ADD COLUMN division TEXT CHECK (division IN ('pc', 'mobile'))");
  }
  if (!tableHasColumn('tournament_stages', 'status')) {
    db.exec("ALTER TABLE tournament_stages ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'paused', 'completed'))");
  }
  // 回填：阶段赛区继承所属赛事赛区（仅 pc/mobile，未分区保持 NULL）
  db.exec(`UPDATE tournament_stages SET division = (
    SELECT e.division FROM tournament_events e
    WHERE e.id = tournament_stages.tournament_event_id AND e.division IN ('pc', 'mobile')
  ) WHERE division IS NULL`);
}

function migrateAccountsV3() {
  const userColumns = [
    ['expires_at', 'INTEGER'],
    ['last_login_at', 'INTEGER'],
    ['last_login_ip_hash', 'TEXT']
  ];
  for (const [name, definition] of userColumns) {
    if (!tableHasColumn('users', name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
  }

  const profileColumns = [
    ['gender', "TEXT NOT NULL DEFAULT 'unspecified' CHECK (gender IN ('unspecified', 'male', 'female', 'other'))"],
    ['birth_date', 'TEXT'],
    ['region', "TEXT NOT NULL DEFAULT '未知地区' CHECK (length(region) <= 80)"],
    ['region_source', "TEXT NOT NULL DEFAULT 'login_ip' CHECK (region_source IN ('login_ip', 'proxy_geo', 'local', 'administrator'))"]
  ];
  for (const [name, definition] of profileColumns) {
    if (!tableHasColumn('user_profiles', name)) {
      db.exec(`ALTER TABLE user_profiles ADD COLUMN ${name} ${definition}`);
    }
  }

  const insertVisibility = db.prepare(
    'INSERT OR IGNORE INTO user_profile_stat_visibility (user_id, stat_key, sort_order) VALUES (?, ?, ?)');
  const users = db.prepare('SELECT id FROM users ORDER BY created_at, id').all();
  const defaults = ['duty_time', 'account_expiry', 'event_count', 'game_count'];
  for (const user of users) {
    defaults.forEach((key, index) => insertVisibility.run(user.id, key, index));
  }
}

function migrateProfileAccountsV4() {
  if (!tableHasColumn('user_profiles', 'identity_key')) {
    db.exec(`ALTER TABLE user_profiles ADD COLUMN identity_key TEXT NOT NULL DEFAULT 'operator'
      CHECK (identity_key IN ('developer', 'operator', 'director', 'commentator', 'technical', 'referee', 'analyst', 'guest'))`);
  }
  db.prepare(`UPDATE user_profiles SET identity_key = 'developer'
    WHERE user_id IN (SELECT id FROM users WHERE role IN ('developer', 'admin'))
      AND (identity_key IS NULL OR identity_key = '' OR identity_key = 'operator')`).run();
  const profileTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_profiles'").get()?.sql || '';
  if (profileTableSql.includes("'administrator'")) {
    db.prepare(`UPDATE user_profiles SET identity_key = 'administrator'
      WHERE user_id IN (SELECT id FROM users WHERE role = 'operator') AND identity_key = 'guest'`).run();
  }
  db.prepare(`UPDATE user_profiles SET identity_key = 'operator'
    WHERE identity_key IS NULL OR identity_key = ''`).run();
  db.prepare(`INSERT OR IGNORE INTO user_presence (user_id, status, updated_at)
    SELECT id, 'offline', updated_at FROM users`).run();
}

function migrateAuditActorsV5() {
  if (!tableHasColumn('account_operation_logs', 'category')) {
    db.exec(`ALTER TABLE account_operation_logs ADD COLUMN category TEXT NOT NULL DEFAULT 'account'
      CHECK (category IN ('event', 'account'))`);
  }
  if (!tableHasColumn('bp_session_history', 'actor_user_id')) {
    db.exec('ALTER TABLE bp_session_history ADD COLUMN actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL');
  }
  if (!tableHasColumn('bp_session_history', 'actor_display_name')) {
    db.exec("ALTER TABLE bp_session_history ADD COLUMN actor_display_name TEXT NOT NULL DEFAULT '系统'");
  }
  if (!tableHasColumn('obs_operation_logs', 'actor_user_id')) {
    db.exec('ALTER TABLE obs_operation_logs ADD COLUMN actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL');
  }
  if (!tableHasColumn('obs_operation_logs', 'actor_display_name')) {
    db.exec("ALTER TABLE obs_operation_logs ADD COLUMN actor_display_name TEXT NOT NULL DEFAULT '系统'");
  }
}

function migrateIdentityAssignmentsV6() {
  db.prepare(`INSERT OR IGNORE INTO user_identity_assignments (user_id, identity_key, sort_order)
    SELECT user_id, identity_key, 0 FROM user_profiles`).run();
}

function migrateRequestAuditV7() {
  const loginColumns = [
    ['ip_address', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['device_fingerprint', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['device_name', "TEXT NOT NULL DEFAULT '未知设备'"],
    ['user_agent', "TEXT NOT NULL DEFAULT ''"]
  ];
  for (const [name, definition] of loginColumns) {
    if (!tableHasColumn('user_login_history', name)) {
      db.exec(`ALTER TABLE user_login_history ADD COLUMN ${name} ${definition}`);
    }
  }

  const auditColumns = [
    ['session_id', 'TEXT'],
    ['ip_address', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['region', "TEXT NOT NULL DEFAULT '未知地区'"],
    ['device_fingerprint', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['device_name', "TEXT NOT NULL DEFAULT '未知设备'"],
    ['user_agent', "TEXT NOT NULL DEFAULT ''"]
  ];
  for (const [name, definition] of auditColumns) {
    if (!tableHasColumn('account_operation_logs', name)) {
      db.exec(`ALTER TABLE account_operation_logs ADD COLUMN ${name} ${definition}`);
    }
  }
}

function migratePresenceV8() {
  const columns = [
    ['manual_status', "TEXT CHECK (manual_status IS NULL OR manual_status IN ('online', 'offline', 'away', 'busy'))"],
    ['last_heartbeat_at', 'INTEGER'],
    ['last_activity_at', 'INTEGER'],
    ['activity_window_started_at', 'INTEGER'],
    ['activity_count', 'INTEGER NOT NULL DEFAULT 0 CHECK (activity_count >= 0)'],
    ['working_context_id', 'TEXT'],
    ['working_started_at', 'INTEGER']
  ];
  for (const [name, definition] of columns) {
    if (!tableHasColumn('user_presence', name)) {
      db.exec(`ALTER TABLE user_presence ADD COLUMN ${name} ${definition}`);
    }
  }
  db.prepare(`UPDATE user_presence SET
    manual_status = CASE WHEN status IN ('away', 'busy') THEN status ELSE NULL END,
    status = 'offline',
    last_heartbeat_at = NULL,
    last_activity_at = NULL,
    activity_window_started_at = NULL,
    activity_count = 0,
    working_context_id = NULL,
    working_started_at = NULL,
    updated_at = ?`).run(Date.now());
}

function migrateAuditIdentityV9() {
  const columns = [
    ['actor_identity_key', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['sensitive', 'INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1))']
  ];
  for (const [name, definition] of columns) {
    if (!tableHasColumn('account_operation_logs', name)) {
      db.exec(`ALTER TABLE account_operation_logs ADD COLUMN ${name} ${definition}`);
    }
  }
}

function migrateEventAuditIdentityV10() {
  for (const table of ['bp_session_history', 'obs_operation_logs']) {
    if (!tableHasColumn(table, 'actor_identity_key')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN actor_identity_key TEXT NOT NULL DEFAULT 'system'`);
    }
    db.exec(`UPDATE ${table} AS log SET actor_identity_key = CASE
      WHEN log.actor_user_id IS NULL THEN 'system'
      ELSE COALESCE((SELECT assignment.identity_key
        FROM user_identity_assignments AS assignment
        WHERE assignment.user_id = log.actor_user_id
        ORDER BY assignment.sort_order, assignment.identity_key
        LIMIT 1), 'operator')
      END
      WHERE log.actor_identity_key IS NULL OR log.actor_identity_key IN ('', 'unknown')`);
  }
}

function migratePermissionsV11() {
  const insert = db.prepare(`INSERT OR IGNORE INTO user_permission_overrides
    (user_id, permission_key, effect, updated_at, updated_by) VALUES (?, ?, 'grant', ?, NULL)`);
  const now = Date.now();
  for (const row of db.prepare('SELECT id, permissions_json FROM users').all()) {
    let permissions = [];
    try {
      permissions = JSON.parse(row.permissions_json || '[]');
    } catch {}
    for (const permission of Array.isArray(permissions) ? permissions : []) {
      if (permission && permission !== '*') insert.run(row.id, String(permission), now);
    }
  }
}

function seedCommunicationChannels() {
  const now = Date.now();
  const insert = db.prepare(`INSERT OR IGNORE INTO communication_channels
    (id, kind, name, description, identity_key, owner_user_id, private_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`);
  insert.run('global', 'global', '全局公聊', '面向所有已获通讯权限用户的公共频道。', null, now, now);
  const identities = [
    ['developer', '系统开发者'], ['administrator', '管理员'], ['director', '赛事导演'],
    ['commentator', '赛事解说'], ['referee', '裁判'], ['scorer', '记分员'], ['guest', '访客']
  ];
  for (const [key, label] of identities) {
    insert.run(`identity:${key}`, 'identity', `${label}公聊`, `仅当前使用${label}身份的用户可见。`, key, now, now);
  }
}

function migrateCommunicationMessagesV13() {
  const columns = [
    ['edited_at', 'INTEGER'],
    ['recalled_at', 'INTEGER'],
    ['recalled_by_user_id', 'TEXT REFERENCES users(id) ON DELETE SET NULL'],
    ['urgent', 'INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1))']
  ];
  for (const [name, definition] of columns) {
    if (!tableHasColumn('communication_messages', name)) {
      db.exec(`ALTER TABLE communication_messages ADD COLUMN ${name} ${definition}`);
    }
  }
}

function migrateCharacterProfilesV15() {
  const columns = [
    ['display_name', 'TEXT'],
    ['release_date_text', 'TEXT'],
    ['portrait_url', 'TEXT']
  ];
  for (const [name, definition] of columns) {
    if (!tableHasColumn('characters', name)) {
      db.exec(`ALTER TABLE characters ADD COLUMN ${name} ${definition}`);
    }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS character_skills (
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL CHECK (slot > 0),
    name TEXT,
    description TEXT,
    icon_url TEXT,
    PRIMARY KEY (character_id, slot)
  )`);
}

function migrateIdentityCatalogV20() {
  const now = Date.now();
  db.exec(`CREATE TABLE user_identity_assignments_v20 (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    identity_key TEXT NOT NULL
      CHECK (identity_key IN ('developer', 'administrator', 'director', 'commentator', 'referee', 'scorer', 'guest')),
    sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 7),
    PRIMARY KEY (user_id, identity_key),
    UNIQUE (user_id, sort_order)
  )`);
  db.exec(`INSERT INTO user_identity_assignments_v20 (user_id, identity_key, sort_order)
    SELECT user_id, CASE identity_key WHEN 'operator' THEN 'administrator' ELSE identity_key END, sort_order
    FROM user_identity_assignments
    WHERE identity_key NOT IN ('technical', 'analyst')`);
  db.exec(`INSERT INTO user_identity_assignments_v20 (user_id, identity_key, sort_order)
    SELECT users.id, 'guest', 0 FROM users
    WHERE NOT EXISTS (SELECT 1 FROM user_identity_assignments_v20 WHERE user_id = users.id)`);

  db.exec(`CREATE TABLE identity_permission_policies_v20 (
    identity_key TEXT NOT NULL
      CHECK (identity_key IN ('developer', 'administrator', 'director', 'commentator', 'referee', 'scorer', 'guest')),
    permission_key TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    updated_at INTEGER NOT NULL,
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (identity_key, permission_key)
  )`);
  db.exec(`INSERT INTO identity_permission_policies_v20
      (identity_key, permission_key, enabled, updated_at, updated_by)
    SELECT CASE identity_key WHEN 'operator' THEN 'administrator' ELSE identity_key END,
      permission_key, enabled, updated_at, updated_by
    FROM identity_permission_policies
    WHERE identity_key NOT IN ('technical', 'analyst')`);

  db.exec(`CREATE TABLE user_profiles_v20 (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 40),
    bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 160),
    default_page TEXT NOT NULL DEFAULT 'countdown'
      CHECK (default_page IN ('countdown', 'bp', 'bracket', 'materials', 'logs', 'updates', 'profile')),
    accent TEXT NOT NULL DEFAULT 'blue' CHECK (accent IN ('blue', 'green', 'purple', 'rose')),
    layout TEXT NOT NULL DEFAULT 'comfortable' CHECK (layout IN ('comfortable', 'compact')),
    greeting TEXT NOT NULL DEFAULT 'friendly' CHECK (greeting IN ('friendly', 'compact')),
    show_greeting INTEGER NOT NULL DEFAULT 1 CHECK (show_greeting IN (0, 1)),
    show_quick_links INTEGER NOT NULL DEFAULT 1 CHECK (show_quick_links IN (0, 1)),
    show_system_status INTEGER NOT NULL DEFAULT 1 CHECK (show_system_status IN (0, 1)),
    gender TEXT NOT NULL DEFAULT 'unspecified'
      CHECK (gender IN ('unspecified', 'male', 'female', 'other')),
    birth_date TEXT,
    region TEXT NOT NULL DEFAULT '未知地区' CHECK (length(region) <= 80),
    region_source TEXT NOT NULL DEFAULT 'login_ip'
      CHECK (region_source IN ('login_ip', 'proxy_geo', 'local', 'administrator')),
    identity_key TEXT NOT NULL DEFAULT 'guest'
      CHECK (identity_key IN ('developer', 'administrator', 'director', 'commentator', 'referee', 'scorer', 'guest')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.exec(`INSERT INTO user_profiles_v20
      (user_id, title, bio, default_page, accent, layout, greeting, show_greeting,
        show_quick_links, show_system_status, gender, birth_date, region, region_source,
        identity_key, created_at, updated_at)
    SELECT profile.user_id, profile.title, profile.bio, profile.default_page, profile.accent,
      profile.layout, profile.greeting, profile.show_greeting, profile.show_quick_links,
      profile.show_system_status, profile.gender, profile.birth_date, profile.region,
      profile.region_source,
      COALESCE((SELECT assignment.identity_key FROM user_identity_assignments_v20 AS assignment
        WHERE assignment.user_id = profile.user_id
        ORDER BY assignment.sort_order, assignment.identity_key LIMIT 1), 'guest'),
      profile.created_at, profile.updated_at
    FROM user_profiles AS profile`);

  db.exec('DROP TABLE user_profiles');
  db.exec('DROP TABLE user_identity_assignments');
  db.exec('DROP TABLE identity_permission_policies');
  db.exec('ALTER TABLE user_profiles_v20 RENAME TO user_profiles');
  db.exec('ALTER TABLE user_identity_assignments_v20 RENAME TO user_identity_assignments');
  db.exec('ALTER TABLE identity_permission_policies_v20 RENAME TO identity_permission_policies');
  db.exec('CREATE INDEX idx_user_profiles_updated ON user_profiles(updated_at)');
  db.exec('CREATE INDEX idx_user_identity_assignments_user ON user_identity_assignments(user_id, sort_order)');

  db.exec(`UPDATE users SET role = CASE
    WHEN role = 'developer' THEN 'developer'
    WHEN EXISTS (SELECT 1 FROM user_identity_assignments
      WHERE user_identity_assignments.user_id = users.id
        AND user_identity_assignments.identity_key = 'administrator') THEN 'admin'
    ELSE 'user' END`);
  db.prepare(`UPDATE communication_channels SET
    identity_key = 'administrator', name = '管理员公聊',
    description = '仅当前使用管理员身份的用户可见。', updated_at = ?
    WHERE kind = 'identity' AND identity_key = 'operator'`).run(now);
  db.prepare(`UPDATE communication_channels SET
    kind = 'custom', identity_key = NULL, name = '[历史] ' || name,
    description = '对应身份已停用，仅保留历史消息供开发者审计。', updated_at = ?
    WHERE kind = 'identity' AND identity_key IN ('technical', 'analyst')`).run(now);
  for (const [table, column] of [
    ['account_operation_logs', 'actor_identity_key'],
    ['countdown_event_logs', 'actor_identity_key'],
    ['bp_session_history', 'actor_identity_key'],
    ['obs_operation_logs', 'actor_identity_key'],
    ['communication_messages', 'sender_identity_key'],
    ['notifications', 'created_by_identity_key']
  ]) {
    db.exec(`UPDATE ${table} SET ${column} = 'administrator' WHERE ${column} = 'operator'`);
  }
}

function migrateTournamentEventsV24() {
  const candidates = db.prepare(`SELECT e.*, p.*
    FROM event_management_profiles p
    JOIN events e ON e.id = p.event_id
    WHERE e.id <> 'bp-interface-test-event'
      AND e.source_workbook IS NULL
      AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.event_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM event_teams et WHERE et.event_id = e.id)`).all();
  const insertEvent = db.prepare(`INSERT OR IGNORE INTO tournament_events
    (id, name, division, stage, mode, format, priority, description, max_teams, event_type,
     require_real_name, visibility, registration_method, team_requirement, start_date, end_date,
     registration_start, registration_end, min_team_members, max_team_members, require_system_login,
     organizer_type, organizer_name, contact, rules_text, status, marked, created_by, started_at,
     ended_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertMedia = db.prepare(`INSERT OR REPLACE INTO tournament_event_media
    (tournament_event_id, kind, mime_type, data, byte_size, sha256, created_at, updated_at)
    SELECT ?, kind, mime_type, data, byte_size, sha256, created_at, updated_at
    FROM event_media WHERE event_id = ?`);
  const deleteLegacy = db.prepare('DELETE FROM events WHERE id = ?');
  for (const row of candidates) {
    const status = row.manual_status === 'live' ? 'live'
      : row.manual_status === 'completed' ? 'completed' : 'draft';
    insertEvent.run(
      row.id, row.name, row.division || 'all', row.stage_label || row.stage || '筹备阶段',
      row.mode || '标准对局', row.format || '赛制待定', row.description || '', row.max_teams,
      row.event_type || 'private', Number(row.require_real_name || 0), row.visibility || 'system',
      row.registration_method || 'invite', row.team_requirement || 'any', row.start_date || row.date,
      row.end_date || row.date, row.registration_start, row.registration_end, row.min_team_members,
      row.max_team_members, row.require_system_login === null ? 1 : Number(row.require_system_login),
      row.organizer_type || 'personal', row.organizer_name || '', row.contact || '', row.rules_text || '',
      status, Number(row.marked || 0), row.created_by, status === 'live' ? row.updated_at : null,
      status === 'completed' ? row.updated_at : null, row.created_at, row.updated_at
    );
    insertMedia.run(row.id, row.id);
    deleteLegacy.run(row.id);
  }
}

function migrateTournamentStagesV25() {
  db.exec(`CREATE TABLE IF NOT EXISTS tournament_stages (
    id TEXT PRIMARY KEY,
    tournament_event_id TEXT NOT NULL REFERENCES tournament_events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    format TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    match_day_mode TEXT NOT NULL CHECK (match_day_mode IN ('date', 'weekday')),
    match_date TEXT,
    weekdays_json TEXT NOT NULL DEFAULT '[]',
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (tournament_event_id, name),
    CHECK ((match_day_mode = 'date' AND match_date IS NOT NULL AND weekdays_json = '[]')
      OR (match_day_mode = 'weekday' AND match_date IS NULL))
  );
  CREATE TABLE IF NOT EXISTS tournament_stage_teams (
    stage_id TEXT NOT NULL REFERENCES tournament_stages(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (stage_id, team_id)
  );
  CREATE INDEX IF NOT EXISTS idx_tournament_stages_event
    ON tournament_stages(tournament_event_id, start_at, created_at);
  CREATE INDEX IF NOT EXISTS idx_tournament_stage_teams_team
    ON tournament_stage_teams(team_id, stage_id)`);
}

function migrateTournamentCreationV26() {
  if (!tableHasColumn('tournament_events', 'handbook_url')) {
    db.exec("ALTER TABLE tournament_events ADD COLUMN handbook_url TEXT NOT NULL DEFAULT ''");
  }
  if (!tableHasColumn('tournament_events', 'contact_group')) {
    db.exec("ALTER TABLE tournament_events ADD COLUMN contact_group TEXT NOT NULL DEFAULT ''");
  }
  if (!tableHasColumn('tournament_events', 'contact_group_url')) {
    db.exec("ALTER TABLE tournament_events ADD COLUMN contact_group_url TEXT NOT NULL DEFAULT ''");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS tournament_event_teams (
    tournament_event_id TEXT NOT NULL REFERENCES tournament_events(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tournament_event_id, team_id)
  );
  CREATE INDEX IF NOT EXISTS idx_tournament_event_teams_team
    ON tournament_event_teams(team_id, tournament_event_id)`);
  const mediaSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tournament_event_media'`).get()?.sql || '';
  if (!mediaSql.includes("'group_qr'")) {
    db.exec(`CREATE TABLE tournament_event_media_v26 (
      tournament_event_id TEXT NOT NULL REFERENCES tournament_events(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('logo', 'cover', 'group_qr')),
      mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
      data BLOB NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 4194304),
      sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (tournament_event_id, kind)
    );
    INSERT INTO tournament_event_media_v26 SELECT * FROM tournament_event_media;
    DROP TABLE tournament_event_media;
    ALTER TABLE tournament_event_media_v26 RENAME TO tournament_event_media`);
  }
}

const currentVersion = db.prepare('PRAGMA user_version').get().user_version;
if (currentVersion > SCHEMA_VERSION) {
  throw new Error(`数据库版本 ${currentVersion} 高于当前程序支持的 ${SCHEMA_VERSION}，已拒绝启动以保护数据`);
}
if (currentVersion === 0) {
  db.exec(SCHEMA_DDL);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
} else {
  db.exec(SCHEMA_DDL);
  if (currentVersion < 2) {
    withTransaction(() => {
      migrateUserProfilesV2();
      db.exec('PRAGMA user_version = 2');
    });
  }
  if (currentVersion < 3) {
    withTransaction(() => {
      migrateAccountsV3();
      db.exec('PRAGMA user_version = 3');
    });
  }
  if (currentVersion < 4) {
    withTransaction(() => {
      migrateProfileAccountsV4();
      db.exec('PRAGMA user_version = 4');
    });
  }
  if (currentVersion < 5) {
    withTransaction(() => {
      migrateAuditActorsV5();
      db.exec('PRAGMA user_version = 5');
    });
  }
  if (currentVersion < 6) {
    withTransaction(() => {
      migrateIdentityAssignmentsV6();
      db.exec('PRAGMA user_version = 6');
    });
  }
  if (currentVersion < 7) {
    withTransaction(() => {
      migrateRequestAuditV7();
      db.exec('PRAGMA user_version = 7');
    });
  }
  if (currentVersion < 8) {
    withTransaction(() => {
      migratePresenceV8();
      db.exec('PRAGMA user_version = 8');
    });
  }
  if (currentVersion < 9) {
    withTransaction(() => {
      migrateAuditIdentityV9();
      db.exec('PRAGMA user_version = 9');
    });
  }
  if (currentVersion < 10) {
    withTransaction(() => {
      migrateEventAuditIdentityV10();
      db.exec('PRAGMA user_version = 10');
    });
  }
  if (currentVersion < 11) {
    withTransaction(() => {
      migratePermissionsV11();
      db.exec('PRAGMA user_version = 11');
    });
  }
  if (currentVersion < 12) {
    withTransaction(() => {
      seedCommunicationChannels();
      db.exec('PRAGMA user_version = 12');
    });
  }
  if (currentVersion < 13) {
    withTransaction(() => {
      migrateCommunicationMessagesV13();
      db.exec('PRAGMA user_version = 13');
    });
  }
  if (currentVersion < 14) {
    withTransaction(() => {
      db.exec('PRAGMA user_version = 14');
    });
  }
  if (currentVersion < 15) {
    withTransaction(() => {
      migrateCharacterProfilesV15();
      db.exec('PRAGMA user_version = 15');
    });
  }
  if (currentVersion < 16) {
    withTransaction(() => {
      db.exec('PRAGMA user_version = 16');
    });
  }
  if (currentVersion < 17) {
    withTransaction(() => {
      db.exec('PRAGMA user_version = 17');
    });
  }
  if (currentVersion < 18) {
    withTransaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS character_change_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        changed_on TEXT,
        title TEXT NOT NULL,
        content TEXT,
        source_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(character_id, changed_on, title)
      )`);
      db.exec('PRAGMA user_version = 18');
    });
  }
  if (currentVersion < 19) {
    withTransaction(() => {
      if (!tableHasColumn('matches', 'exclude_from_character_stats')) {
        db.exec('ALTER TABLE matches ADD COLUMN exclude_from_character_stats INTEGER NOT NULL DEFAULT 0');
      }
      db.exec('PRAGMA user_version = 19');
    });
  }
  if (currentVersion < 20) {
    withTransaction(() => {
      migrateIdentityCatalogV20();
      db.exec('PRAGMA user_version = 20');
    });
  }
  if (currentVersion < 21) {
    withTransaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS character_portraits (
        character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
        data BLOB NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 2097152),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`);
      db.exec('PRAGMA user_version = 21');
    });
  }
  if (currentVersion < 22) {
    withTransaction(() => {
      if (!tableHasColumn('characters', 'nickname')) {
        db.exec('ALTER TABLE characters ADD COLUMN nickname TEXT');
      }
      db.exec(`UPDATE characters SET nickname = id
        WHERE nickname IS NULL OR trim(nickname) = ''`);
      db.exec(`CREATE TABLE IF NOT EXISTS character_skill_icons (
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
        mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
        data BLOB NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 524288),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (character_id, slot)
      )`);
      db.exec('PRAGMA user_version = 22');
    });
  }
  if (currentVersion < 23) {
    withTransaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS event_management_profiles (
        event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
        description TEXT NOT NULL DEFAULT '',
        max_teams INTEGER CHECK (max_teams IS NULL OR max_teams BETWEEN 2 AND 128),
        event_type TEXT NOT NULL DEFAULT 'private' CHECK (event_type IN ('private', 'public')),
        require_real_name INTEGER NOT NULL DEFAULT 0 CHECK (require_real_name IN (0, 1)),
        visibility TEXT NOT NULL DEFAULT 'system' CHECK (visibility IN ('system', 'participants', 'invite_only')),
        registration_method TEXT NOT NULL DEFAULT 'invite' CHECK (registration_method IN ('invite', 'manual', 'closed')),
        team_requirement TEXT NOT NULL DEFAULT 'any' CHECK (team_requirement IN ('any', 'club', 'organization')),
        start_date TEXT,
        end_date TEXT,
        registration_start TEXT,
        registration_end TEXT,
        min_team_members INTEGER CHECK (min_team_members IS NULL OR min_team_members BETWEEN 1 AND 99),
        max_team_members INTEGER CHECK (max_team_members IS NULL OR max_team_members BETWEEN 1 AND 99),
        require_system_login INTEGER NOT NULL DEFAULT 1 CHECK (require_system_login IN (0, 1)),
        organizer_type TEXT NOT NULL DEFAULT 'personal' CHECK (organizer_type IN ('personal', 'organization')),
        organizer_name TEXT NOT NULL DEFAULT '',
        contact TEXT NOT NULL DEFAULT '',
        rules_text TEXT NOT NULL DEFAULT '',
        manual_status TEXT CHECK (manual_status IS NULL OR manual_status IN ('live', 'completed')),
        marked INTEGER NOT NULL DEFAULT 0 CHECK (marked IN (0, 1)),
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_media (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('logo', 'cover')),
        mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
        data BLOB NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 4194304),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, kind)
      )`);
      db.exec('PRAGMA user_version = 23');
    });
  }
  if (currentVersion < 24) {
    withTransaction(() => {
      migrateTournamentEventsV24();
      db.exec('PRAGMA user_version = 24');
    });
  }
  if (currentVersion < 25) {
    withTransaction(() => {
      migrateTournamentStagesV25();
      db.exec('PRAGMA user_version = 25');
    });
  }
  if (currentVersion < 27) {
    withTransaction(() => {
      migrateTournamentCreationV26();
      db.exec('PRAGMA user_version = 27');
    });
  }
  if (currentVersion < 28) {
    withTransaction(() => {
      migrateTeamDivisionV27();
      db.exec('PRAGMA user_version = 28');
    });
  }
  if (currentVersion < 29) {
    withTransaction(() => {
      migrateStageRuntimeV28();
      db.exec('PRAGMA user_version = 29');
    });
  }
  if (currentVersion < 30) {
    withTransaction(() => {
      migrateBpRoomV29();
      db.exec('PRAGMA user_version = 30');
    });
  }
  if (currentVersion < 31) {
    withTransaction(() => {
      migrateCommunicationChannelExtrasV30();
      db.exec('PRAGMA user_version = 31');
    });
  }
  if (currentVersion < 32) {
    migrateSessionStoreAndForeignKeysV31();
    db.exec('PRAGMA user_version = 32');
  }
  if (currentVersion < 33) {
    migrateDataHygieneV32();
    db.exec('PRAGMA user_version = 33');
  }
  if (currentVersion < 34) {
    migrateEventMediaToFilesV33();
    db.exec('PRAGMA user_version = 34');
  }
  // v35（schema 35）：event_media 旧版赛事媒体 BLOB 表数据已在 v34 迁移走（实测 0 行），
  // 且无任何写入路径，仅 v24 legacy 迁移读它作源——DROP 放 v35 保证老库先迁完再删。
  if (currentVersion < 35) {
    withTransaction(() => {
      db.exec('DROP TABLE IF EXISTS event_media');
      db.exec('PRAGMA user_version = 35');
    });
  }
}

// v31（schema 32）：会话从 app_settings 的 JSON blob 迁到独立表 auth_sessions；
// BP 数据表外键补删除策略。重建表期间必须临时关闭外键（否则 DROP 父表会触发级联删光子表数据），
// 结束前用 foreign_key_check 校验再恢复。逐表做行数守恒断言，任何不符即回滚。
function migrateSessionStoreAndForeignKeysV31() {
  const rebuildTable = (table, createSql, columns) => {
    const expected = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    db.exec(createSql.replaceAll('__NEW__', `${table}_new`));
    db.exec(`INSERT INTO ${table}_new (${columns}) SELECT ${columns} FROM ${table}`);
    const copied = db.prepare(`SELECT COUNT(*) AS n FROM ${table}_new`).get().n;
    if (copied !== expected) throw new Error(`${table} 迁移复制行数不符（${copied} != ${expected}）`);
    db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
  };
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    withTransaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL DEFAULT 0
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at)');
      const legacyBlob = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('auth.sessions');
      if (legacyBlob) {
        const insertSession = db.prepare(`INSERT INTO auth_sessions (token, user_id, role, data_json, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?)`);
        try {
          const list = JSON.parse(legacyBlob.value_json);
          if (Array.isArray(list)) {
            for (const item of list) {
              if (!item?.token || !item?.userId) continue;
              insertSession.run(item.token, item.userId, item.role || '', JSON.stringify(item),
                Number(new Date(item.createdAt).getTime()) || 0, Number(item.expiresAt) || 0);
            }
          }
        } catch {}
        db.prepare('DELETE FROM app_settings WHERE key = ?').run('auth.sessions');
      }

      rebuildTable('bp_sessions', `CREATE TABLE __NEW__ (
        id TEXT PRIMARY KEY,
        match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        game_number INTEGER NOT NULL,
        room TEXT NOT NULL CHECK (room IN ('A', 'B')),
        attempt INTEGER NOT NULL DEFAULT 1,
        replay_of TEXT REFERENCES __NEW__(id) ON DELETE CASCADE,
        output_mode TEXT NOT NULL DEFAULT 'nickname' CHECK (output_mode IN ('nickname', 'character')),
        status TEXT NOT NULL DEFAULT 'ready'
          CHECK (status IN ('ready', 'active', 'completed', 'replay', 'forfeited')),
        current_phase_index INTEGER NOT NULL DEFAULT -1,
        commentator_image_id TEXT,
        commentator_image_name TEXT,
        timer_duration_seconds INTEGER NOT NULL DEFAULT 30,
        timer_remaining_seconds INTEGER NOT NULL DEFAULT 30,
        timer_running INTEGER NOT NULL DEFAULT 0,
        timer_deadline_ms INTEGER,
        timer_transition_pending INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        UNIQUE (match_id, game_number, room, attempt)
      )`, 'id, match_id, game_number, room, attempt, replay_of, output_mode, status, current_phase_index, commentator_image_id, commentator_image_name, timer_duration_seconds, timer_remaining_seconds, timer_running, timer_deadline_ms, timer_transition_pending, created_at, updated_at, revision');
      db.exec('CREATE INDEX idx_bp_sessions_match ON bp_sessions(match_id)');
      db.exec('CREATE INDEX idx_bp_sessions_status ON bp_sessions(status)');

      rebuildTable('bp_session_slots', `CREATE TABLE __NEW__ (
        session_id TEXT NOT NULL REFERENCES bp_sessions(id) ON DELETE CASCADE,
        slot_id TEXT NOT NULL REFERENCES bp_slots(id) ON DELETE CASCADE,
        character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
        player_id TEXT REFERENCES players(player_id) ON DELETE SET NULL,
        player_text TEXT,
        PRIMARY KEY (session_id, slot_id)
      )`, 'session_id, slot_id, character_id, player_id, player_text');

      rebuildTable('bp_forfeits', `CREATE TABLE __NEW__ (
        match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        room TEXT NOT NULL CHECK (room IN ('A', 'B')),
        forfeiting_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
        winner_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
        active INTEGER NOT NULL DEFAULT 1,
        declared_at INTEGER NOT NULL,
        revoked_at INTEGER,
        session_states_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (match_id, room)
      )`, 'match_id, room, forfeiting_team_id, winner_team_id, active, declared_at, revoked_at, session_states_json');

      rebuildTable('bp_phase_slots', `CREATE TABLE __NEW__ (
        phase_id TEXT NOT NULL REFERENCES bp_phases(id) ON DELETE CASCADE,
        slot_id TEXT NOT NULL REFERENCES bp_slots(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (phase_id, slot_id)
      )`, 'phase_id, slot_id, sort_order');

      rebuildTable('bp_ui_sections', `CREATE TABLE __NEW__ (
        kind TEXT NOT NULL,
        slot_id TEXT NOT NULL REFERENCES bp_slots(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (kind, slot_id)
      )`, 'kind, slot_id, sort_order');

      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length) {
        throw new Error(`外键校验失败：${JSON.stringify(violations.slice(0, 5))}`);
      }
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

seedCommunicationChannels();

// 嵌套感知事务：内层调用发生在外层事务内时直接并入，由最外层统一提交或回滚。
// 供跨服务组合写入使用（如消息与其通知共用同一原子边界），避免嵌套 BEGIN 报错。
function runTransaction(database, fn) {
  const depth = transactionDepths.get(database) || 0;
  if (depth > 0) return fn();
  database.exec('BEGIN');
  transactionDepths.set(database, 1);
  try {
    const result = fn();
    database.exec('COMMIT');
    transactionDepths.delete(database);
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    transactionDepths.delete(database);
    throw error;
  }
}

// v32（schema 33）：数据层遗留收口——characters 昵称列收 NOT NULL（迁移已回填，库内零 NULL）、
// players.slot 加域 CHECK（escape1-8 / hunter1-2 / substitute1-5）、asset_path_sync_records 补自增主键。
// 沿用 v32 的重建套路：foreign_keys OFF 期间重建，逐表行数守恒断言，结束前 foreign_key_check。
function migrateDataHygieneV32() {
  const rebuildTable = (table, createSql, columns) => {
    const expected = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    db.exec(createSql.replaceAll('__NEW__', `${table}_new`));
    db.exec(`INSERT INTO ${table}_new (${columns}) SELECT ${columns} FROM ${table}`);
    const copied = db.prepare(`SELECT COUNT(*) AS n FROM ${table}_new`).get().n;
    if (copied !== expected) throw new Error(`${table} 迁移复制行数不符（${copied} != ${expected}）`);
    db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
  };
  db.exec('PRAGMA foreign_keys = OFF');
  // players 被视图 v_team_candidates 引用：RENAME 默认会重新解析全部视图，
  // 重建窗口内开启 legacy_alter_table 跳过视图重解析，结束后恢复
  db.exec('PRAGMA legacy_alter_table = ON');
  try {
    withTransaction(() => {
      rebuildTable('characters', `CREATE TABLE __NEW__ (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('escape', 'hunter')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        nickname TEXT NOT NULL,
        display_name TEXT NOT NULL,
        release_date_text TEXT,
        portrait_url TEXT
      )`, 'id, role, sort_order, enabled, nickname, display_name, release_date_text, portrait_url');

      rebuildTable('players', `CREATE TABLE __NEW__ (
        player_id TEXT NOT NULL PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('escape', 'hunter')),
        slot TEXT NOT NULL CHECK (slot IN (
          'escape1', 'escape2', 'escape3', 'escape4', 'escape5', 'escape6', 'escape7', 'escape8',
          'hunter1', 'hunter2', 'substitute1', 'substitute2', 'substitute3', 'substitute4', 'substitute5'
        )),
        nickname TEXT,
        official_id TEXT UNIQUE,
        registered_nickname TEXT,
        registered_official_id TEXT,
        is_substitute INTEGER NOT NULL DEFAULT 0
      )`, 'player_id, team_id, role, slot, nickname, official_id, registered_nickname, registered_official_id, is_substitute');

      rebuildTable('asset_path_sync_records', `CREATE TABLE __NEW__ (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_id TEXT NOT NULL REFERENCES asset_path_syncs(id) ON DELETE CASCADE,
        object_type TEXT NOT NULL,
        source_name TEXT NOT NULL,
        filter_name TEXT,
        setting_path TEXT NOT NULL,
        setting_tokens_json TEXT NOT NULL DEFAULT '[]',
        before TEXT,
        after TEXT
      )`, 'sync_id, object_type, source_name, filter_name, setting_path, setting_tokens_json, before, after');

      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length) {
        throw new Error(`外键校验失败：${JSON.stringify(violations.slice(0, 5))}`);
      }
    });
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF');
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// v33（schema 34）：赛事媒体 BLOB 落盘为文件——库内只留元数据与路径，
// 数据库体积不再随每届物料上传线性增长。data 列放松为可空（新行走文件），file_path 存相对路径。
// 历史字节在此一次性写出；行数守恒断言沿用既有套路。
function migrateEventMediaToFilesV33() {
  const mediaRoot = path.join(__dirname, '..', 'public', 'assets', 'event-media');
  fs.mkdirSync(mediaRoot, { recursive: true });
  const rebuild = (table, createSql, columns) => {
    const expected = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    db.exec(createSql.replaceAll('__NEW__', `${table}_new`));
    db.exec(`INSERT INTO ${table}_new (${columns}) SELECT ${columns} FROM ${table}`);
    const copied = db.prepare(`SELECT COUNT(*) AS n FROM ${table}_new`).get().n;
    if (copied !== expected) throw new Error(`${table} 迁移复制行数不符（${copied} != ${expected}）`);
    db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
  };
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    withTransaction(() => {
      rebuild('tournament_event_media', `CREATE TABLE __NEW__ (
        tournament_event_id TEXT NOT NULL REFERENCES tournament_events(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('logo', 'cover', 'group_qr')),
        mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
        data BLOB,
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 4194304),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        file_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tournament_event_id, kind),
        CHECK ((data IS NOT NULL) = (file_path IS NULL))
      )`, 'tournament_event_id, kind, mime_type, data, byte_size, sha256, created_at, updated_at');

      const rows = db.prepare('SELECT tournament_event_id, kind, mime_type, data, sha256 FROM tournament_event_media WHERE data IS NOT NULL').all();
      for (const row of rows) {
        const extension = row.mime_type === 'image/jpeg' ? '.jpg' : row.mime_type === 'image/webp' ? '.webp' : '.png';
        const fileName = `${row.tournament_event_id}-${row.kind}-${row.sha256.slice(0, 12)}${extension}`;
        fs.writeFileSync(path.join(mediaRoot, fileName), row.data);
        db.prepare('UPDATE tournament_event_media SET file_path = ?, data = NULL WHERE tournament_event_id = ? AND kind = ? AND sha256 = ?')
          .run(path.posix.join('assets', 'event-media', fileName), row.tournament_event_id, row.kind, row.sha256);
      }

      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length) {
        throw new Error(`外键校验失败：${JSON.stringify(violations.slice(0, 5))}`);
      }
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function withTransaction(fn) {
  return runTransaction(db, fn);
}

// 语句缓存：热路径（BP 持久化等每次调用都重复 prepare 的固定 SQL）复用已编译语句，
// 免去重复解析开销。单连接上 StatementSync 可安全复用，参数经 run() 传入。
const statementCache = new Map();
function cachedStatement(sql) {
  let statement = statementCache.get(sql);
  if (!statement) {
    statement = db.prepare(sql);
    statementCache.set(sql, statement);
  }
  return statement;
}

// 运行时维护：每小时 PRAGMA optimize 更新查询统计；WAL 做一次 TRUNCATE checkpoint
// 把 -wal 文件收缩回零（autocheckpoint 只复用空间不回缩文件，活跃期 WAL 可涨到 10M 级）。
if (!IN_MEMORY) {
  const maintenanceTimer = setInterval(() => {
    try {
      db.exec('PRAGMA optimize');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (error) {
      console.error('[db] 周期维护失败:', error.message);
    }
  }, 60 * 60 * 1000);
  maintenanceTimer.unref?.();
}

module.exports = {
  SCHEMA_VERSION,
  DB_PATH,
  IN_MEMORY,
  db,
  withTransaction,
  runTransaction,
  cachedStatement
};
