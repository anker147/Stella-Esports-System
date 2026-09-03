const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const {
  listEvents,
  listMatchRecords,
  listPlayers,
  listSchedule,
  listTeams
} = require('./operations-service');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE events (id TEXT PRIMARY KEY, name TEXT, division TEXT, stage TEXT, stage_label TEXT,
      date TEXT, mode TEXT, format TEXT, schedule_image TEXT, stage_image TEXT, source_workbook TEXT,
      source_workbook_sha256 TEXT, sort_order INTEGER);
    CREATE TABLE matches (id TEXT PRIMARY KEY, event_id TEXT, date TEXT, start_time TEXT, end_time TEXT,
      mode TEXT, format TEXT, matchup_home TEXT, matchup_away TEXT, winner_team_id TEXT, sort_order INTEGER);
    CREATE TABLE match_rooms (match_id TEXT, room TEXT, escape_team_id TEXT, hunter_team_id TEXT);
    CREATE TABLE teams (id TEXT PRIMARY KEY, display_name TEXT);
    CREATE TABLE event_teams (event_id TEXT, team_id TEXT, sort_order INTEGER);
    CREATE TABLE team_logos (team_id TEXT, kind TEXT, web_file TEXT);
    CREATE TABLE players (player_id TEXT PRIMARY KEY, team_id TEXT, role TEXT, slot INTEGER,
      nickname TEXT, official_id TEXT, registered_nickname TEXT, registered_official_id TEXT,
      is_substitute INTEGER);
    CREATE TABLE bp_sessions (id TEXT PRIMARY KEY, match_id TEXT, game_number INTEGER, room TEXT,
      attempt INTEGER, replay_of TEXT, updated_at INTEGER);
    CREATE TABLE bp_session_results (session_id TEXT PRIMARY KEY, winner_role TEXT,
      winner_team_id TEXT, decided_at INTEGER);
  `);
  db.prepare(`INSERT INTO events VALUES
    ('event-1', '测试杯', 'pc', 'final', '总决赛', '2026-09-01', 'BO3', '双房', NULL, NULL, 'E:/data/source.xlsx', 'abcdef', 1)`).run();
  db.prepare("INSERT INTO teams VALUES ('alpha', 'Alpha'), ('beta', 'Beta')").run();
  db.prepare("INSERT INTO event_teams VALUES ('event-1', 'alpha', 1), ('event-1', 'beta', 2)").run();
  db.prepare("INSERT INTO team_logos VALUES ('alpha', 'escape', '/alpha.png'), ('beta', 'hunter', '/beta.png')").run();
  db.prepare(`INSERT INTO players VALUES
    ('p1', 'alpha', 'escape', 1, 'A-one', '1001', 'A-one', '1001', 0),
    ('p2', 'beta', 'hunter', 1, 'B-one', '2001', 'B-one', '2001', 1)`).run();
  db.prepare(`INSERT INTO matches VALUES
    ('match-1', 'event-1', '2026-09-01', '14:00', '16:00', 'BO3', '双房', 'alpha', 'beta', 'beta', 1)`).run();
  db.prepare("INSERT INTO match_rooms VALUES ('match-1', 'A', 'alpha', 'beta')").run();
  db.prepare(`INSERT INTO bp_sessions VALUES
    ('original', 'match-1', 1, 'A', 1, NULL, 10),
    ('replay', 'match-1', 1, 'A', 2, 'original', 20),
    ('game-2', 'match-1', 2, 'A', 1, NULL, 30)`).run();
  db.prepare(`INSERT INTO bp_session_results VALUES
    ('original', 'escape', 'alpha', 10),
    ('replay', 'hunter', 'beta', 20),
    ('game-2', 'hunter', 'beta', 30)`).run();
  return db;
}

test('operations event, team and player views preserve relational counts', t => {
  const db = fixture(t);
  const events = listEvents(db, { today: '2026-09-01' });
  assert.equal(events.items[0].teamCount, 2);
  assert.equal(events.items[0].playerCount, 2);
  assert.equal(events.items[0].sourceName, 'source.xlsx');

  const teams = listTeams(db);
  assert.equal(teams.total, 2);
  assert.equal(teams.items.find(team => team.id === 'alpha').playerCount, 1);

  const players = listPlayers(db, { role: 'hunter' });
  assert.equal(players.total, 1);
  assert.equal(players.items[0].substitute, true);
});

test('schedule and match records use only the highest replay attempt', t => {
  const db = fixture(t);
  const schedule = listSchedule(db);
  assert.equal(schedule.items[0].gameCount, 2);
  assert.equal(schedule.items[0].completedGameCount, 2);

  const records = listMatchRecords(db);
  assert.equal(records.items[0].effectiveGameCount, 2);
  assert.equal(records.items[0].completedGameCount, 2);
  assert.deepEqual(records.items[0].score, { home: 0, away: 2 });
  assert.equal(records.items[0].highestAttempt, 2);
  assert.equal(records.items[0].replayCount, 1);
});

test('every initial operations navigation entry owns a page panel and data view', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'operations-center.js'), 'utf8');
  const eventScript = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'event-management.js'), 'utf8');
  const text = JSON.parse(fs.readFileSync(path.join(root, 'public', 'assets', 'data', 'ui-text.json'), 'utf8'));
  const pages = {
    schedule: 'schedule', teams: 'teams', players: 'players',
    resourceMonitor: 'resources', matchRecords: 'matches', dataConfig: 'dataConfig',
    terminalStatus: 'terminal', systemSettings: 'settings', riskResponse: 'alerts'
  };
  for (const [page, view] of Object.entries(pages)) {
    assert.match(html, new RegExp(`data-page="${page}"`));
    assert.match(html, new RegExp(`data-page-panel="${page}"`));
    assert.match(html, new RegExp(`data-operations-root="${view}"`));
    assert.equal(typeof text[`page.${page}.title`], 'string');
    assert.equal(typeof text[`page.${page}.desc`], 'string');
    assert.match(script, new RegExp(`${page}: '${view}'`));
  }
  assert.match(html, /data-page="events"/);
  assert.match(html, /data-page-panel="events"[\s\S]*id="eventManagementRoot"/);
  assert.match(eventScript, /\/api\/events/);
  assert.equal(typeof text['page.events.title'], 'string');
  assert.equal(typeof text['page.events.desc'], 'string');
  assert.doesNotMatch(html, /data-soon=/);
});

test('HUD center exclusively owns the Web HUB card after migration', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'operations-center.js'), 'utf8');
  const cache = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'data-cache.js'), 'utf8');
  const hud = html.match(/<section class="page-view" id="hudCenterPage"[\s\S]*?<\/section>/)?.[0] || '';
  const countdown = html.match(/<section class="page-view" id="countdownPage"[\s\S]*?<\/section>/)?.[0] || '';

  assert.match(hud, /id="hubUrl"/);
  assert.match(hud, /id="copyHub"/);
  assert.doesNotMatch(hud, /data-operations-root="hud"/);
  assert.doesNotMatch(countdown, /id="hubUrl"|id="copyHub"/);
  assert.doesNotMatch(script, /hudCenter:\s*'hud'|renderHud\s*\(/);
  assert.doesNotMatch(cache, /hudCenter:\s*\[\/api\/operations\/hud/);
});

test('countdown center uses the landscape split and portrait stack layout', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'assets', 'css', 'control.css'), 'utf8');
  const control = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'control.js'), 'utf8');
  const countdown = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'countdown.js'), 'utf8');

  assert.match(html, /class="card preview-card countdown-output-card"/);
  assert.match(html, /id="previewDigits">00:00:48</);
  assert.match(html, /id="hours"[^>]*min="0"[^>]*step="1"/);
  assert.match(html, /id="minutes"[^>]*max="59"/);
  assert.match(html, /countdown-primary-column[\s\S]*countdown-input-row[\s\S]*countdown-target-card[\s\S]*countdown-duration-card[\s\S]*countdown-controls-card/);
  assert.match(html, /countdown-secondary-column[\s\S]*bp-timer-settings-card[\s\S]*log-card/);
  assert.match(css, /\.content-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 3\.8fr\) minmax\(0, 6\.2fr\)/);
  assert.match(css, /\.countdown-input-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 5\.5fr\) minmax\(0, 4\.5fr\)/);
  assert.match(css, /\.countdown-secondary-column\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 5\.5fr\) minmax\(0, 4\.5fr\)/);
  assert.match(css, /\.countdown-secondary-column \.log-list[\s\S]*?overflow:\s*auto/);
  assert.match(css, /\.countdown-secondary-column \.log-list[\s\S]*?max-height:\s*none/);
  assert.match(css, /\.countdown-secondary-column \.bp-timer-settings[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.countdown-controls-card \.control-buttons\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3/);
  assert.match(css, /\.bp-timer-settings\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/);
  assert.match(css, /@media \(orientation: portrait\), \(max-width: 1180px\)/);
  assert.match(control, /phase\.role === group\.role/);
  assert.doesNotMatch(control, /logList\.children\.length > 10/);
  assert.match(control, /elements\.targetAt\.value = ''/);
  assert.match(countdown, /String\(hours\)\.padStart\(2, '0'\)/);
  assert.match(countdown, /hours > 0/);
  assert.doesNotMatch(countdown, /99 \* 60 \+ 59/);
});
