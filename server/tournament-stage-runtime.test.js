const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const runtime = require('./tournament-stage-runtime');

function fixture(t) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, display_name TEXT, status TEXT, role TEXT);
    CREATE TABLE teams (id TEXT PRIMARY KEY, display_name TEXT, division TEXT);
    CREATE TABLE team_logos (team_id TEXT, kind TEXT, web_file TEXT);
    CREATE TABLE matches (id TEXT PRIMARY KEY);
    CREATE TABLE tournament_events (id TEXT PRIMARY KEY, name TEXT, division TEXT, stage TEXT,
      format TEXT, priority INTEGER, status TEXT, started_at INTEGER, created_at INTEGER);
    CREATE TABLE tournament_event_media (tournament_event_id TEXT, kind TEXT, sha256 TEXT);
    CREATE TABLE tournament_event_teams (tournament_event_id TEXT, team_id TEXT);
    CREATE TABLE tournament_stages (
      id TEXT PRIMARY KEY, tournament_event_id TEXT, name TEXT, format TEXT, division TEXT,
      status TEXT NOT NULL DEFAULT 'draft', start_at TEXT, end_at TEXT,
      match_day_mode TEXT, match_date TEXT, weekdays_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE tournament_stage_teams (stage_id TEXT, team_id TEXT, created_at INTEGER);
    CREATE TABLE tournament_stage_rounds (
      id TEXT PRIMARY KEY, stage_id TEXT, round_number INTEGER, status TEXT, created_at INTEGER
    );
    CREATE TABLE tournament_stage_matches (
      id TEXT PRIMARY KEY, stage_id TEXT, round_id TEXT, bracket TEXT, slot INTEGER,
      home_team_id TEXT, away_team_id TEXT, format TEXT, start_time TEXT, executor_user_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending', winner_team_id TEXT, bp_room TEXT NOT NULL DEFAULT 'A', created_at INTEGER, updated_at INTEGER
    );
  `);
  t.after(() => database.close());
  return database;
}

function seed(database, { teamCount = 4 } = {}) {
  database.prepare("INSERT INTO users VALUES ('user-1', 'referee01', '裁判一号', 'active', 'operator')").run();
  database.prepare("INSERT INTO tournament_events VALUES ('evt-1', '测试赛', 'pc', '小组赛', 'BO3', 10, 'live', 1000, 1000)").run();
  database.prepare("INSERT INTO tournament_event_media VALUES ('evt-1', 'logo', 'sha123abc')").run();
  const insertTeam = database.prepare('INSERT INTO teams (id, display_name, division) VALUES (?, ?, ?)');
  for (let index = 0; index < teamCount; index += 1) {
    const id = `team-${index + 1}`;
    insertTeam.run(id, `战队${index + 1}`, 'pc');
    database.prepare('INSERT INTO tournament_event_teams VALUES (?, ?)').run('evt-1', id);
    database.prepare("INSERT INTO team_logos VALUES (?, 'escape', ?)").run(id, `/assets/${id}.png`);
  }
  database.prepare(`INSERT INTO tournament_stages
    (id, tournament_event_id, name, format, division, status, start_at, end_at, match_day_mode, match_date, weekdays_json, created_at, updated_at)
    VALUES ('stage-1', 'evt-1', '淘汰赛', '双败淘汰', 'pc', 'draft', '2026-09-10T18:00', '2026-09-12T22:00', 'date', '2026-09-10', '[]', 1000, 1000)`).run();
  const insertStageTeam = database.prepare('INSERT INTO tournament_stage_teams (stage_id, team_id, created_at) VALUES (?, ?, ?)');
  for (let index = 0; index < teamCount; index += 1) {
    insertStageTeam.run('stage-1', `team-${index + 1}`, 1000 + index);
  }
}

function pendingMatches(database) {
  return database.prepare(`SELECT id, home_team_id FROM tournament_stage_matches
    WHERE status = 'pending' ORDER BY created_at, slot`).all();
}

// 把当前所有 pending 比赛按主队获胜录入
function completePendingWithHomeWins(database) {
  for (const match of pendingMatches(database)) {
    runtime.setStageMatchResult(database, 'evt-1', 'stage-1', match.id, match.home_team_id, 'user-1');
  }
}

test('开始阶段自动生成第一批对阵并进入进行中', t => {
  const database = fixture(t);
  seed(database);
  const stage = runtime.startTournamentStage(database, 'evt-1', 'stage-1', 'user-1');
  assert.equal(stage.status, 'live');
  assert.equal(stage.rounds.length, 1);
  assert.equal(stage.rounds[0].matches.length, 2);
  assert.ok(stage.rounds[0].matches.every(match => match.format === 'BO3' && match.status === 'pending'));
  assert.equal(stage.progress.total, 2);
  assert.equal(stage.progress.completed, 0);
  assert.equal(stage.progress.percent, 0);
  assert.deepEqual(
    stage.rounds[0].matches.map(match => [match.homeName, match.awayName]),
    [['战队1', '战队2'], ['战队3', '战队4']]
  );
});

test('上一轮未完赛时禁止生成下一轮，全部完赛后可生成', t => {
  const database = fixture(t);
  seed(database);
  runtime.startTournamentStage(database, 'evt-1', 'stage-1', 'user-1');
  assert.throws(() => runtime.generateNextRound(database, 'evt-1', 'stage-1'), /未完赛/);
  completePendingWithHomeWins(database);
  const advanced = runtime.generateNextRound(database, 'evt-1', 'stage-1', 'user-1');
  assert.equal(advanced.rounds.length, 2);
  const brackets = advanced.rounds[1].matches.map(match => match.bracket).sort();
  assert.deepEqual(brackets, ['lower', 'upper']);
});

test('比赛修改与结果录入：格式、执行账号、时间、胜者', t => {
  const database = fixture(t);
  seed(database);
  runtime.startTournamentStage(database, 'evt-1', 'stage-1', 'user-1');
  const [first] = pendingMatches(database);
  runtime.updateStageMatch(database, 'evt-1', 'stage-1', first.id, {
    format: 'BO5',
    startTime: '2026-09-10T20:00',
    executorUserId: 'user-1'
  }, 'user-1');
  const updated = runtime.listStageRuntime(database, 'evt-1');
  const updatedMatch = updated.stages[0].rounds[0].matches.find(match => match.id === first.id);
  assert.equal(updatedMatch.format, 'BO5');
  assert.equal(updatedMatch.startTime, '2026-09-10T20:00');
  assert.equal(updatedMatch.executorName, '裁判一号');
  assert.throws(() => runtime.updateStageMatch(database, 'evt-1', 'stage-1', first.id, {
    homeTeamId: first.home_team_id,
    awayTeamId: first.home_team_id
  }), /不能相同/);
  const done = runtime.setStageMatchResult(database, 'evt-1', 'stage-1', first.id, first.home_team_id, 'user-1');
  assert.equal(done.status, 'completed');
  assert.equal(done.winnerName, '战队1');
  assert.throws(() => runtime.updateStageMatch(database, 'evt-1', 'stage-1', first.id, { format: 'BO7' }), /已完赛/);
});

test('打满整届产生冠军并可查询排名', t => {
  const database = fixture(t);
  seed(database);
  runtime.startTournamentStage(database, 'evt-1', 'stage-1', 'user-1');
  let championTeamId = null;
  for (let guard = 0; guard < 16; guard += 1) {
    completePendingWithHomeWins(database);
    const payload = runtime.listStageRuntime(database, 'evt-1');
    if (payload.stages[0].championTeamId) {
      championTeamId = payload.stages[0].championTeamId;
      break;
    }
    runtime.generateNextRound(database, 'evt-1', 'stage-1', 'user-1');
  }
  assert.equal(championTeamId, 'team-1');
  const ranking = runtime.stageRanking(database, 'evt-1');
  assert.equal(ranking.ranking[0].teamId, 'team-1');
  assert.ok(ranking.ranking[0].wins >= 2);
  assert.ok(ranking.ranking.every(row => row.logo));
});

test('暂停、恢复、完成与删除阶段', t => {
  const database = fixture(t);
  seed(database);
  runtime.startTournamentStage(database, 'evt-1', 'stage-1', 'user-1');
  const paused = runtime.pauseTournamentStage(database, 'evt-1', 'stage-1');
  assert.equal(paused.status, 'paused');
  assert.throws(() => runtime.generateNextRound(database, 'evt-1', 'stage-1'), /暂停/);
  const resumed = runtime.resumeTournamentStage(database, 'evt-1', 'stage-1');
  assert.equal(resumed.status, 'live');
  const completed = runtime.completeTournamentStage(database, 'evt-1', 'stage-1');
  assert.equal(completed.status, 'completed');
  runtime.deleteTournamentStage(database, 'evt-1', 'stage-1');
  const remaining = runtime.listStageRuntime(database, 'evt-1');
  assert.equal(remaining.stages.length, 0);
});

test('listStageRuntime 返回赛事概要与报名队伍', t => {
  const database = fixture(t);
  seed(database);
  const payload = runtime.listStageRuntime(database, 'evt-1');
  assert.equal(payload.event.name, '测试赛');
  assert.equal(payload.event.status, 'live');
  assert.equal(payload.event.logoUrl, '/api/events/evt-1/media/logo?v=sha123abc');
  assert.equal(payload.teams.length, 4);
  assert.equal(payload.teams[0].logo, '/assets/team-1.png');
  assert.equal(payload.stages.length, 1);
  assert.equal(payload.stages[0].progress.total, 0);
});
