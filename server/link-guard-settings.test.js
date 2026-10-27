const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const {
  LINK_GUARDS_KEY,
  linkGuardSettings,
  saveLinkGuardSettings
} = require('./link-guard-settings');

function fixture(t) {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)');
  t.after(() => database.close());
  return database;
}

test('link guard setting defaults on and persists explicitly', t => {
  const database = fixture(t);
  assert.deepEqual(linkGuardSettings(database), { link: true });
  assert.deepEqual(saveLinkGuardSettings(database, { link: false }), { link: false });
  assert.equal(JSON.parse(database.prepare('SELECT value_json FROM app_settings WHERE key = ?')
    .get(LINK_GUARDS_KEY).value_json), false);
  assert.deepEqual(saveLinkGuardSettings(database, { link: true }), { link: true });
});

test('link guard setting rejects ambiguous switch values and repairs malformed storage', t => {
  const database = fixture(t);
  database.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)')
    .run(LINK_GUARDS_KEY, 'invalid-json');
  assert.deepEqual(linkGuardSettings(database), { link: true });
  assert.throws(() => saveLinkGuardSettings(database, { link: 'false' }), /开关状态无效/);
});
