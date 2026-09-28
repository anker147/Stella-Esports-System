'use strict';

// 阶段运行时：开始/暂停/完成/删除、轮次生成、比赛修改与结果录入、积分排名。
// 阶段与赛事的关联机制不变（resolveScheduleEvent + tournament_stages.tournament_event_id）。

const crypto = require('node:crypto');
const { db: defaultDb } = require('./db');
const bracket = require('./tournament-bracket');
const { resolveScheduleEvent } = require('./event-management-service');

const MATCH_FORMATS = new Set(['BO3', 'BO5', 'BO7']);
const GENERATABLE_FORMATS = new Set(['双败淘汰']);
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function withTransaction(database, callback) {
  database.exec('BEGIN');
  try {
    const result = callback();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function loadStage(database, eventId, stageId) {
  resolveScheduleEvent(database, eventId);
  const stage = database.prepare(`SELECT id, tournament_event_id, name, format, division, status,
      start_at, end_at, match_day_mode, match_date, weekdays_json
    FROM tournament_stages WHERE id = ? AND tournament_event_id = ?`).get(stageId, eventId);
  if (!stage) throw new Error('阶段不存在或不属于当前赛事');
  return stage;
}

function assertEventMutable(database, eventId) {
  const event = resolveScheduleEvent(database, eventId);
  if (event.status === 'completed') throw new Error('赛事已结束，赛程不可再修改');
}

function stageTeamIds(database, stageId) {
  return database.prepare('SELECT team_id FROM tournament_stage_teams WHERE stage_id = ? ORDER BY created_at, team_id')
    .all(stageId).map(row => row.team_id);
}

function teamDetails(database, stageId) {
  return database.prepare(`SELECT t.id, t.display_name AS name, t.division,
      tel.web_file AS logo
    FROM tournament_stage_teams st
    JOIN teams t ON t.id = st.team_id
    LEFT JOIN team_logos tel ON tel.team_id = t.id AND tel.kind = 'escape'
    WHERE st.stage_id = ? ORDER BY st.created_at, st.team_id`).all(stageId).map(team => ({
    id: team.id,
    name: team.name,
    division: team.division || null,
    logo: team.logo || null
  }));
}

function eventTeamDetails(database, eventId) {
  return database.prepare(`SELECT t.id, t.display_name AS name, t.division,
      tel.web_file AS logo
    FROM tournament_event_teams et
    JOIN teams t ON t.id = et.team_id
    LEFT JOIN team_logos tel ON tel.team_id = t.id AND tel.kind = 'escape'
    WHERE et.tournament_event_id = ? ORDER BY t.display_name, t.id`).all(eventId).map(team => ({
    id: team.id,
    name: team.name,
    division: team.division || null,
    logo: team.logo || null
  }));
}

function loadStageMatches(database, stageId) {
  return database.prepare(`SELECT m.id, m.round_id, m.bracket, m.slot, m.format, m.start_time,
      m.status, m.winner_team_id, m.home_team_id, m.away_team_id, m.executor_user_id, m.bp_room,
      EXISTS(SELECT 1 FROM matches lm WHERE lm.id = m.id) AS bp_ready,
      r.round_number,
      COALESCE(u.display_name, u.username) AS executor_name,
      wt.display_name AS home_name, lt.display_name AS away_name,
      wel.web_file AS home_logo, ltl.web_file AS away_logo,
      wt2.display_name AS winner_name
    FROM tournament_stage_matches m
    JOIN tournament_stage_rounds r ON r.id = m.round_id
    LEFT JOIN users u ON u.id = m.executor_user_id
    LEFT JOIN teams wt ON wt.id = m.home_team_id
    LEFT JOIN teams lt ON lt.id = m.away_team_id
    LEFT JOIN team_logos wel ON wel.team_id = m.home_team_id AND wel.kind = 'escape'
    LEFT JOIN team_logos ltl ON ltl.team_id = m.away_team_id AND ltl.kind = 'escape'
    LEFT JOIN teams wt2 ON wt2.id = m.winner_team_id
    WHERE m.stage_id = ?
    ORDER BY r.round_number, m.bracket, m.slot`).all(stageId);
}

function buildHistory(rounds, matches) {
  return rounds.map(round => ({
    batch: round.round_number,
    matches: matches
      .filter(match => match.round_id === round.id)
      .map(match => ({
        bracket: match.bracket,
        slot: match.slot,
        homeTeamId: match.home_team_id,
        awayTeamId: match.away_team_id,
        status: match.status,
        winnerTeamId: match.winner_team_id
      }))
  }));
}

function serializeMatch(match) {
  return {
    id: match.id,
    roundId: match.round_id,
    roundNumber: match.round_number,
    bracket: match.bracket,
    slot: match.slot,
    homeTeamId: match.home_team_id,
    awayTeamId: match.away_team_id,
    homeName: match.home_name || null,
    awayName: match.away_name || null,
    homeLogo: match.home_logo || null,
    awayLogo: match.away_logo || null,
    format: match.format,
    startTime: match.start_time || null,
    bpRoom: match.bp_room || 'A',
    bpReady: Number(match.bp_ready || 0) === 1,
    executorUserId: match.executor_user_id || null,
    executorName: match.executor_name || null,
    status: match.status,
    winnerTeamId: match.winner_team_id || null,
    winnerName: match.winner_name || null
  };
}

function serializeRound(round, matches) {
  return {
    id: round.id,
    roundNumber: round.round_number,
    status: round.status,
    matches: matches.filter(match => match.round_id === round.id).map(serializeMatch)
  };
}

function summarizeStage(stage, teams, rounds, matches, plan) {
  const total = matches.length;
  const completed = matches.filter(match => match.status === 'completed').length;
  const currentBatch = rounds.length ? Math.max(...rounds.map(round => round.round_number)) : 0;
  return {
    id: stage.id,
    eventId: stage.tournament_event_id,
    name: stage.name,
    format: stage.format,
    division: stage.division || null,
    status: stage.status || 'draft',
    startAt: stage.start_at,
    endAt: stage.end_at,
    matchDayMode: stage.match_day_mode,
    matchDate: stage.match_date,
    weekdays: JSON.parse(stage.weekdays_json || '[]'),
    teams,
    progress: { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 },
    currentBatch,
    totalBatches: teams.length >= 4 ? bracket.totalBatchCount(teams.length) : 0,
    canGenerateNext: stage.status === 'live' && Boolean(plan && !plan.done && !plan.blocked),
    championTeamId: plan && plan.done ? plan.championTeamId || null : null,
    planBlockedReason: plan && plan.blocked ? plan.reason : null,
    rounds: rounds.map(round => serializeRound(round, matches))
  };
}

function stageSummary(database, stage) {
  const teams = teamDetails(database, stage.id);
  const rounds = database.prepare(`SELECT id, round_number, status FROM tournament_stage_rounds
    WHERE stage_id = ? ORDER BY round_number`).all(stage.id);
  const matches = loadStageMatches(database, stage.id);
  let plan = null;
  try {
    plan = bracket.nextBatch(teams.map(team => team.id), buildHistory(rounds, matches));
  } catch {
    plan = null;
  }
  return summarizeStage(stage, teams, rounds, matches, plan);
}

function listStageRuntime(database = defaultDb, eventId) {
  const event = resolveScheduleEvent(database, eventId);
  const eventRow = database.prepare(`SELECT e.id, e.name, e.status, e.division, e.format,
      em.sha256 AS logo_sha256
    FROM tournament_events e
    LEFT JOIN tournament_event_media em ON em.tournament_event_id = e.id AND em.kind = 'logo'
    WHERE e.id = ?`).get(eventId);
  const stages = database.prepare(`SELECT id, tournament_event_id, name, format, division, status,
      start_at, end_at, match_day_mode, match_date, weekdays_json
    FROM tournament_stages WHERE tournament_event_id = ? ORDER BY start_at, created_at`).all(eventId)
    .map(stage => stageSummary(database, stage));
  const executors = database.prepare(`SELECT id, COALESCE(display_name, username) AS name
    FROM users WHERE status = 'active' ORDER BY COALESCE(display_name, username), id`).all()
    .map(row => ({ id: row.id, name: row.name }));
  return {
    event: {
      id: event.id,
      name: event.name,
      status: event.status,
      division: eventRow?.division || null,
      format: event.format,
      logoUrl: eventRow?.logo_sha256 ? `/api/events/${encodeURIComponent(eventId)}/media/logo?v=${eventRow.logo_sha256.slice(0, 12)}` : null
    },
    stages,
    teams: eventTeamDetails(database, eventId),
    executors
  };
}

function insertRound(database, stageId, batchNumber) {
  const roundId = `sround-${crypto.randomUUID()}`;
  database.prepare(`INSERT INTO tournament_stage_rounds (id, stage_id, round_number, status, created_at)
    VALUES (?, ?, ?, 'active', ?)`).run(roundId, stageId, batchNumber, Date.now());
  return roundId;
}

function insertMatches(database, stageId, roundId, plan) {
  const insert = database.prepare(`INSERT INTO tournament_stage_matches
    (id, stage_id, round_id, bracket, slot, home_team_id, away_team_id, format, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'BO3', 'pending', ?, ?)`);
  for (const spec of plan.matches) {
    insert.run(`smatch-${crypto.randomUUID()}`, stageId, roundId, spec.bracket, spec.slot,
      spec.homeTeamId, spec.awayTeamId, Date.now(), Date.now());
  }
}

function startTournamentStage(database = defaultDb, eventId, stageId, actorUserId = null) {
  assertEventMutable(database, eventId);
  const stage = loadStage(database, eventId, stageId);
  if (stage.status !== 'draft') throw new Error('阶段已开始过，不能重复开始');
  if (!GENERATABLE_FORMATS.has(stage.format)) throw new Error('当前赛制暂不支持对阵生成');
  const teamIds = stageTeamIds(database, stageId);
  if (teamIds.length < 4) throw new Error('双败淘汰至少需要 4 支参赛队伍');
  const plan = bracket.nextBatch(teamIds, []);
  if (plan.blocked) throw new Error(plan.reason);
  withTransaction(database, () => {
    const roundId = insertRound(database, stageId, plan.batch);
    insertMatches(database, stageId, roundId, plan);
    database.prepare("UPDATE tournament_stages SET status = 'live', updated_at = ? WHERE id = ?")
      .run(Date.now(), stageId);
  });
  return stageSummary(database, loadStage(database, eventId, stageId));
}

function pauseTournamentStage(database = defaultDb, eventId, stageId) {
  assertEventMutable(database, eventId);
  const stage = loadStage(database, eventId, stageId);
  if (stage.status !== 'live') throw new Error('只有进行中的阶段可以暂停');
  database.prepare("UPDATE tournament_stages SET status = 'paused', updated_at = ? WHERE id = ?")
    .run(Date.now(), stageId);
  return stageSummary(database, loadStage(database, eventId, stageId));
}

function resumeTournamentStage(database = defaultDb, eventId, stageId) {
  assertEventMutable(database, eventId);
  const stage = loadStage(database, eventId, stageId);
  if (stage.status !== 'paused') throw new Error('只有已暂停的阶段可以恢复');
  database.prepare("UPDATE tournament_stages SET status = 'live', updated_at = ? WHERE id = ?")
    .run(Date.now(), stageId);
  return stageSummary(database, loadStage(database, eventId, stageId));
}

function completeTournamentStage(database = defaultDb, eventId, stageId) {
  assertEventMutable(database, eventId);
  const stage = loadStage(database, eventId, stageId);
  if (stage.status === 'completed') throw new Error('阶段已经完成');
  if (stage.status === 'draft') throw new Error('阶段尚未开始');
  database.prepare("UPDATE tournament_stages SET status = 'completed', updated_at = ? WHERE id = ?")
    .run(Date.now(), stageId);
  return stageSummary(database, loadStage(database, eventId, stageId));
}

function deleteTournamentStage(database = defaultDb, eventId, stageId) {
  assertEventMutable(database, eventId);
  loadStage(database, eventId, stageId);
  withTransaction(database, () => {
    database.prepare('DELETE FROM tournament_stage_rounds WHERE stage_id = ?').run(stageId);
    database.prepare('DELETE FROM tournament_stage_matches WHERE stage_id = ?').run(stageId);
    database.prepare('DELETE FROM tournament_stage_teams WHERE stage_id = ?').run(stageId);
    database.prepare('DELETE FROM tournament_stages WHERE id = ?').run(stageId);
  });
  return { deleted: stageId };
}

function generateNextRound(database = defaultDb, eventId, stageId, actorUserId = null) {
  assertEventMutable(database, eventId);
  const stage = loadStage(database, eventId, stageId);
  if (stage.status === 'draft') throw new Error('阶段尚未开始');
  if (stage.status === 'paused') throw new Error('阶段已暂停，恢复后才能生成下一轮');
  if (stage.status === 'completed') throw new Error('阶段已完成');
  if (!GENERATABLE_FORMATS.has(stage.format)) throw new Error('当前赛制暂不支持对阵生成');
  const teamIds = stageTeamIds(database, stageId);
  const rounds = database.prepare(`SELECT id, round_number, status FROM tournament_stage_rounds
    WHERE stage_id = ? ORDER BY round_number`).all(stageId);
  const matches = loadStageMatches(database, stageId);
  const plan = bracket.nextBatch(teamIds, buildHistory(rounds, matches));
  if (plan.done) throw new Error('本阶段已决出冠军，没有更多轮次');
  if (plan.blocked) throw new Error(plan.reason);
  withTransaction(database, () => {
    database.prepare("UPDATE tournament_stage_rounds SET status = 'completed' WHERE stage_id = ?")
      .run(stageId);
    const roundId = insertRound(database, stageId, plan.batch);
    insertMatches(database, stageId, roundId, plan);
  });
  return stageSummary(database, loadStage(database, eventId, stageId));
}

function loadStageMatch(database, stageId, matchId) {
  const match = database.prepare(`SELECT id, stage_id, round_id, bracket, slot, home_team_id,
      away_team_id, format, start_time, executor_user_id, status, winner_team_id
    FROM tournament_stage_matches WHERE id = ? AND stage_id = ?`).get(matchId, stageId);
  if (!match) throw new Error('比赛不存在或不属于当前阶段');
  return match;
}

function loadEnrichedMatch(database, matchId) {
  return database.prepare(`SELECT m.id, m.round_id, m.bracket, m.slot, m.format, m.start_time,
      m.status, m.winner_team_id, m.home_team_id, m.away_team_id, m.executor_user_id, m.bp_room,
      EXISTS(SELECT 1 FROM matches lm WHERE lm.id = m.id) AS bp_ready,
      r.round_number,
      COALESCE(u.display_name, u.username) AS executor_name,
      wt.display_name AS home_name, lt.display_name AS away_name,
      wel.web_file AS home_logo, ltl.web_file AS away_logo,
      wt2.display_name AS winner_name
    FROM tournament_stage_matches m
    JOIN tournament_stage_rounds r ON r.id = m.round_id
    LEFT JOIN users u ON u.id = m.executor_user_id
    LEFT JOIN teams wt ON wt.id = m.home_team_id
    LEFT JOIN teams lt ON lt.id = m.away_team_id
    LEFT JOIN team_logos wel ON wel.team_id = m.home_team_id AND wel.kind = 'escape'
    LEFT JOIN team_logos ltl ON ltl.team_id = m.away_team_id AND ltl.kind = 'escape'
    LEFT JOIN teams wt2 ON wt2.id = m.winner_team_id
    WHERE m.id = ?`).get(matchId);
}

function updateStageMatch(database = defaultDb, eventId, stageId, matchId, patch = {}, actorUserId = null) {
  assertEventMutable(database, eventId);
  const stage = loadStage(database, eventId, stageId);
  if (stage.status === 'completed') throw new Error('阶段已完成，比赛不可修改');
  const match = loadStageMatch(database, stageId, matchId);
  if (match.status !== 'pending') throw new Error('比赛已完赛，不可修改');
  const updates = {};
  if (patch.format !== undefined) {
    if (!MATCH_FORMATS.has(patch.format)) throw new Error('赛制无效');
    updates.format = patch.format;
  }
  if (patch.homeTeamId !== undefined || patch.awayTeamId !== undefined) {
    const home = patch.homeTeamId !== undefined ? patch.homeTeamId : match.home_team_id;
    const away = patch.awayTeamId !== undefined ? patch.awayTeamId : match.away_team_id;
    if (!home || !away) throw new Error('双方队伍不能为空');
    if (home === away) throw new Error('双方队伍不能相同');
    const members = new Set(stageTeamIds(database, stageId));
    if (!members.has(home) || !members.has(away)) throw new Error('参赛队伍不在本阶段队伍名单中');
    updates.home_team_id = home;
    updates.away_team_id = away;
  }
  if (patch.startTime !== undefined) {
    const value = String(patch.startTime || '').trim();
    if (value && !DATETIME_PATTERN.test(value)) throw new Error('比赛时间格式无效');
    updates.start_time = value || null;
  }
  if (patch.bpRoom !== undefined) {
    if (!['A', 'B'].includes(patch.bpRoom)) throw new Error('BP 房间无效');
    updates.bp_room = patch.bpRoom;
  }
  if (patch.executorUserId !== undefined) {
    const value = patch.executorUserId ? String(patch.executorUserId).trim() : '';
    if (value) {
      const user = database.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(value);
      if (!user) throw new Error('执行账号不存在或已停用');
      updates.executor_user_id = value;
    } else {
      updates.executor_user_id = null;
    }
  }
  if (!Object.keys(updates).length) throw new Error('没有需要修改的内容');
  const keys = Object.keys(updates);
  database.prepare(`UPDATE tournament_stage_matches SET ${keys.map(key => `${key} = ?`).join(', ')},
    updated_at = ? WHERE id = ?`).run(...keys.map(key => updates[key]), Date.now(), matchId);
  return serializeMatch(loadEnrichedMatch(database, matchId));
}

function setStageMatchResult(database = defaultDb, eventId, stageId, matchId, winnerTeamId, actorUserId = null) {
  assertEventMutable(database, eventId);
  const stage = loadStage(database, eventId, stageId);
  if (stage.status === 'completed') throw new Error('阶段已完成，不能录入结果');
  const match = loadStageMatch(database, stageId, matchId);
  if (match.status !== 'pending') throw new Error('该比赛已录入结果');
  const winner = String(winnerTeamId || '');
  if (winner !== match.home_team_id && winner !== match.away_team_id) {
    throw new Error('胜者必须是本场参赛队伍之一');
  }
  database.prepare(`UPDATE tournament_stage_matches
    SET status = 'completed', winner_team_id = ?, updated_at = ? WHERE id = ?`)
    .run(winner, Date.now(), matchId);
  return serializeMatch(loadEnrichedMatch(database, matchId));
}

function stageRanking(database = defaultDb, eventId) {
  resolveScheduleEvent(database, eventId);
  const rows = database.prepare(`SELECT t.id AS team_id, t.display_name AS name,
      tel.web_file AS logo,
      COUNT(*) AS played,
      SUM(CASE WHEN m.winner_team_id = t.id THEN 1 ELSE 0 END) AS wins
    FROM tournament_stage_matches m
    JOIN tournament_stages s ON s.id = m.stage_id
    JOIN teams t ON t.id IN (m.home_team_id, m.away_team_id)
    LEFT JOIN team_logos tel ON tel.team_id = t.id AND tel.kind = 'escape'
    WHERE s.tournament_event_id = ? AND m.status = 'completed'
    GROUP BY t.id
    ORDER BY wins DESC, played DESC, t.display_name, t.id`).all(eventId).map(row => ({
    teamId: row.team_id,
    name: row.name,
    logo: row.logo || null,
    played: Number(row.played || 0),
    wins: Number(row.wins || 0)
  }));
  return { eventId, ranking: rows };
}

module.exports = {
  MATCH_FORMATS,
  listStageRuntime,
  stageSummary,
  startTournamentStage,
  pauseTournamentStage,
  resumeTournamentStage,
  completeTournamentStage,
  deleteTournamentStage,
  generateNextRound,
  updateStageMatch,
  setStageMatchResult,
  stageRanking
};
