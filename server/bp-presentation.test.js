const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { BpPresentationService } = require('./bp-presentation');
const { BpService } = require('./bp-service');
const { createTournamentResolver } = require('./tournament-data');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-bp-presentation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const resolver = createTournamentResolver();
  const bp = new BpService({ resolver, storePath: path.join(directory, 'bp.json') });
  t.after(() => bp.close());
  let now = 1000;
  const presentation = new BpPresentationService({
    resolver,
    getSession: id => bp.serialize(bp.getSession(id)),
    storePath: path.join(directory, 'presentation.json'),
    now: () => now
  });
  const session = bp.ensureSession('mobile-2026-07-25-qf-1', 1, 'A', 1);
  return { bp, presentation, session, advance: ms => { now += ms; } };
}

test('dynamic BP is disabled and transparent by default', t => {
  const { presentation } = fixture(t);
  const payload = presentation.payload();
  assert.equal(payload.dynamicEnabled, false);
  assert.equal(payload.visibility, 'hidden');
  assert.equal(payload.snapshot, null);
});

test('presentation resolves teams metadata and slot web assets', t => {
  const { bp, presentation, session } = fixture(t);
  const updated = bp.serialize(session);
  updated.outputMode = 'character';
  updated.slots['hunter-ban-1'].characterId = '小狐狸';
  updated.slots['hunter-pick-1'].characterId = '机器人';
  const snapshot = presentation.buildSnapshot(updated);
  assert.equal(snapshot.teams.escape.name, '聚义');
  assert.equal(snapshot.teams.hunter.name, '非同凡想');
  assert.equal(snapshot.metadata.game, 'MATCH 1');
  assert(['classic', 'luminance'].includes(snapshot.animationStyle));
  assert.equal(snapshot.slots['hunter-ban-1'].imageUrl, '/assets/characters/ban/%E5%B0%8F%E7%8B%90%E7%8B%B8.png?v=2');
  assert.equal(snapshot.slots['hunter-pick-1'].imageUrl, '/assets/characters/pick/%E6%9C%BA%E5%99%A8%E4%BA%BA.png?v=2');
});

test('pick presentation follows the legacy push completion rule', t => {
  const { bp, presentation, session } = fixture(t);
  const updated = bp.serialize(session);
  updated.slots['escape-pick-1'].characterId = '失忆者';
  let snapshot = presentation.buildSnapshot(updated);
  assert.equal(snapshot.slots['escape-pick-1'].complete, false);
  assert.equal(snapshot.slots['escape-pick-1'].characterId, null);
  assert.equal(snapshot.slots['escape-pick-1'].imageUrl, null);

  updated.slots['escape-pick-1'].playerText = '测试选手';
  snapshot = presentation.buildSnapshot(updated);
  assert.equal(snapshot.slots['escape-pick-1'].complete, true);
  assert.equal(snapshot.slots['escape-pick-1'].characterId, '失忆者');
  assert.equal(snapshot.slots['escape-pick-1'].text, '测试选手');
});

test('only the active session is published to the overlay', t => {
  const { bp, presentation, session } = fixture(t);
  const other = bp.ensureSession('mobile-2026-07-25-qf-2', 1, 'A', 1);
  presentation.setEnabled(true);
  presentation.prepare(bp.serialize(session));
  const before = presentation.state.sequence;
  assert.equal(presentation.publishSession(bp.serialize(other), 'slot-updated'), null);
  assert.equal(presentation.state.sequence, before);
  assert(presentation.publishSession(bp.serialize(session), 'timer-tick'));
  assert.equal(presentation.state.sequence, before + 1);
});

test('intro starts two seconds after scene confirmation and disabling hides it', t => {
  const { bp, presentation, session, advance } = fixture(t);
  presentation.setEnabled(true);
  presentation.prepare(bp.serialize(session));
  const armed = presentation.armIntro(bp.serialize(session));
  assert.equal(armed.visibility, 'armed');
  assert.equal(armed.playAt, 3000);
  assert.equal(armed.commandExpiresAt, 4500);
  advance(2000);
  assert.equal(presentation.payload().playAt, 3000);
  const disabled = presentation.setEnabled(false);
  assert.equal(disabled.visibility, 'hidden');
  assert.equal(disabled.playAt, null);
});

test('dynamic toggle persists but stale visibility never survives restart', t => {
  const { bp, presentation, session } = fixture(t);
  presentation.setEnabled(true);
  presentation.prepare(bp.serialize(session));
  presentation.armIntro(bp.serialize(session));
  const restored = new BpPresentationService({
    resolver: presentation.resolver,
    getSession: id => bp.serialize(bp.getSession(id)),
    storePath: presentation.storePath
  });
  assert.equal(restored.state.dynamicEnabled, true);
  assert.equal(restored.state.activeSessionId, session.id);
  assert.equal(restored.state.visibility, 'hidden');
  assert.equal(restored.state.playAt, null);
});
