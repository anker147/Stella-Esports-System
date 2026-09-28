const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.STELLA_DB_PATH = ':memory:';

const { db } = require('./db');
const { migrateLegacyData, ensureBpTestMatch } = require('./db-migrate');
const { readAllData, createTournamentResolver } = require('./tournament-data');
const { BpService } = require('./bp-service');

const TEST_MATCH_ID = 'bp-interface-test-match';

test.after(() => db.close());

test('BP test match is seeded once and exposed to the BP schedule', () => {
  const first = migrateLegacyData().bpTestMatch;
  const second = ensureBpTestMatch();
  assert.equal(first.matchId, TEST_MATCH_ID);
  assert.equal(second.matchId, first.matchId);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM matches
    WHERE id = '${TEST_MATCH_ID}'`).get().count, 1);
  assert.equal(db.prepare(`SELECT exclude_from_character_stats AS excluded FROM matches
    WHERE id = '${TEST_MATCH_ID}'`).get().excluded, 1);
  assert.deepEqual({ ...db.prepare(`SELECT matchup_home, matchup_away FROM matches
    WHERE id = '${TEST_MATCH_ID}'`).get() }, {
    matchup_home: '365Days',
    matchup_away: '春信'
  });
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM match_rooms
    WHERE match_id = '${TEST_MATCH_ID}'`).get().count, 2);

  const tournament = readAllData().find(item => item.event.id === 'bp-interface-test-event');
  assert(tournament);
  assert.equal(tournament.matches[0].excludeFromCharacterStats, true);
  assert.deepEqual(Object.keys(tournament.matches[0].rooms).sort(), ['A', 'B']);
});

test('test match sessions are rebuilt from scratch on every ensureSession', () => {
  migrateLegacyData();
  ensureBpTestMatch();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-bp-test-match-'));
  const service = new BpService({ resolver: createTournamentResolver(), zeroPulseMs: 5, tickMs: 20 });
  try {
    const first = service.ensureSession(TEST_MATCH_ID, 1, 'A');
    assert.equal(first.status, 'ready');
    service.startSession(first.id);
    const slotId = Object.keys(first.slots)[0];
    service.updateSlot(first.id, { slotId, field: 'character', characterId: '失忆者' });
    service.completeSession(first.id);
    service.setResult(first.id, 'escape');
    assert.equal(first.status, 'completed');

    // 再次载入：自动重建为全新 ready 会话，且该场全部历史被清空
    const rebuilt = service.ensureSession(TEST_MATCH_ID, 1, 'A');
    assert.equal(rebuilt.status, 'ready');
    assert.equal(rebuilt.id, first.id);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM bp_sessions WHERE id LIKE '${TEST_MATCH_ID}:%'`).get().count, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM bp_session_results WHERE session_id LIKE '${TEST_MATCH_ID}:%'`).get().count, 0);
    assert.ok(db.prepare(`SELECT COUNT(*) AS count FROM bp_session_history WHERE session_id LIKE '${TEST_MATCH_ID}:%'`).get().count <= 1, 'only the fresh session creation record may remain');
    assert.equal(db.prepare(`SELECT winner_team_id IS NULL AS cleared FROM matches WHERE id = '${TEST_MATCH_ID}'`).get().cleared, 1);
  } finally {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('non-test matches keep session reuse semantics', () => {
  const service = new BpService({ resolver: createTournamentResolver(), zeroPulseMs: 5, tickMs: 20 });
  try {
    const matchId = 'mobile-2026-07-25-qf-1';
    const session = service.ensureSession(matchId, 1, 'A');
    const again = service.ensureSession(matchId, 1, 'A');
    assert.equal(again.id, session.id);
    assert.equal(again.status, session.status);
    assert.equal(service.isTestMatch(matchId), false);
  } finally {
    service.close();
  }
});
