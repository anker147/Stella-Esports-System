const assert = require('node:assert/strict');
const test = require('node:test');

process.env.STELLA_DB_PATH = ':memory:';

const { db } = require('./db');
const { migrateLegacyData, ensureBpTestMatch } = require('./db-migrate');
const { readAllData } = require('./tournament-data');

test.after(() => db.close());

test('BP test match is seeded once and exposed to the BP schedule', () => {
  const first = migrateLegacyData().bpTestMatch;
  const second = ensureBpTestMatch();
  assert.equal(first.matchId, 'bp-interface-test-match');
  assert.equal(second.matchId, first.matchId);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM matches
    WHERE id = 'bp-interface-test-match'`).get().count, 1);
  assert.equal(db.prepare(`SELECT exclude_from_character_stats AS excluded FROM matches
    WHERE id = 'bp-interface-test-match'`).get().excluded, 1);
  assert.deepEqual({ ...db.prepare(`SELECT matchup_home, matchup_away FROM matches
    WHERE id = 'bp-interface-test-match'`).get() }, {
    matchup_home: '365Days',
    matchup_away: '春信'
  });
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM match_rooms
    WHERE match_id = 'bp-interface-test-match'`).get().count, 2);

  const tournament = readAllData().find(item => item.event.id === 'bp-interface-test-event');
  assert(tournament);
  assert.equal(tournament.matches[0].excludeFromCharacterStats, true);
  assert.deepEqual(Object.keys(tournament.matches[0].rooms).sort(), ['A', 'B']);
});
