'use strict';

// 只读的比赛胜负判定：从 bp_* 历史表推导一场比赛的获胜队伍。
// 语义与原 bp-service 的 scoreFor/matchWinner 保持一致：
// 1) 生效弃赛优先（弃赛方的对手直接记 2 分）；
// 2) 否则按 A/B 房各 1-3 局取最高 attempt 的赛果计分，某角色累计 ≥2 即该房间胜者；
// 3) 两个房间胜者唯一时返回该队，否则回落到赛程上手工标记的 winnerTeamId。
const { db } = require('./db');

function activeForfeitRow(matchId, room) {
  return db.prepare('SELECT * FROM bp_forfeits WHERE match_id = ? AND room = ? AND active = 1').get(matchId, room) || null;
}

function scoreFor(resolver, matchId, room) {
  const score = { escape: 0, hunter: 0 };
  const match = resolver.getMatch(matchId);
  const forfeit = activeForfeitRow(matchId, room);
  if (forfeit) {
    const winnerRole = match.rooms[room].escapeTeamId === forfeit.winner_team_id ? 'escape' : 'hunter';
    score[winnerRole] = 2;
    return score;
  }
  const rows = db.prepare(`
    SELECT s.game_number, s.attempt, r.winner_role
    FROM bp_sessions s
    INNER JOIN bp_session_results r ON r.session_id = s.id
    WHERE s.match_id = ? AND s.room = ?
    ORDER BY s.game_number ASC, s.attempt DESC`).all(matchId, room);
  const seenGames = new Set();
  for (const row of rows) {
    if (seenGames.has(row.game_number)) continue;
    seenGames.add(row.game_number);
    if (row.winner_role === 'escape' || row.winner_role === 'hunter') score[row.winner_role] += 1;
  }
  return score;
}

function matchWinner(resolver, matchId) {
  const match = resolver.getMatch(matchId);
  const winners = [];
  for (const room of ['A', 'B']) {
    const score = scoreFor(resolver, matchId, room);
    if (score.escape >= 2) winners.push(match.rooms[room].escapeTeamId);
    if (score.hunter >= 2) winners.push(match.rooms[room].hunterTeamId);
  }
  const unique = [...new Set(winners)];
  return unique.length === 1 ? unique[0] : match.winnerTeamId || null;
}

module.exports = { matchWinner, scoreFor };
