const assert = require('node:assert/strict');
const test = require('node:test');
const bracket = require('./tournament-bracket');

// 驱动整届赛程：每批按 picker 决定胜者（默认主队胜）
function run(teams, picker = match => match.homeTeamId) {
  const history = [];
  for (let guard = 0; guard < 64; guard += 1) {
    const step = bracket.nextBatch(teams, history);
    if (step.done) return { ...step, batches: history.length };
    if (step.blocked) throw new Error(`blocked: ${step.reason}`);
    assert.equal(step.batch, history.length + 1);
    history.push({
      batch: step.batch,
      matches: step.matches.map(match => ({ ...match, status: 'completed', winnerTeamId: picker(match, step.batch) }))
    });
  }
  throw new Error('赛程未在限定步数内结束');
}

test('双败淘汰至少需要 4 支队伍', () => {
  assert.throws(() => bracket.nextBatch(['a', 'b'], []), /至少需要 4 支/);
});

test('4 队双败淘汰完整推进并产生冠军', () => {
  const first = bracket.nextBatch(['A', 'B', 'C', 'D'], []);
  assert.deepEqual(first, {
    done: false,
    batch: 1,
    matches: [
      { bracket: 'upper', slot: 0, homeTeamId: 'A', awayTeamId: 'B' },
      { bracket: 'upper', slot: 1, homeTeamId: 'C', awayTeamId: 'D' }
    ]
  });

  const final = run(['A', 'B', 'C', 'D'], match => (match.bracket === 'final' ? match.awayTeamId : match.homeTeamId));
  assert.equal(final.done, true);
  assert.equal(final.championTeamId, 'B');
  assert.equal(final.batches, 4);
});

test('8 队双败淘汰批次结构与比赛总数符合 2N-2', () => {
  const sizes = [];
  const teams = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
  const final = run(teams, match => match.homeTeamId, sizes);
  assert.equal(final.done, true);
  assert.equal(final.championTeamId, 't1');
  const history = collectHistory(teams);
  assert.deepEqual(history.map(item => item.matches.length), [4, 4, 3, 1, 1, 1]);
  const total = history.reduce((sum, item) => sum + item.matches.length, 0);
  assert.equal(total, 2 * teams.length - 2);
  // 第 2 批 = 胜者组第二轮 + 败者组第一轮
  const batch2 = history[1];
  assert.deepEqual(batch2.matches.map(m => m.bracket).sort(), ['lower', 'lower', 'upper', 'upper']);
  // 第 6 批 = 总决赛
  assert.deepEqual(history[5].matches.map(m => m.bracket), ['final']);
});

function collectHistory(teams) {
  const history = [];
  for (let guard = 0; guard < 64; guard += 1) {
    const step = bracket.nextBatch(teams, history);
    if (step.done) return history;
    if (step.blocked) throw new Error(`blocked: ${step.reason}`);
    history.push({
      batch: step.batch,
      matches: step.matches.map(match => ({ ...match, status: 'completed', winnerTeamId: match.homeTeamId }))
    });
  }
  throw new Error('未收敛');
}

test('5 队轮空：轮空方自动晋级且不生成比赛行', () => {
  const teams = ['A', 'B', 'C', 'D', 'E'];
  const first = bracket.nextBatch(teams, []);
  assert.equal(first.matches.length, 2); // (A,B) (C,D)，E 轮空
  const history = collectHistory(teams);
  assert.deepEqual(history.map(item => item.matches.length), [2, 2, 2, 0, 1, 1]);
  const total = history.reduce((sum, item) => sum + item.matches.length, 0);
  assert.equal(total, 2 * teams.length - 2);
});

test('上一批有未完赛比赛时禁止推进', () => {
  const teams = ['A', 'B', 'C', 'D'];
  const history = [{
    batch: 1,
    matches: [
      { bracket: 'upper', slot: 0, homeTeamId: 'A', awayTeamId: 'B', status: 'pending', winnerTeamId: null },
      { bracket: 'upper', slot: 1, homeTeamId: 'C', awayTeamId: 'D', status: 'completed', winnerTeamId: 'C' }
    ]
  }];
  const step = bracket.nextBatch(teams, history);
  assert.equal(step.blocked, true);
  assert.match(step.reason, /未完赛/);
});

test('总决赛完赛后返回冠军', () => {
  const teams = ['A', 'B', 'C', 'D'];
  const history = collectHistory(teams);
  const finalBatch = history[history.length - 1];
  const step = bracket.nextBatch(teams, history);
  assert.equal(step.done, true);
  assert.equal(step.championTeamId, finalBatch.matches[0].winnerTeamId);
});
