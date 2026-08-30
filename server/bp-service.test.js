const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-db-bp-service-'));
process.env.STELLA_DB_PATH = path.join(dbDir, 'test.db');
const { BpService } = require('./bp-service');
const { db } = require('./db');
const { createTournamentResolver } = require('./tournament-data');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clearBpTables() {
  db.exec('DELETE FROM bp_session_history; DELETE FROM bp_session_results; DELETE FROM bp_session_slots; DELETE FROM bp_sessions; DELETE FROM bp_forfeit_events; DELETE FROM bp_forfeits;');
}

function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-bp-test-'));
  clearBpTables();
  const service = new BpService({
    resolver: createTournamentResolver(),
    zeroPulseMs: 5,
    tickMs: 20,
    ...options
  });
  return { directory, service };
}

test('each BP phase starts with its configured duration', async t => {
  const { directory, service } = fixture({
    phaseDurations: { 'hunter-ban-1': 25, 'escape-ban-1': 18 }
  });
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const session = service.ensureSession('mobile-2026-07-25-qf-1', 1, 'A');
  const started = service.startSession(session.id);
  assert.equal(started.timer.durationSeconds, 25);
  assert.equal(started.timer.remainingSeconds, 25);
  service.updateSlot(session.id, { slotId: 'hunter-ban-1', field: 'character', characterId: '失忆者' });
  await delay(12);
  const next = service.serialize(service.getSession(session.id));
  assert.equal(next.currentPhaseIndex, 1);
  assert.equal(next.timer.durationSeconds, 18);
  assert.equal(next.timer.remainingSeconds, 18);
});

test('commentator image selection is global across BP sessions', t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const session = service.ensureSession('mobile-2026-07-25-qf-1', 1, 'A');
  const otherRoom = service.ensureSession('mobile-2026-07-25-qf-1', 1, 'B');
  const selected = service.setCommentatorImage(session.id, { id: '十三香组合.png', name: '十三香组合' });
  assert.deepEqual(selected.commentatorImage, { id: '十三香组合.png', name: '十三香组合' });
  assert.deepEqual(service.serialize(otherRoom).commentatorImage, { id: '十三香组合.png', name: '十三香组合' });
  assert.equal(selected.history.at(-1).action, 'commentator-image-updated');
});

test('new BP sessions inherit the configured global commentator image', t => {
  const image = { id: '星澜组合.png', name: '星澜组合' };
  const { directory, service } = fixture({ commentatorImage: image });
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const session = service.ensureSession('mobile-2026-07-25-qf-1', 1, 'A');
  assert.deepEqual(session.commentatorImage, image);
});

test('BP domain starts empty after being cleared, isolating past records', t => {
  const service = new BpService({ resolver: createTournamentResolver() });
  t.after(() => service.close());
  clearBpTables();
  const fresh = new BpService({ resolver: createTournamentResolver() });
  t.after(() => fresh.close());

  assert.deepEqual(fresh.listSessions(), []);
  assert.deepEqual(Object.values(fresh.forfeits), []);
  assert.equal(fs.readdirSync(dbDir).some(name => name.startsWith('test.db')), true);
});

test('escape picks push independently and phase advances only after all four', async t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const pushes = [];
  service.on('push-slot', event => pushes.push(event.slotId));
  const session = service.ensureSession('mobile-2026-07-25-qf-1', 1, 'A');
  service.startSession(session.id);

  service.updateSlot(session.id, { slotId: 'hunter-ban-1', field: 'character', characterId: '失忆者' });
  await delay(12);
  service.updateSlot(session.id, { slotId: 'escape-ban-1', field: 'character', characterId: '雇佣兵' });
  await delay(12);
  service.updateSlot(session.id, { slotId: 'hunter-ban-2', field: 'character', characterId: '小学妹' });
  await delay(12);

  const hunterPlayer = service.resolver.getCandidates(session.matchId, 'A', 'hunter').candidates[0].playerId;
  service.updateSlot(session.id, { slotId: 'hunter-pick-1', field: 'character', characterId: '机器人' });
  assert(!pushes.includes('hunter-pick-1'));
  service.updateSlot(session.id, { slotId: 'hunter-pick-1', field: 'player', playerId: hunterPlayer });
  assert(pushes.includes('hunter-pick-1'));
  await delay(12);

  const escapeCandidates = service.resolver.getCandidates(session.matchId, 'A', 'escape').candidates;
  for (let index = 1; index <= 3; index += 1) {
    const slotId = `escape-pick-${index}`;
    service.updateSlot(session.id, { slotId, field: 'character', characterId: ['魔术师', '战斗少女', '小狐狸'][index - 1] });
    service.updateSlot(session.id, { slotId, field: 'player', playerId: escapeCandidates[index - 1].playerId });
    assert.equal(service.getSession(session.id).currentPhaseIndex, 4);
    assert(pushes.includes(slotId));
  }

  service.updateSlot(session.id, { slotId: 'escape-pick-4', field: 'character', characterId: '水之忍者' });
  service.updateSlot(session.id, { slotId: 'escape-pick-4', field: 'player', playerId: escapeCandidates[3].playerId });
  assert.equal(service.getSession(session.id).timer.transitionPending, true);
  await delay(12);
  assert.equal(service.getSession(session.id).currentPhaseIndex, 5);
  assert.equal(service.getSession(session.id).timer.remainingSeconds, 30);
  assert.deepEqual(pushes.filter(id => id.startsWith('escape-pick-')), [
    'escape-pick-1', 'escape-pick-2', 'escape-pick-3', 'escape-pick-4'
  ]);
});

test('replay keeps the original BP snapshot and links to its source session', t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const original = service.ensureSession('mobile-2026-07-25-qf-2', 1, 'B');
  service.startSession(original.id);
  service.updateSlot(original.id, { slotId: 'hunter-ban-1', field: 'character', characterId: '夜翎' });
  const replay = service.createReplay(original.id);

  assert.equal(replay.attempt, 2);
  assert.equal(replay.replayOf, original.id);
  assert.equal(replay.slots['hunter-ban-1'].characterId, '夜翎');
  assert.equal(replay.status, 'replay');
});

test('restoring history creates a new revision instead of deleting audit history', t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const session = service.ensureSession('mobile-2026-07-25-qf-3', 1, 'A');
  service.startSession(session.id);
  service.updateSlot(session.id, { slotId: 'hunter-ban-1', field: 'character', characterId: '失忆者' });
  const before = service.getSession(session.id);
  const targetRevision = before.history.find(entry => entry.action === 'bp-started').revision;
  const historyLength = before.history.length;
  const restored = service.restoreRevision(session.id, targetRevision);

  assert.equal(restored.slots['hunter-ban-1'].characterId, null);
  assert.equal(restored.history.length, historyLength + 1);
  assert.equal(restored.history.at(-1).action, 'revision-restored');
});

test('banned characters cannot be picked while duplicate players are rejected', async t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const session = service.ensureSession('mobile-2026-07-25-qf-1', 1, 'A');
  service.startSession(session.id);
  service.updateSlot(session.id, { slotId: 'hunter-ban-1', field: 'character', characterId: '失忆者' });
  await delay(12);
  service.updateSlot(session.id, { slotId: 'escape-ban-1', field: 'character', characterId: '雇佣兵' });
  await delay(12);
  assert.throws(
    () => service.updateSlot(session.id, { slotId: 'hunter-ban-2', field: 'character', characterId: '失忆者' }),
    /不能重复Ban/
  );
  service.updateSlot(session.id, { slotId: 'hunter-ban-2', field: 'character', characterId: '小学妹' });
  assert.equal(service.getSession(session.id).slots['hunter-ban-2'].characterId, '小学妹');
  await delay(12);
  const hunterPlayer = service.resolver.getCandidates(session.matchId, 'A', 'hunter').candidates[0].playerId;
  assert.throws(
    () => service.updateSlot(session.id, { slotId: 'hunter-pick-1', field: 'character', characterId: '雇佣兵' }),
    /已被Ban/
  );
  service.updateSlot(session.id, { slotId: 'hunter-pick-1', field: 'character', characterId: '机器人' });
  service.updateSlot(session.id, { slotId: 'hunter-pick-1', field: 'player', playerId: hunterPlayer });
  await delay(12);
  assert.throws(
    () => service.updateSlot(session.id, { slotId: 'escape-pick-1', field: 'character', characterId: '失忆者' }),
    /已被Ban/
  );
  service.updateSlot(session.id, { slotId: 'escape-pick-1', field: 'character', characterId: '魔术师' });
  const escapePlayer = service.resolver.getCandidates(session.matchId, 'A', 'escape').candidates[0].playerId;
  service.updateSlot(session.id, { slotId: 'escape-pick-1', field: 'player', playerId: escapePlayer });
  service.updateSlot(session.id, { slotId: 'escape-pick-2', field: 'character', characterId: '战斗少女' });
  assert.throws(
    () => service.updateSlot(session.id, { slotId: 'escape-pick-2', field: 'player', playerId: escapePlayer }),
    /同一选手不能占用多个BP槽位/
  );
});

test('manual player text completes a pick and output mode persists', async t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const pushes = [];
  service.on('push-slot', event => pushes.push(event.slotId));
  const session = service.ensureSession('mobile-2026-07-25-qf-1', 1, 'A');
  service.startSession(session.id);
  service.updateSlot(session.id, { slotId: 'hunter-ban-1', field: 'character', characterId: '失忆者' });
  await delay(12);
  service.updateSlot(session.id, { slotId: 'escape-ban-1', field: 'character', characterId: '雇佣兵' });
  await delay(12);
  service.updateSlot(session.id, { slotId: 'hunter-ban-2', field: 'character', characterId: '小学妹' });
  await delay(12);
  service.updateSlot(session.id, { slotId: 'hunter-pick-1', field: 'character', characterId: '机器人' });
  service.updateSlot(session.id, { slotId: 'hunter-pick-1', field: 'playerText', playerText: '临时选手' });

  const current = service.setOutputMode(session.id, 'character');
  assert.equal(current.slots['hunter-pick-1'].playerText, '临时选手');
  assert.equal(current.outputMode, 'character');
  assert(pushes.includes('hunter-pick-1'));
});

test('completed official BP result updates the room score', t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const first = service.ensureSession('mobile-2026-07-25-qf-2', 1, 'B');
  first.status = 'completed';
  const decided = service.setResult(first.id, 'hunter');
  assert.equal(decided.result.winnerTeamId, decided.roomAssignment.hunterTeamId);
  assert.deepEqual(decided.score, { escape: 0, hunter: 1 });
});

test('replay rolls score back and its result replaces the official result', t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const official = service.ensureSession('mobile-2026-07-25-qf-3', 1, 'A');
  official.status = 'completed';
  const originalResult = service.setResult(official.id, 'escape');
  assert.deepEqual(originalResult.score, { escape: 1, hunter: 0 });

  const replay = service.createReplay(official.id);
  assert.equal(replay.result, null);
  assert.deepEqual(replay.score, { escape: 0, hunter: 0 });

  const replayResult = service.setResult(replay.id, 'hunter');
  assert.deepEqual(replayResult.score, { escape: 0, hunter: 1 });
});

test('editing an explicitly selected official record uses that record for the displayed score', t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const official = service.ensureSession('mobile-2026-07-25-qf-2', 1, 'A');
  official.status = 'completed';
  service.setResult(official.id, 'escape');
  service.createReplay(official.id);

  const updatedOfficial = service.setResult(official.id, 'hunter');
  assert.deepEqual(updatedOfficial.score, { escape: 0, hunter: 1 });
});

test('official BP reset clears state but preserves audit history', t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const session = service.ensureSession('mobile-2026-07-25-qf-4', 1, 'B');
  service.startSession(session.id);
  service.updateSlot(session.id, { slotId: 'hunter-ban-1', field: 'character', characterId: '失忆者' });
  const historyLength = service.getSession(session.id).history.length;
  const reset = service.resetSession(session.id);

  assert.equal(reset.status, 'ready');
  assert.equal(reset.currentPhaseIndex, -1);
  assert.equal(reset.slots['hunter-ban-1'].characterId, null);
  assert.equal(reset.history.length, historyLength + 1);
  assert.equal(reset.history.at(-1).action, 'session-reset');
});

test('clearing a completed phase during the zero pulse cancels advancement', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-bp-test-'));
  const service = new BpService({
    resolver: createTournamentResolver(),
    storePath: path.join(directory, 'state.json'),
    zeroPulseMs: 60,
    tickMs: 20
  });
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const session = service.ensureSession('mobile-2026-07-25-qf-1', 1, 'A');
  service.startSession(session.id);
  service.updateSlot(session.id, { slotId: 'hunter-ban-1', field: 'character', characterId: '失忆者' });
  assert.equal(service.getSession(session.id).timer.transitionPending, true);
  service.clearSlot(session.id, 'hunter-ban-1');
  await delay(80);

  const current = service.getSession(session.id);
  assert.equal(current.currentPhaseIndex, 0);
  assert.equal(current.timer.transitionPending, false);
  assert.equal(current.timer.running, true);
});

test('character output mode completes picks without selecting players', async t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const pushes = [];
  service.on('push-slot', event => pushes.push(event.slotId));
  const session = service.ensureSession('mobile-2026-07-25-qf-1', 1, 'A');
  service.setOutputMode(session.id, 'character');
  service.startSession(session.id);
  service.updateSlot(session.id, { slotId: 'hunter-ban-1', field: 'character', characterId: '失忆者' });
  await delay(12);
  service.updateSlot(session.id, { slotId: 'escape-ban-1', field: 'character', characterId: '雇佣兵' });
  await delay(12);
  service.updateSlot(session.id, { slotId: 'hunter-ban-2', field: 'character', characterId: '小学妹' });
  await delay(12);
  service.updateSlot(session.id, { slotId: 'hunter-pick-1', field: 'character', characterId: '机器人' });

  assert(pushes.includes('hunter-pick-1'));
  assert.equal(service.getSession(session.id).timer.transitionPending, true);
  assert.throws(
    () => service.updateSlot(session.id, { slotId: 'hunter-pick-1', field: 'playerText', playerText: '不应写入' }),
    /角色称号模式不需要输入选手昵称/
  );
});

test('BO3 sessions unlock in order and stop after a team reaches two wins', t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const matchId = 'mobile-2026-07-25-qf-1';
  assert.throws(() => service.ensureSession(matchId, 2, 'A'), /第 1 局 BP 尚未结束/);

  const first = service.ensureSession(matchId, 1, 'A');
  service.completeSession(first.id);
  service.setResult(first.id, 'escape');
  const second = service.ensureSession(matchId, 2, 'A');
  assert.throws(() => service.ensureSession(matchId, 3, 'A'), /第 2 局 BP 尚未结束/);

  service.completeSession(second.id);
  service.setResult(second.id, 'escape');
  assert.throws(() => service.ensureSession(matchId, 3, 'A'), /已有队伍取得 2 分/);
});

test('manual completion preserves selections and enters the post-BP flow', t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const session = service.ensureSession('mobile-2026-07-25-qf-1', 1, 'B');
  service.startSession(session.id);
  service.updateSlot(session.id, { slotId: 'hunter-ban-1', field: 'character', characterId: '失忆者' });
  const completed = service.completeSession(session.id);

  assert.equal(completed.status, 'completed');
  assert.equal(completed.slots['hunter-ban-1'].characterId, '失忆者');
  assert.equal(completed.timer.running, false);
  assert.equal(completed.timer.remainingSeconds, 0);
  assert.equal(completed.history.at(-1).action, 'bp-manually-completed');
});

test('forfeit awards two wins, locks BP and can be fully revoked', t => {
  const { directory, service } = fixture();
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const session = service.ensureSession('mobile-2026-07-25-qf-1', 1, 'A');
  service.startSession(session.id);
  const before = service.serialize(service.getSession(session.id));
  const forfeited = service.declareForfeit(session.id, 'juyi');

  assert.equal(forfeited.status, 'forfeited');
  assert.equal(forfeited.forfeit.forfeitingTeamId, 'juyi');
  assert.equal(forfeited.forfeit.winnerTeamId, 'feitongfanxiang');
  assert.deepEqual(forfeited.score, { escape: 0, hunter: 2 });
  assert.equal(service.matchWinner(session.matchId), 'feitongfanxiang');
  assert.throws(() => service.startSession(session.id), /请先撤回弃赛/);
  assert.throws(() => service.ensureSession(session.matchId, 2, 'A'), /已按弃赛结算/);

  const restored = service.revokeForfeit(session.id);
  assert.equal(restored.forfeit, null);
  assert.equal(restored.status, before.status);
  assert.equal(restored.currentPhaseIndex, before.currentPhaseIndex);
  assert.equal(restored.timer.running, true);
  assert.deepEqual(restored.score, { escape: 0, hunter: 0 });
  assert.equal(service.matchWinner(session.matchId), null);
  assert.equal(restored.history.at(-2).action, 'forfeit-declared');
  assert.equal(restored.history.at(-1).action, 'forfeit-revoked');
});
