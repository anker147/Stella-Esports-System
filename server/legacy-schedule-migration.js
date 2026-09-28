'use strict';

// 遗留赛事数据迁移（幂等 seed，服务启动时执行）：
// 1. 把导入的历史比赛按时间批次迁入「2026逃跑吧少年第十届追风杯」赛事，
//    stage match 的 id 直接沿用遗留 matchId，使赛程管理的「开始BP」可直通 BP 会话。
// 2. 为「赛事功能测试」赛事幂等创建功能验收阶段（含可真实开 BP 的测试场）。

const crypto = require('node:crypto');
const { db: defaultDb } = require('./db');

const TARGET_EVENT_NAME = '2026逃跑吧少年第十届追风杯';
const FEATURE_EVENT_NAME = '赛事功能测试';

const BATCHES = [
  { name: '07月25日 比赛日（PE 端）', eventLike: '2026-zhuifeng-cup-mobile-2026-07-25', date: '2026-07-25', division: 'mobile', bracket: 'upper' },
  { name: '07月26日 比赛日（PC 端）', eventLike: '2026-zhuifeng-cup-pc-2026-07-26', date: '2026-07-26', division: 'pc', bracket: 'upper' },
  { name: '07月27日 败者组比赛日', eventLike: '%2026-07-27-qf-loser', date: '2026-07-27', division: null, bracket: 'lower' },
  { name: '08月01日 半决赛胜者组', eventLike: '%2026-08-01-sf-winner', date: '2026-08-01', division: null, bracket: 'upper' },
  { name: '08月02日 半决赛败者组', eventLike: '%2026-08-02-sf-loser', date: '2026-08-02', division: null, bracket: 'lower' }
];

// 解析比赛双方：优先 match_rooms（A 房逃生=主队），无房间时用 match_participants 解析
function resolveMatchTeams(database, matchId) {
  const rooms = database.prepare('SELECT room, escape_team_id, hunter_team_id FROM match_rooms WHERE match_id = ?').all(matchId);
  const roomA = rooms.find(room => room.room === 'A');
  if (roomA && roomA.escape_team_id && roomA.hunter_team_id) {
    return { home: roomA.escape_team_id, away: roomA.hunter_team_id };
  }
  const parts = database.prepare(`SELECT slot, ref_type, team_id, from_match_id
    FROM match_participants WHERE match_id = ? ORDER BY slot`).all(matchId);
  const resolveSlot = part => {
    if (part.ref_type === 'team' && part.team_id) return part.team_id;
    if (part.ref_type === 'loser_of' && part.from_match_id) {
      const feederRooms = database.prepare(`SELECT room, escape_team_id, hunter_team_id FROM match_rooms WHERE match_id = ?`).all(part.from_match_id);
      const feederA = feederRooms.find(room => room.room === 'A');
      const feederRow = database.prepare('SELECT winner_team_id FROM matches WHERE id = ?').get(part.from_match_id);
      const feederWinner = matchWinnerTiered(database, part.from_match_id, feederRow?.winner_team_id);
      if (feederA && feederWinner) {
        return feederWinner === feederA.escape_team_id ? feederA.hunter_team_id : feederA.escape_team_id;
      }
      return null;
    }
    return null;
  };
  return { home: resolveSlot(parts[0] || {}), away: resolveSlot(parts[1] || {}) };
}

// 胜者分级兜底：matches.winner → BP 会话历史结果 → NULL（按记录完赛）
function matchWinnerTiered(database, matchId, fallbackWinner) {
  if (fallbackWinner) return fallbackWinner;
  const sessionWinner = database.prepare(`SELECT r.winner_team_id FROM bp_session_results r
    JOIN bp_sessions s ON s.id = r.session_id WHERE s.match_id = ? LIMIT 1`).get(matchId);
  return sessionWinner?.winner_team_id || null;
}

function resolveMatchWinner(database, match) {
  return matchWinnerTiered(database, match.id, match.winner_team_id);
}

function ensureBatchStage(database, eventId, batch) {
  const exists = database.prepare('SELECT id FROM tournament_stages WHERE tournament_event_id = ? AND name = ?')
    .get(eventId, batch.name);
  if (exists) return null;

  const matches = database.prepare(`SELECT id, date, start_time, winner_team_id, sort_order
    FROM matches WHERE event_id LIKE ? ORDER BY sort_order, id`).all(batch.eventLike);
  if (!matches.length) return null;

  const resolved = matches.map(match => {
    const teams = resolveMatchTeams(database, match.id);
    return {
      id: match.id,
      home: teams.home,
      away: teams.away,
      winner: resolveMatchWinner(database, match, teams),
      startTime: match.date && match.start_time ? `${match.date}T${match.start_time}` : `${batch.date}T12:00`
    };
  }).filter(item => item.home && item.away);
  if (!resolved.length) return null;

  const stageId = `stage-${crypto.randomUUID()}`;
  const now = Date.now();
  const teamIds = [...new Set(resolved.flatMap(item => [item.home, item.away]))];

  const insertStage = database.prepare(`INSERT INTO tournament_stages
    (id, tournament_event_id, name, format, division, status, start_at, end_at, match_day_mode, match_date,
     weekdays_json, created_at, updated_at)
    VALUES (?, ?, ?, 'BO3', ?, 'completed', ?, ?, 'date', ?, '[]', ?, ?)`);
  const insertTeam = database.prepare('INSERT OR IGNORE INTO tournament_stage_teams (stage_id, team_id, created_at) VALUES (?, ?, ?)');
  const insertRound = database.prepare(`INSERT INTO tournament_stage_rounds (id, stage_id, round_number, status, created_at)
    VALUES (?, ?, 1, 'completed', ?)`);
  const insertMatch = database.prepare(`INSERT INTO tournament_stage_matches
    (id, stage_id, round_id, bracket, slot, home_team_id, away_team_id, format, start_time, bp_room,
     status, winner_team_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'BO3', ?, 'A', 'completed', ?, ?, ?)`);

  database.exec('BEGIN');
  try {
    insertStage.run(stageId, eventId, batch.name, batch.division, `${batch.date}T00:00`, `${batch.date}T23:59`, batch.date, now, now);
    teamIds.forEach(teamId => insertTeam.run(stageId, teamId, now));
    const roundId = `sround-${crypto.randomUUID()}`;
    insertRound.run(roundId, stageId, now);
    resolved.forEach((item, index) => {
      insertMatch.run(item.id, stageId, roundId, batch.bracket, index, item.home, item.away,
        item.startTime, item.winner, now, now);
    });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { stage: batch.name, matches: resolved.length, teams: teamIds.length };
}

// 赛事功能测试：功能验收阶段（1 场可真实开 BP + 2 场预置完赛 + 3 场待打）
function ensureFeatureTestStage(database) {
  const event = database.prepare('SELECT id FROM tournament_events WHERE name = ?').get(FEATURE_EVENT_NAME);
  if (!event) return null;
  const exists = database.prepare('SELECT id FROM tournament_stages WHERE tournament_event_id = ? AND name = ?')
    .get(event.id, '功能验收阶段');
  if (exists) return null;

  const insertEventTeam = database.prepare('INSERT OR IGNORE INTO tournament_event_teams (tournament_event_id, team_id, created_at) VALUES (?, ?, ?)');
  const eventTeamNow = Date.now();
  if (database.prepare('SELECT COUNT(*) AS n FROM tournament_event_teams WHERE tournament_event_id = ?').get(event.id).n < 6) {
    const pool = database.prepare('SELECT id FROM teams ORDER BY display_name, id LIMIT 6').all();
    pool.forEach(team => insertEventTeam.run(event.id, team.id, eventTeamNow));
  }
  const teams = database.prepare(`SELECT t.id FROM tournament_event_teams et
    JOIN teams t ON t.id = et.team_id WHERE et.tournament_event_id = ? ORDER BY t.id LIMIT 6`)
    .all(event.id).map(row => row.id);
  if (teams.length < 4) return null;

  const bpMatch = database.prepare("SELECT id, date, start_time FROM matches WHERE id = 'bp-interface-test-match'").get();
  const now = Date.now();
  const stageId = `stage-${crypto.randomUUID()}`;
  const today = new Date().toISOString().slice(0, 10);
  const timeAt = hour => `${today}T${String(hour).padStart(2, '0')}:00`;

  const specs = [];
  if (bpMatch) {
    specs.push({ id: bpMatch.id, home: teams[0], away: teams[1], format: 'BO3', startTime: timeAt(10), status: 'pending', winner: null });
  }
  specs.push(
    { id: 'test-match-1', home: teams[0], away: teams[1], format: 'BO3', startTime: timeAt(12), status: 'completed', winner: teams[0] },
    { id: 'test-match-2', home: teams[2], away: teams[3], format: 'BO5', startTime: timeAt(13), status: 'completed', winner: teams[2] },
    { id: 'test-match-3', home: teams[4] || teams[0], away: teams[5] || teams[1], format: 'BO3', startTime: timeAt(14), status: 'pending', winner: null },
    { id: 'test-match-4', home: teams[1], away: teams[2], format: 'BO7', startTime: timeAt(15), status: 'pending', winner: null },
    { id: 'test-match-5', home: teams[3], away: teams[4] || teams[0], format: 'BO3', startTime: timeAt(16), status: 'pending', winner: null }
  );

  const stageTeams = [...new Set(specs.flatMap(spec => [spec.home, spec.away]))];

  database.exec('BEGIN');
  try {
    database.prepare(`INSERT INTO tournament_stages
      (id, tournament_event_id, name, format, division, status, start_at, end_at, match_day_mode, match_date,
       weekdays_json, created_at, updated_at)
      VALUES (?, ?, '功能验收阶段', '双败淘汰', NULL, 'live', ?, ?, 'date', ?, '[]', ?, ?)`)
      .run(stageId, event.id, `${today}T00:00`, `${today}T23:59`, today, now, now);
    const insertTeam = database.prepare('INSERT OR IGNORE INTO tournament_stage_teams (stage_id, team_id, created_at) VALUES (?, ?, ?)');
    stageTeams.forEach(teamId => insertTeam.run(stageId, teamId, now));
    const roundId = `sround-${crypto.randomUUID()}`;
    database.prepare(`INSERT INTO tournament_stage_rounds (id, stage_id, round_number, status, created_at)
      VALUES (?, ?, 1, 'active', ?)`).run(roundId, stageId, now);
    const insertMatch = database.prepare(`INSERT INTO tournament_stage_matches
      (id, stage_id, round_id, bracket, slot, home_team_id, away_team_id, format, start_time, bp_room,
       status, winner_team_id, created_at, updated_at)
      VALUES (?, ?, ?, 'upper', ?, ?, ?, ?, ?, 'A', ?, ?, ?, ?)`);
    specs.forEach((spec, index) => {
      insertMatch.run(spec.id, stageId, roundId, index, spec.home, spec.away, spec.format,
        spec.startTime, spec.status, spec.winner, now, now);
    });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { stage: '功能验收阶段', matches: specs.length };
}

function ensureLegacyScheduleMigration(database = defaultDb) {
  const summary = { batches: [], featureStage: null };
  try {
    const event = database.prepare('SELECT id FROM tournament_events WHERE name = ?').get(TARGET_EVENT_NAME);
    if (event) {
      for (const batch of BATCHES) {
        const result = ensureBatchStage(database, event.id, batch);
        if (result) summary.batches.push(result);
      }
    }
    summary.featureStage = ensureFeatureTestStage(database);
  } catch (error) {
    console.warn('[legacy-migration] 迁移跳过：', error.message);
  }
  return summary;
}

module.exports = { ensureLegacyScheduleMigration };
