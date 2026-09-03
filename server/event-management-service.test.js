const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const {
  applyEventAction,
  createManagedEvent,
  managedEventSnapshot,
  readEventMedia,
  updateManagedEvent
} = require('./event-management-service');

function fixture(t) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE events (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, division TEXT NOT NULL, stage TEXT NOT NULL,
      stage_label TEXT, date TEXT, mode TEXT, format TEXT, sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE event_management_profiles (
      event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      description TEXT NOT NULL DEFAULT '', max_teams INTEGER, event_type TEXT NOT NULL DEFAULT 'private',
      require_real_name INTEGER NOT NULL DEFAULT 0, visibility TEXT NOT NULL DEFAULT 'system',
      registration_method TEXT NOT NULL DEFAULT 'invite', team_requirement TEXT NOT NULL DEFAULT 'any',
      start_date TEXT, end_date TEXT, registration_start TEXT, registration_end TEXT,
      min_team_members INTEGER, max_team_members INTEGER, require_system_login INTEGER NOT NULL DEFAULT 1,
      organizer_type TEXT NOT NULL DEFAULT 'personal', organizer_name TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '', rules_text TEXT NOT NULL DEFAULT '', manual_status TEXT,
      marked INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE event_media (
      event_id TEXT, kind TEXT, mime_type TEXT, data BLOB, byte_size INTEGER, sha256 TEXT,
      created_at INTEGER, updated_at INTEGER, PRIMARY KEY (event_id, kind)
    );
    CREATE TABLE event_teams (event_id TEXT, team_id TEXT);
    CREATE TABLE matches (
      id TEXT PRIMARY KEY, event_id TEXT, date TEXT, start_time TEXT, matchup_home TEXT,
      matchup_away TEXT, winner_team_id TEXT, sort_order INTEGER
    );
  `);
  t.after(() => database.close());
  return database;
}

function input(overrides = {}) {
  return {
    name: '星澜测试赛',
    format: 'BO3 双败淘汰',
    maxTeams: 8,
    description: '用于赛事管理测试。',
    eventType: 'private',
    requireRealName: true,
    visibility: 'system',
    registrationMethod: 'invite',
    teamRequirement: 'any',
    division: 'pc',
    startDate: '2026-09-02',
    endDate: '2026-09-04',
    registrationStart: '2026-08-20',
    registrationEnd: '2026-09-01',
    minTeamMembers: 2,
    maxTeamMembers: 10,
    requireSystemLogin: true,
    organizerType: 'organization',
    organizerName: '星澜赛事组',
    contact: 'events@example.test',
    rulesText: '遵守赛事规则。',
    ...overrides
  };
}

test('formal event creation persists management fields and hosted media', t => {
  const database = fixture(t);
  const event = createManagedEvent(database, input({
    logoChanged: true,
    logo: 'data:image/png;base64,iVBORw0KGgo='
  }));
  assert.equal(event.name, '星澜测试赛');
  assert.equal(event.maxTeams, 8);
  assert.equal(event.organizerName, '星澜赛事组');
  assert.equal(event.status, 'live');
  assert.match(event.logoUrl, /^\/api\/events\/.+\/media\/logo\?v=/);
  assert.equal(readEventMedia(database, event.id, 'logo').mime_type, 'image/png');
});

test('event filters and manual actions use persisted state', t => {
  const database = fixture(t);
  const event = createManagedEvent(database, input({ startDate: '2026-10-01', endDate: '2026-10-02' }));
  assert.equal(managedEventSnapshot(database, 'live', '2026-09-02').items.length, 0);
  assert.equal(applyEventAction(database, event.id, 'start').status, 'live');
  assert.equal(managedEventSnapshot(database, 'live', '2026-09-02').items.length, 1);
  assert.equal(applyEventAction(database, event.id, 'toggle-mark').marked, true);
  assert.equal(applyEventAction(database, event.id, 'end').status, 'completed');
});

test('event editing validates dates and updates only the selected event', t => {
  const database = fixture(t);
  const event = createManagedEvent(database, input());
  const updated = updateManagedEvent(database, event.id, input({ name: '星澜正式赛', maxTeams: 16 }));
  assert.equal(updated.name, '星澜正式赛');
  assert.equal(updated.maxTeams, 16);
  assert.throws(() => updateManagedEvent(database, event.id, input({
    startDate: '2026-09-05', endDate: '2026-09-04'
  })), /结束日期/);
  assert.throws(() => createManagedEvent(database, input({ eventType: 'public' })), /赛事类型/);
});
