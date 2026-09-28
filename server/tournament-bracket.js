'use strict';

// 双败淘汰赛对阵推导（纯函数，无数据库依赖）。
// 术语约定：
//   批次（batch）= 一个可以同时进行的比赛集合，对应 tournament_stage_rounds.round_number；
//   upper = 胜者组，lower = 败者组，final = 总决赛；
//   轮空（bye）= 某槽位只有一方有队伍，直接晋级，不生成比赛行。
// 种子顺序即传入 teamIds 的顺序：第 1 批按选择顺序两两配对，后续批次由上一批结果推导。
// 批次结构（size = 补齐后的队伍数，w = 胜者组轮数）：
//   第 b 批（1 <= b <= w）= 胜者组第 b 轮；第 b 批（2 <= b <= 2w-1）= 败者组第 b-1 轮；
//   第 2w 批 = 总决赛。败者组 minor 轮（偶数轮）接收胜者组第 m/2+1 轮的落败者。

function nextPowerOfTwo(count) {
  let size = 1;
  while (size < count) size *= 2;
  return size;
}

function upperRoundCount(size) {
  return Math.round(Math.log2(size));
}

function lowerRoundCount(size) {
  if (size < 4) return 0;
  return 2 * upperRoundCount(size) - 2;
}

function totalBatchCount(teamCount) {
  if (teamCount < 4) return 0;
  return 2 * upperRoundCount(nextPowerOfTwo(teamCount));
}

function paddedSeeds(teamIds) {
  const padded = teamIds.slice();
  while (padded.length < nextPowerOfTwo(teamIds.length)) padded.push(null);
  return padded;
}

// 第 1 批：胜者组第一轮，相邻配对，轮空不生成比赛行
function firstBatchMatches(teamIds) {
  const padded = paddedSeeds(teamIds);
  const matches = [];
  for (let slot = 0; slot < padded.length / 2; slot += 1) {
    const home = padded[slot * 2];
    const away = padded[slot * 2 + 1];
    if (home && away) matches.push({ bracket: 'upper', slot, homeTeamId: home, awayTeamId: away });
  }
  return matches;
}

// 一批比赛的结果索引：key = `${bracket}:${slot}` -> { homeTeamId, awayTeamId, winnerTeamId|null }
function resultIndex(batchMatches) {
  const index = new Map();
  for (const match of batchMatches) {
    index.set(`${match.bracket}:${match.slot}`, {
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      winnerTeamId: match.status === 'completed' ? match.winnerTeamId : null
    });
  }
  return index;
}

function loserOf(entry) {
  if (!entry || !entry.winnerTeamId) return null;
  return entry.winnerTeamId === entry.homeTeamId ? entry.awayTeamId : entry.homeTeamId;
}

// 相邻配对：数量为奇数时最后一个轮空晋级（不生成比赛行）
function pairAdjacent(participants) {
  const matches = [];
  for (let slot = 0; slot * 2 + 1 < participants.length; slot += 1) {
    matches.push({ bracket: 'lower', slot, homeTeamId: participants[slot * 2], awayTeamId: participants[slot * 2 + 1] });
  }
  return matches;
}

// 败者组 minor 轮：左侧（上一轮胜者）与右侧（胜者组落败者）按位置配对，数量不齐时多余方轮空
function pairMinorRound(left, right) {
  const matches = [];
  const pairCount = Math.min(left.length, right.length);
  for (let slot = 0; slot < pairCount; slot += 1) {
    if (left[slot] && right[slot]) {
      matches.push({ bracket: 'lower', slot, homeTeamId: left[slot], awayTeamId: right[slot] });
    }
  }
  return matches;
}

// 一轮的晋级名单：有比赛的槽位取结果，轮空槽位自动晋级
function winnersFromResults(participants, matches, results, bracket) {
  const winners = [];
  const pairCount = matches.length;
  for (let slot = 0; slot < pairCount; slot += 1) {
    const entry = results.get(`${bracket}:${slot}`);
    winners.push(entry && entry.winnerTeamId ? entry.winnerTeamId : null);
  }
  if (participants.length % 2 === 1 && pairCount * 2 === participants.length - 1) {
    winners.push(participants[participants.length - 1]);
  }
  return winners;
}

// 胜者组第 round 轮的槽位参与者与结果（需要该轮比赛已生成且完赛）
function resolveUpperRound(padded, previousWinners, round, results) {
  const slotCount = padded.length / (2 ** round);
  const winners = [];
  const losers = [];
  for (let slot = 0; slot < slotCount; slot += 1) {
    let home;
    let away;
    if (round === 1) {
      home = padded[slot * 2];
      away = padded[slot * 2 + 1];
    } else {
      home = previousWinners[slot * 2] || null;
      away = previousWinners[slot * 2 + 1] || null;
    }
    if (!home && !away) {
      winners.push(null);
      losers.push(null);
      continue;
    }
    if (!home || !away) {
      winners.push(home || away);
      losers.push(null);
      continue;
    }
    const entry = results.get(`upper:${slot}`);
    if (!entry) return null;
    winners.push(entry.winnerTeamId || null);
    losers.push(loserOf(entry));
  }
  return { winners, losers };
}

// 败者组第 m 轮的参与者名单
function lowerRoundParticipants(m, lowerWinners, upperLosers) {
  if (m === 1) return (upperLosers[1] || []).filter(Boolean);
  if (m % 2 === 0) {
    return null; // minor 轮由两侧列表合成，不走这里
  }
  return (lowerWinners[m - 1] || []).filter(Boolean);
}

// 推导下一批对阵。
// teams：种子顺序的队伍 id 数组（阶段报名队伍，至少 4 支）。
// history：已生成批次，元素 { batch, matches: [{ bracket, slot, homeTeamId, awayTeamId, status, winnerTeamId }] }。
// 返回：
//   { done: true, championTeamId }                 总决赛已完赛
//   { done: false, blocked: true, reason }         尚不可推进（上一批有未完赛比赛等）
//   { done: false, batch, matches }                下一批对阵（可能为空数组 = 该批全部轮空）
function nextBatch(teams, history) {
  const size = nextPowerOfTwo(teams.length);
  if (size < 4) throw new Error('双败淘汰至少需要 4 支队伍');
  const upperRounds = upperRoundCount(size);
  const lowerRounds = lowerRoundCount(size);
  const totalBatches = 2 * upperRounds;
  const padded = paddedSeeds(teams);
  const byBatch = new Map(history.map(item => [item.batch, item]));
  const generated = history.length;
  const nextBatchNumber = generated + 1;
  if (nextBatchNumber > totalBatches) {
    const finalEntry = byBatch.get(totalBatches);
    const finalResults = resultIndex(finalEntry ? finalEntry.matches : []);
    const finalResult = finalResults.get('final:0');
    return { done: true, championTeamId: finalResult?.winnerTeamId || null };
  }

  const upperWinners = [null];
  const upperLosers = [null];
  const lowerWinners = [null];
  let lastError = null;

  for (let batch = 1; batch <= generated; batch += 1) {
    const entry = byBatch.get(batch);
    const results = resultIndex(entry ? entry.matches : []);
    const pending = [...results.values()].some(item => !item.winnerTeamId);
    if (pending) {
      return { done: false, blocked: true, reason: `第 ${batch} 批还有未完赛的比赛` };
    }

    if (batch <= upperRounds) {
      const resolved = resolveUpperRound(padded, upperWinners[batch - 1], batch, results);
      if (!resolved) {
        return { done: false, blocked: true, reason: `第 ${batch} 批胜者组缺少比赛数据` };
      }
      upperWinners[batch] = resolved.winners;
      upperLosers[batch] = resolved.losers;
    }

    const lowerRound = batch - 1;
    if (lowerRound >= 1 && lowerRound <= lowerRounds) {
      if (lowerRound === 1) {
        const participants = (upperLosers[1] || []).filter(Boolean);
        const pairs = pairAdjacent(participants);
        lowerWinners[1] = winnersFromResults(participants, pairs, results, 'lower');
      } else if (lowerRound % 2 === 0) {
        const sideA = (lowerWinners[lowerRound - 1] || []).filter(Boolean);
        const sideB = (upperLosers[lowerRound / 2 + 1] || []).filter(Boolean);
        const pairs = pairMinorRound(sideA, sideB);
        const winners = [];
        for (let slot = 0; slot < pairs.length; slot += 1) {
          const item = results.get(`lower:${slot}`);
          winners.push(item && item.winnerTeamId ? item.winnerTeamId : null);
        }
        for (let i = pairs.length; i < sideA.length; i += 1) winners.push(sideA[i]);
        for (let i = pairs.length; i < sideB.length; i += 1) winners.push(sideB[i]);
        lowerWinners[lowerRound] = winners;
      } else {
        const participants = (lowerWinners[lowerRound - 1] || []).filter(Boolean);
        const pairs = pairAdjacent(participants);
        lowerWinners[lowerRound] = winnersFromResults(participants, pairs, results, 'lower');
      }
    }

    if (batch === totalBatches) {
      const finalResult = results.get('final:0');
      if (finalResult && finalResult.winnerTeamId) {
        return { done: true, championTeamId: finalResult.winnerTeamId };
      }
    }
  }

  if (generated >= totalBatches) {
    return { done: false, blocked: true, reason: '总决赛尚未完赛' };
  }

  if (nextBatchNumber === totalBatches) {
    const upperChampion = (upperWinners[upperRounds] || [])[0] || null;
    const lowerChampion = (lowerWinners[lowerRounds] || [])[0] || null;
    if (!upperChampion || !lowerChampion) {
      return { done: false, blocked: true, reason: '胜者组或败者组尚未决出冠军' };
    }
    return {
      done: false,
      batch: nextBatchNumber,
      matches: [{ bracket: 'final', slot: 0, homeTeamId: upperChampion, awayTeamId: lowerChampion }]
    };
  }

  const matches = [];
  if (nextBatchNumber <= upperRounds) {
    if (nextBatchNumber === 1) {
      matches.push(...firstBatchMatches(teams));
    } else {
      const previous = upperWinners[nextBatchNumber - 1] || [];
      for (let slot = 0; slot < size / (2 ** nextBatchNumber); slot += 1) {
        const home = previous[slot * 2] || null;
        const away = previous[slot * 2 + 1] || null;
        if (home && away) matches.push({ bracket: 'upper', slot, homeTeamId: home, awayTeamId: away });
      }
    }
  }
  const lowerRound = nextBatchNumber - 1;
  if (lowerRound >= 1 && lowerRound <= lowerRounds) {
    if (lowerRound === 1) {
      matches.push(...pairAdjacent((upperLosers[1] || []).filter(Boolean)));
    } else if (lowerRound % 2 === 0) {
      const sideA = (lowerWinners[lowerRound - 1] || []).filter(Boolean);
      const sideB = (upperLosers[lowerRound / 2 + 1] || []).filter(Boolean);
      matches.push(...pairMinorRound(sideA, sideB));
    } else {
      matches.push(...pairAdjacent((lowerWinners[lowerRound - 1] || []).filter(Boolean)));
    }
  }
  return { done: false, batch: nextBatchNumber, matches };
}

module.exports = {
  nextPowerOfTwo,
  upperRoundCount,
  lowerRoundCount,
  totalBatchCount,
  paddedSeeds,
  firstBatchMatches,
  nextBatch
};
