const { db: defaultDb } = require('./db');

const LINK_GUARDS_KEY = 'system.linkGuards';

function readBooleanSetting(database, key, fallback = false) {
  const row = database.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return Boolean(JSON.parse(row.value_json));
  } catch {
    return fallback;
  }
}

function linkGuardSettings(database = defaultDb) {
  return {
    link: readBooleanSetting(database, LINK_GUARDS_KEY, true)
  };
}

function saveLinkGuardSettings(database = defaultDb, input = {}) {
  if (typeof input.link !== 'boolean') throw new Error('链路环境守卫开关状态无效');
  database.prepare(`INSERT INTO app_settings (key, value_json) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`)
    .run(LINK_GUARDS_KEY, JSON.stringify(input.link));
  return linkGuardSettings(database);
}

module.exports = {
  LINK_GUARDS_KEY,
  linkGuardSettings,
  saveLinkGuardSettings
};
