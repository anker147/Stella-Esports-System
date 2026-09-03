const { db: defaultDb } = require('./db');

const NEW_BP_INTERFACE_KEY = 'laboratory.newBpInterface';

function readBooleanSetting(database, key, fallback = false) {
  const row = database.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return Boolean(JSON.parse(row.value_json));
  } catch {
    return fallback;
  }
}

function laboratorySettings(database = defaultDb) {
  return {
    newBpInterface: readBooleanSetting(database, NEW_BP_INTERFACE_KEY, false)
  };
}

function saveLaboratorySettings(database = defaultDb, input = {}) {
  if (typeof input.newBpInterface !== 'boolean') throw new Error('新版 BP 界面开关状态无效');
  database.prepare(`INSERT INTO app_settings (key, value_json) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`)
    .run(NEW_BP_INTERFACE_KEY, JSON.stringify(input.newBpInterface));
  return laboratorySettings(database);
}

module.exports = {
  NEW_BP_INTERFACE_KEY,
  laboratorySettings,
  saveLaboratorySettings
};
