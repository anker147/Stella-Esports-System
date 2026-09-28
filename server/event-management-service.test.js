const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const {
  applyEventAction,
  createManagedEvent,
  findEventTeamCandidates,
  linkScheduleMatch,
  managedEventSnapshot,
  readEventMedia,
  resolveScheduleEvent,
  updateManagedEvent
} = require('./event-management-service');

function fixture(t) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE tournament_events (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, division TEXT NOT NULL, stage TEXT NOT NULL,
      mode TEXT, format TEXT, priority INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '', max_teams INTEGER, event_type TEXT NOT NULL DEFAULT 'private',
      require_real_name INTEGER NOT NULL DEFAULT 0, visibility TEXT NOT NULL DEFAULT 'system',
      registration_method TEXT NOT NULL DEFAULT 'invite', team_requirement TEXT NOT NULL DEFAULT 'any',
      start_date TEXT, end_date TEXT, registration_start TEXT, registration_end TEXT,
      min_team_members INTEGER, max_team_members INTEGER, require_system_login INTEGER NOT NULL DEFAULT 1,
      organizer_type TEXT NOT NULL DEFAULT 'personal', organizer_name TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '', handbook_url TEXT NOT NULL DEFAULT '', contact_group TEXT NOT NULL DEFAULT '',
      contact_group_url TEXT NOT NULL DEFAULT '', rules_text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
      marked INTEGER NOT NULL DEFAULT 0, created_by TEXT, started_at INTEGER, ended_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE tournament_event_media (
      tournament_event_id TEXT, kind TEXT, mime_type TEXT, data BLOB, byte_size INTEGER, sha256 TEXT,
      file_path TEXT,
      created_at INTEGER, updated_at INTEGER, PRIMARY KEY (tournament_event_id, kind)
    );
    CREATE TABLE tournament_schedule_links (
      tournament_event_id TEXT, match_id TEXT UNIQUE, created_by TEXT, created_at INTEGER,
      PRIMARY KEY (tournament_event_id, match_id)
    );
    CREATE TABLE tournament_event_teams (tournament_event_id TEXT, team_id TEXT, created_at INTEGER);
    CREATE TABLE teams (id TEXT PRIMARY KEY, display_name TEXT, division TEXT);
    CREATE TABLE players (player_id TEXT, team_id TEXT, role TEXT);
    CREATE TABLE team_logos (team_id TEXT, kind TEXT, web_file TEXT);
    CREATE TABLE events (id TEXT, division TEXT);
    CREATE TABLE event_teams (event_id TEXT, team_id TEXT);
    CREATE TABLE match_rooms (match_id TEXT, room TEXT, escape_team_id TEXT, hunter_team_id TEXT);
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
    teamIds: ['team-a', 'team-b'],
    ...overrides
  };
}

test('formal event creation persists management fields and hosted media', t => {
  const database = fixture(t);
  database.exec("INSERT INTO teams VALUES ('team-a', 'A队', NULL), ('team-b', 'B队', NULL); INSERT INTO players VALUES ('a1', 'team-a', 'escape'), ('a2', 'team-a', 'hunter'), ('b1', 'team-b', 'escape'), ('b2', 'team-b', 'hunter'); INSERT INTO events VALUES ('legacy-pc', 'pc'); INSERT INTO event_teams VALUES ('legacy-pc', 'team-a'), ('legacy-pc', 'team-b');");
  const event = createManagedEvent(database, input({
    logoChanged: true,
    logo: 'data:image/png;base64,iVBORw0KGgo='
  }));
  assert.equal(event.name, '星澜测试赛');
  assert.equal(event.maxTeams, 8);
  assert.equal(event.organizerName, '星澜赛事组');
  assert.equal(event.status, 'upcoming');
  assert.match(event.logoUrl, /^\/api\/events\/.+\/media\/logo\?v=/);
  assert.equal(readEventMedia(database, event.id, 'logo').mime_type, 'image/png');
});

test('event filters and manual actions use persisted state', t => {
  const database = fixture(t);
  database.exec("INSERT INTO teams VALUES ('team-a', 'A队', NULL), ('team-b', 'B队', NULL); INSERT INTO players VALUES ('a1', 'team-a', 'escape'), ('a2', 'team-a', 'hunter'), ('b1', 'team-b', 'escape'), ('b2', 'team-b', 'hunter'); INSERT INTO events VALUES ('legacy-pc', 'pc'); INSERT INTO event_teams VALUES ('legacy-pc', 'team-a'), ('legacy-pc', 'team-b');");
  const event = createManagedEvent(database, input({ startDate: '2026-10-01', endDate: '2026-10-02' }));
  assert.equal(managedEventSnapshot(database, 'live', '2026-09-02').items.length, 0);
  assert.equal(applyEventAction(database, event.id, 'start').status, 'live');
  assert.equal(managedEventSnapshot(database, 'live', '2026-09-02').items.length, 1);
  assert.equal(applyEventAction(database, event.id, 'toggle-mark').marked, true);
  assert.equal(applyEventAction(database, event.id, 'end').status, 'completed');
});

test('event editing validates dates and updates only the selected event', t => {
  const database = fixture(t);
  database.exec("INSERT INTO teams VALUES ('team-a', 'A队', NULL), ('team-b', 'B队', NULL); INSERT INTO players VALUES ('a1', 'team-a', 'escape'), ('a2', 'team-a', 'hunter'), ('b1', 'team-b', 'escape'), ('b2', 'team-b', 'hunter'); INSERT INTO events VALUES ('legacy-pc', 'pc'); INSERT INTO event_teams VALUES ('legacy-pc', 'team-a'), ('legacy-pc', 'team-b');");
  const event = createManagedEvent(database, input());
  const updated = updateManagedEvent(database, event.id, input({ name: '星澜正式赛', maxTeams: 16 }));
  assert.equal(updated.name, '星澜正式赛');
  assert.equal(updated.maxTeams, 16);
  assert.throws(() => updateManagedEvent(database, event.id, input({
    startDate: '2026-09-05', endDate: '2026-09-04'
  })), /结束日期/);
  assert.throws(() => createManagedEvent(database, input({ eventType: 'public' })), /赛事类型/);
});

test('schedule links require a live event and default to the highest priority live event', t => {
  const database = fixture(t);
  database.exec("INSERT INTO teams VALUES ('team-a', 'A队', NULL), ('team-b', 'B队', NULL); INSERT INTO players VALUES ('a1', 'team-a', 'escape'), ('a2', 'team-a', 'hunter'), ('b1', 'team-b', 'escape'), ('b2', 'team-b', 'hunter'); INSERT INTO events VALUES ('legacy-pc', 'pc'); INSERT INTO event_teams VALUES ('legacy-pc', 'team-a'), ('legacy-pc', 'team-b');");
  const low = createManagedEvent(database, input({ name: '次级赛事', priority: 10 }));
  const high = createManagedEvent(database, input({ name: '顶级赛事', priority: 100 }));
  database.prepare(`INSERT INTO matches
    (id, event_id, date, start_time, matchup_home, matchup_away, winner_team_id, sort_order)
    VALUES ('match-1', 'legacy-event', '2026-09-03', '14:00', 'A', 'B', NULL, 0)`).run();
  assert.throws(() => linkScheduleMatch(database, high.id, 'match-1'), /启动后/);
  applyEventAction(database, low.id, 'start');
  applyEventAction(database, high.id, 'start');
  linkScheduleMatch(database, high.id, 'match-1');
  assert.equal(resolveScheduleEvent(database).id, high.id);
  assert.equal(resolveScheduleEvent(database, low.id).id, low.id);
  assert.equal(database.prepare('SELECT tournament_event_id FROM tournament_schedule_links').get().tournament_event_id, high.id);
});

test('formal event creation enforces team count on the server', t => {
  const database = fixture(t);
  database.exec("INSERT INTO teams VALUES ('team-a', 'A队', NULL), ('team-b', 'B队', NULL); INSERT INTO players VALUES ('a1', 'team-a', 'escape'), ('a2', 'team-a', 'hunter'), ('b1', 'team-b', 'escape'), ('b2', 'team-b', 'hunter'); INSERT INTO events VALUES ('legacy-pc', 'pc'); INSERT INTO event_teams VALUES ('legacy-pc', 'team-a'), ('legacy-pc', 'team-b');");
  assert.throws(() => createManagedEvent(database, input({ teamIds: ['team-a'] })), /至少需要选择两支/);
  assert.throws(() => createManagedEvent(database, input({ maxTeams: 2, teamIds: ['team-a', 'team-b', 'team-c'] })), /不能超过最大队伍数/);
});

test('team candidates read division, roster and match data from team tables', t => {
  const database = fixture(t);
  database.exec(`INSERT INTO teams VALUES ('team-a', 'A队', 'pc'), ('team-b', 'B队', NULL), ('team-c', 'C队', 'mobile'), ('team-d', 'D队', NULL);
    INSERT INTO players VALUES ('a1', 'team-a', 'escape'), ('a2', 'team-a', 'hunter'), ('a3', 'team-a', 'escape'),
      ('b1', 'team-b', 'escape'), ('c1', 'team-c', 'escape'), ('c2', 'team-c', 'hunter'), ('d1', 'team-d', 'escape');
    INSERT INTO team_logos VALUES ('team-a', 'escape', '/assets/team-a-escape.png'), ('team-a', 'hunter', '/assets/team-a-hunter.png');
    INSERT INTO events VALUES ('legacy-pc', 'pc');
    INSERT INTO event_teams VALUES ('legacy-pc', 'team-a');
    INSERT INTO matches (id, event_id, date, start_time, matchup_home, matchup_away, winner_team_id, sort_order)
      VALUES ('match-a', 'legacy', '2026-09-03', '14:00', 'A', 'B', 'team-a', 0),
             ('match-b', 'legacy', '2026-09-04', '15:00', 'C', 'D', 'team-b', 1),
             ('match-d', 'legacy-pc', '2026-09-05', '16:00', 'X', 'Y', NULL, 2);
    INSERT INTO match_rooms VALUES ('match-d', 'A', 'team-d', 'team-a');`);
  const all = findEventTeamCandidates(database, 'all', 1, 99);
  assert.equal(all.length, 4);
  const teamA = all.find(team => team.id === 'team-a');
  assert.equal(teamA.division, 'pc');
  assert.equal(teamA.memberCount, 3);
  assert.equal(teamA.escapeCount, 2);
  assert.equal(teamA.hunterCount, 1);
  assert.equal(teamA.eventCount, 1);
  assert.equal(teamA.matchWins, 1);
  assert.equal(teamA.logoUrl, '/assets/team-a-escape.png');
  assert.deepEqual(teamA.logos, { escape: '/assets/team-a-escape.png', hunter: '/assets/team-a-hunter.png' });
  assert.equal(all.find(team => team.id === 'team-b').division, null);
  // 未登记赛区但只打过 PC 端比赛的战队按比赛数据推导为 PC
  assert.equal(all.find(team => team.id === 'team-d').division, 'pc');
  assert.deepEqual(findEventTeamCandidates(database, 'pc', 1, 99).map(team => team.id), ['team-a', 'team-b', 'team-d']);
  assert.deepEqual(findEventTeamCandidates(database, 'mobile', 1, 99).map(team => team.id), ['team-b', 'team-c']);
  assert.deepEqual(findEventTeamCandidates(database, 'pc', 3, 99).map(team => team.id), ['team-a']);
});

test('team candidates keep logos when optional match tables are missing', t => {
  const database = fixture(t);
  database.exec(`INSERT INTO teams VALUES ('team-a', 'A队', 'pc'), ('team-b', 'B队', NULL);
    INSERT INTO players VALUES ('a1', 'team-a', 'escape'), ('a2', 'team-a', 'hunter'), ('b1', 'team-b', 'escape');
    INSERT INTO team_logos VALUES ('team-a', 'escape', '/assets/team-a-escape.png');
    INSERT INTO events VALUES ('legacy-pc', 'pc');
    INSERT INTO event_teams VALUES ('legacy-pc', 'team-a');`);
  database.exec('DROP TABLE match_rooms;');
  const rows = findEventTeamCandidates(database, 'all', 1, 99);
  const teamA = rows.find(team => team.id === 'team-a');
  assert.equal(teamA.logoUrl, '/assets/team-a-escape.png');
  assert.equal(teamA.division, 'pc');
  assert.equal(teamA.eventCount, 1);
  assert.equal(teamA.matchWins, 0);
});
