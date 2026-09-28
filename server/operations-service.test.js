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
  listTeams,
  teamDetail
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
    CREATE TABLE tournament_events (
      id TEXT PRIMARY KEY, name TEXT, division TEXT, stage TEXT, format TEXT, priority INTEGER,
      status TEXT, start_date TEXT, started_at INTEGER, created_at INTEGER
    );
    CREATE TABLE tournament_schedule_links (tournament_event_id TEXT, match_id TEXT);
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
  db.prepare(`INSERT INTO tournament_events VALUES
    ('managed-1', '当前测试赛', 'pc', '总决赛', 'BO3 双败', 100, 'live', '2026-09-01', 10, 1)`).run();
  db.prepare("INSERT INTO tournament_schedule_links VALUES ('managed-1', 'match-1')").run();
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

test('teamDetail returns roster, events, records and totals for the expandable team card', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE events (id TEXT PRIMARY KEY, name TEXT, division TEXT, stage TEXT, stage_label TEXT,
      date TEXT, mode TEXT, format TEXT, sort_order INTEGER);
    CREATE TABLE matches (id TEXT PRIMARY KEY, event_id TEXT, date TEXT, start_time TEXT,
      matchup_home TEXT, matchup_away TEXT, winner_team_id TEXT, sort_order INTEGER);
    CREATE TABLE teams (id TEXT PRIMARY KEY, display_name TEXT, division TEXT, aliases_json TEXT);
    CREATE TABLE event_teams (event_id TEXT, team_id TEXT, sort_order INTEGER);
    CREATE TABLE players (player_id TEXT PRIMARY KEY, team_id TEXT, role TEXT, slot INTEGER,
      nickname TEXT, official_id TEXT, registered_nickname TEXT, registered_official_id TEXT,
      is_substitute INTEGER);
    CREATE TABLE characters (id TEXT PRIMARY KEY, role TEXT, nickname TEXT, portrait_url TEXT);
    CREATE TABLE match_rooms (match_id TEXT, room TEXT, escape_team_id TEXT, hunter_team_id TEXT);
    CREATE TABLE bp_sessions (id TEXT PRIMARY KEY, match_id TEXT, game_number INTEGER, room TEXT,
      attempt INTEGER, replay_of TEXT, updated_at INTEGER);
    CREATE TABLE bp_session_slots (session_id TEXT, slot_id TEXT, character_id TEXT,
      player_id TEXT, player_text TEXT);
    CREATE TABLE bp_session_results (session_id TEXT PRIMARY KEY, winner_role TEXT,
      winner_team_id TEXT, decided_at INTEGER);
  `);
  db.prepare(`INSERT INTO events VALUES ('event-1', '测试杯', 'pc', 'final', '总决赛', '2026-09-01', 'BO3', '双房', 1)`).run();
  db.prepare(`INSERT INTO teams VALUES
    ('alpha', 'Alpha战队', 'pc', '["A队","Alpha"]'),
    ('beta', 'Beta战队', 'mobile', NULL)`).run();
  db.prepare(`INSERT INTO event_teams VALUES ('event-1', 'alpha', 1), ('event-1', 'beta', 2)`).run();
  db.prepare(`INSERT INTO players VALUES
    ('p1', 'alpha', 'escape', 1, 'A-one', '1001', NULL, NULL, 0),
    ('p2', 'alpha', 'escape', 2, 'A-two', '1002', '注册A2', '1002', 0),
    ('p3', 'alpha', 'hunter', 1, 'A-hunter', '1003', NULL, NULL, 0),
    ('p4', 'alpha', 'hunter', 2, 'A-sub', '1004', NULL, NULL, 1)`).run();
  db.prepare(`INSERT INTO matches VALUES
    ('match-1', 'event-1', '2026-09-01', '14:00', 'alpha', 'beta', 'beta', 1),
    ('match-2', 'event-1', '2026-09-02', '15:00', 'beta', 'alpha', 'alpha', 2),
    ('match-3', 'event-1', '2026-09-02', '18:00', 'Beta战队', 'alpha', 'alpha', 4),
    ('bp-interface-test-match', 'event-1', '2026-09-03', '16:00', 'alpha', 'beta', 'alpha', 3)`).run();
  db.prepare(`INSERT INTO bp_sessions VALUES
    ('original', 'match-1', 1, 'A', 1, NULL, 10),
    ('replay', 'match-1', 1, 'A', 2, 'original', 20),
    ('game-2', 'match-1', 2, 'A', 1, NULL, 30)`).run();
  db.prepare(`INSERT INTO bp_session_results VALUES
    ('original', 'escape', 'alpha', 10),
    ('replay', 'hunter', 'beta', 20),
    ('game-2', 'hunter', 'beta', 30)`).run();
  db.prepare("INSERT INTO match_rooms VALUES ('match-1', 'A', 'alpha', 'beta')").run();
  db.prepare(`INSERT INTO characters VALUES
    ('char-msz', 'escape', '命石者', NULL),
    ('char-cql', 'escape', '茶气郎', NULL),
    ('char-hb', 'hunter', '猎手', NULL)`).run();
  db.prepare(`INSERT INTO bp_session_slots VALUES
    ('replay', 'escape-pick-1', 'char-msz', NULL, NULL),
    ('replay', 'escape-pick-2', 'char-cql', NULL, NULL),
    ('replay', 'hunter-pick-1', 'char-hb', NULL, NULL),
    ('game-2', 'escape-pick-1', 'char-msz', NULL, NULL)`).run();

  const detail = teamDetail(db, 'beta');
  assert.equal(detail.team.name, 'Beta战队');
  assert.deepEqual(detail.team.aliases, []);
  assert.equal(detail.roster.length, 0);
  assert.equal(detail.events.length, 1);
  assert.equal(detail.events[0].name, '测试杯');
  // match-3 的 matchup_home 是显示名而非 id,同样要计入
  assert.equal(detail.records.length, 3);
  assert.equal(detail.records[0].id, 'match-1');
  assert.equal(detail.records[0].won, true);
  assert.equal(detail.records[0].decided, true);
  assert.deepEqual(detail.records[0].score, { home: 0, away: 2 });
  assert.equal(detail.records[1].id, 'match-3');
  assert.equal(detail.records[1].home.id, 'beta');
  assert.equal(detail.records[1].won, false);
  assert.equal(detail.records[2].id, 'match-2');
  assert.equal(detail.records[2].won, false);
  // 测试隔离场不计入总场次与胜率
  assert.deepEqual(detail.totals, { played: 3, wins: 1, winRate: 1 / 3 });
  // 角色使用:beta 在 A 房是追捕方,只统计本阵营 pick 槽;按局去重
  assert.equal(detail.characters.totalGames, 2);
  assert.equal(detail.characters.common.length, 1);
  assert.deepEqual(detail.characters.common[0], {
    id: 'char-hb', nickname: '猎手', uses: 1, winRate: 1, usageRate: 0.5
  });
  // 最近有效局是该场第 2 局,取该队阵营的阵容并去重
  assert.equal(detail.characters.latest.matchId, 'match-1');
  assert.equal(detail.characters.latest.side, 'hunter');
  assert.deepEqual(detail.characters.latest.lineup, []);

  const alpha = teamDetail(db, 'alpha');
  assert.equal(alpha.team.aliases.join('|'), 'A队|Alpha');
  assert.equal(alpha.roster.filter(player => player.role === 'escape' && !player.substitute).length, 2);
  assert.equal(alpha.roster.filter(player => player.substitute).length, 1);
  assert.equal(alpha.roster.find(player => player.id === 'p2').registeredNickname, '注册A2');
  assert.deepEqual(alpha.totals, { played: 3, wins: 2, winRate: 2 / 3 });
  // alpha 是逃生方:命石者两局都在场(1 胜 0 负?game-2 未结算),茶气郎一局
  assert.equal(alpha.characters.totalGames, 2);
  const msz = alpha.characters.common.find(character => character.id === 'char-msz');
  assert.equal(msz.uses, 2);
  assert.equal(msz.usageRate, 1);
  assert.equal(msz.winRate, 0);
  assert.equal(alpha.characters.latest.side, 'escape');
  assert.deepEqual(alpha.characters.latest.lineup.map(character => character.nickname), ['命石者']);

  assert.throws(() => teamDetail(db, 'ghost'), /战队不存在/);
  assert.throws(() => teamDetail(db, '   '), /缺少战队 ID/);
});

test('team card detail dialog contract: small cards open a lazy-loaded detail dialog', () => {
  const root = path.resolve(__dirname, '..');
  const script = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'operations-center.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'assets', 'css', 'operations-center.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');
  const dialogTheme = fs.readFileSync(path.join(root, 'public', 'assets', 'css', 'dialog-theme.css'), 'utf8');
  const text = JSON.parse(fs.readFileSync(path.join(root, 'public', 'assets', 'data', 'ui-text.json'), 'utf8'));

  // 小卡保持原版网格,整卡可点打开详情弹窗
  assert.match(css, /\.operations-team-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill, minmax\(260px, 1fr\)\)/);
  assert.match(script, /card\.setAttribute\('aria-haspopup', 'dialog'\)/);
  assert.match(script, /card\.addEventListener\('click', \(\) => openTeamDetail\(item\)\)/);
  // 弹窗结构与懒加载明细
  assert.match(html, /id="teamDetailDialog"[^>]*aria-labelledby="teamDetailTitle"/);
  assert.match(html, /id="teamDetailBody"/);
  // 头部与统计条冻结、下方滚动:统计条独立于滚动区,shell 四行网格(含冻结 footer)
  assert.match(html, /id="teamDetailStats"/);
  assert.match(html, /id="teamDetailFooter"/);
  assert.match(css, /\.operations-team-shell\s*\{[\s\S]*?grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.operations-team-stats\.is-loading/);
  // 左右两列独立滚动,底部操作行冻结
  assert.match(css, /\.operations-team-body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1\.15fr\) minmax\(0, 1fr\)/);
  assert.match(css, /\.operations-team-roster-col,\s*\n\.operations-team-side\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.operations-team-footer\s*\{[\s\S]*?justify-content:\s*flex-end/);
  // 点击复制姓名与 ID:剪贴板写入 + 弹窗内统一 toast 反馈,无可见复制按钮
  assert.match(script, /navigator\.clipboard\?\.writeText/);
  assert.match(script, /operations-copy-toast/);
  assert.doesNotMatch(script, /data-clipboard|复制按钮/);
  // 战队队徽以半透明模糊水印垫底
  assert.match(script, /--operations-team-watermark/);
  assert.match(css, /\.operations-team-shell::before[\s\S]*?var\(--operations-team-watermark/);
  // 关闭即时生效:弹窗不参与退场延迟动画,入场动画由 shell 承担
  assert.doesNotMatch(dialogTheme, /dialog\.operations-team-dialog\[open\]/);
  assert.match(css, /dialog\.operations-team-dialog\[open\] \.operations-team-shell\s*\{[\s\S]*?dialog-theme-enter/);
  assert.match(script, /\/api\/operations\/teams\/\$\{encodeURIComponent\(teamId\)\}\/detail/);
  assert.match(script, /operations-team-loading/);
  // 明细结果按 Promise 缓存,重复打开不重复请求;返回时校验当前打开项避免竞态
  assert.match(script, /teamDetailCache\.has\(teamId\)/);
  assert.match(script, /openTeamItemId !== item\.id/);
  // 统一弹窗主题接入:与既有弹窗同列,获得亚克力材质与出入场动画
  assert.match(css, /\.operations-team-dialog\s*\{[\s\S]*?width:\s*min\(980px/);
  assert.match(dialogTheme, /dialog\.system-dialog[^\n]*\n\s*dialog\.operations-team-dialog/);
  assert.doesNotMatch(script, /operations-team-toggle|is-expanded/);
  assert.doesNotMatch(css, /operations-team-detail-grid|operations-team-detail-loading/);
  for (const key of ['ops.openTeamDetailAria', 'ops.closeTeamDetail', 'ops.teamAliases', 'ops.teamDivision',
    'ops.statEvents', 'ops.statPlayed', 'ops.statWinRate', 'ops.rosterTitle', 'ops.substituteChip',
    'ops.copyNameHint', 'ops.copyIdHint', 'ops.copiedName', 'ops.copiedId', 'ops.teamLineupTitle',
    'ops.teamCharactersTitle', 'ops.lineupEscapeSide', 'ops.lineupHunterSide', 'ops.colGames',
    'ops.colUsage', 'ops.noLineup', 'ops.noCharacterRecords', 'ops.teamEventsTitle',
    'ops.teamRecordsTitle', 'ops.teamNoRoster', 'ops.teamNoEvents', 'ops.teamNoRecords',
    'ops.teamDetailLoading', 'ops.teamDetailFailed', 'ops.resultWin', 'ops.resultLoss']) {
    assert.equal(typeof text[key], 'string', `${key} missing`);
  }
});

test('schedule and match records use only the highest replay attempt', t => {
  const db = fixture(t);
  const schedule = listSchedule(db);
  assert.equal(schedule.context.managedEventId, 'managed-1');
  assert.equal(schedule.items[0].eventName, '当前测试赛');
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
    teams: 'teams', players: 'players',
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
  // 赛程管理已由独立的 schedule-manager 接管，不再是 operations 视图
  assert.match(html, /data-page="schedule"/);
  assert.match(html, /id="schedulePage"/);
  assert.doesNotMatch(html, /data-operations-root="schedule"/);
  assert.doesNotMatch(script, /schedule:\s*'schedule'/);
  assert.match(html, /assets\/css\/schedule-manager\.css\?v=\d+/);
  assert.match(html, /assets\/js\/schedule-manager\.js\?v=\d+/);
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

  assert.match(hud, /data-hub-card="bp"/);
  assert.match(hud, /data-hub-card="countdown"/);
  assert.match(hud, /id="hudHubDialog"/);
  assert.match(hud, /data-hub-switch="bp"/);
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
  assert.doesNotMatch(css, /orientation: portrait/); // 竖屏媒体查询已移除
  assert.match(control, /phase\.role === group\.role/);
  assert.doesNotMatch(control, /logList\.children\.length > 10/);
  assert.match(control, /elements\.targetAt\.value = ''/);
  assert.match(control, /formatCountdownLogTimestamp/);
  assert.doesNotMatch(control, /new Date\(entry\.timestamp\)\.toLocaleTimeString/);
  assert.match(countdown, /String\(hours\)\.padStart\(2, '0'\)/);
  assert.match(countdown, /hours > 0/);
  assert.doesNotMatch(countdown, /99 \* 60 \+ 59/);
});
