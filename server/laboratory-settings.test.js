const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const {
  NEW_BP_INTERFACE_KEY,
  laboratorySettings,
  saveLaboratorySettings
} = require('./laboratory-settings');

function fixture(t) {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)');
  t.after(() => database.close());
  return database;
}

test('new BP interface laboratory setting defaults off and persists explicitly', t => {
  const database = fixture(t);
  assert.deepEqual(laboratorySettings(database), { newBpInterface: false });
  assert.deepEqual(saveLaboratorySettings(database, { newBpInterface: true }), { newBpInterface: true });
  assert.equal(JSON.parse(database.prepare('SELECT value_json FROM app_settings WHERE key = ?')
    .get(NEW_BP_INTERFACE_KEY).value_json), true);
  assert.deepEqual(saveLaboratorySettings(database, { newBpInterface: false }), { newBpInterface: false });
});

test('laboratory setting rejects ambiguous switch values and repairs malformed storage', t => {
  const database = fixture(t);
  database.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)')
    .run(NEW_BP_INTERFACE_KEY, 'invalid-json');
  assert.deepEqual(laboratorySettings(database), { newBpInterface: false });
  assert.throws(() => saveLaboratorySettings(database, { newBpInterface: 'true' }), /开关状态无效/);
});
