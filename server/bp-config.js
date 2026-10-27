const { db } = require('./db');
const { importBpConfig } = require('./db-migrate');

function ensureSeeded() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM characters').get().n;
  if (count > 0) return;
  // bp_slots/bp_phases/bp_ui_sections 由种子导入维护：角色数据页等只读统计仍依赖槽位表
  importBpConfig();
}

function readSetting(key, fallback = null) {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return fallback;
  }
}

function writeSetting(key, value) {
  db.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json')
    .run(key, JSON.stringify(value));
}

function loadCharacterMeta() {
  // 不携带 BLOB 数据，恒定轻量；立绘以 BLOB 存在但无文件 URL 时下发按需读取接口地址
  const rows = db.prepare(`SELECT c.id, c.nickname, c.display_name, c.portrait_url,
    (p.character_id IS NOT NULL) AS has_blob FROM characters c
    LEFT JOIN character_portraits p ON p.character_id = c.id`).all();
  const meta = {};
  for (const row of rows) {
    meta[row.id] = {
      nickname: row.nickname || row.id,
      displayName: row.display_name || row.id,
      portraitUrl: row.portrait_url || (row.has_blob ? `/api/characters/${encodeURIComponent(row.id)}/portrait` : '')
    };
  }
  return meta;
}

function loadConfig() {
  ensureSeeded();
  const escape = db.prepare("SELECT id FROM characters WHERE role = 'escape' AND enabled = 1 ORDER BY sort_order").all().map(row => row.id);
  const hunter = db.prepare("SELECT id FROM characters WHERE role = 'hunter' AND enabled = 1 ORDER BY sort_order").all().map(row => row.id);
  return {
    schemaVersion: 1,
    characters: { escape, hunter },
    characterMeta: loadCharacterMeta(),
    commentator: {
      imageId: readSetting('commentator.imageId'),
      logoImageId: readSetting('commentator.logoImageId')
    },
    assets: readSetting('assets', {}),
    obsScenes: readSetting('obsScenes', {}),
    obsGroups: readSetting('obsGroups', {}),
    obsInputs: readSetting('obsInputs', {})
  };
}

function reloadCharacterRoster() {
  const escape = db.prepare("SELECT id FROM characters WHERE role = 'escape' AND enabled = 1 ORDER BY sort_order, id").all().map(row => row.id);
  const hunter = db.prepare("SELECT id FROM characters WHERE role = 'hunter' AND enabled = 1 ORDER BY sort_order, id").all().map(row => row.id);
  CONFIG.characters.escape.splice(0, CONFIG.characters.escape.length, ...escape);
  CONFIG.characters.hunter.splice(0, CONFIG.characters.hunter.length, ...hunter);
  CONFIG.characterMeta = loadCharacterMeta();
  return { escape: [...CONFIG.characters.escape], hunter: [...CONFIG.characters.hunter] };
}

const CONFIG = loadConfig();

if (CONFIG.characters.escape.length === 0 || CONFIG.characters.hunter.length === 0) {
  // 空配置不再崩进程：服务照常启动，管理端可先修复角色配置
  console.error('[bp-config] 角色名单为空，服务以降级模式启动');
}

CONFIG.commentator ||= { imageId: null };
CONFIG.commentator.logoImageId ||= 'logo';
CONFIG.assets.commentatorLogo ||= '场景底图/解说席/解说席LOGO.png';
CONFIG.assets.commentatorCodeRoot ||= '场景底图/解说席/兑换码';
CONFIG.obsScenes.commentator ||= '解说席/CDK';
CONFIG.obsGroups ||= {};
CONFIG.obsGroups.commentator ||= '解说席底板';
CONFIG.obsInputs.commentatorLogo ||= '解说LOGO';

function commentatorImageId() {
  return typeof CONFIG.commentator.imageId === 'string' && CONFIG.commentator.imageId
    ? CONFIG.commentator.imageId
    : null;
}

function commentatorLogoImageId() {
  return typeof CONFIG.commentator.logoImageId === 'string' && CONFIG.commentator.logoImageId
    ? CONFIG.commentator.logoImageId
    : 'logo';
}

function updateCommentatorImageId(imageId) {
  if (imageId !== null && (typeof imageId !== 'string' || !imageId.trim())) {
    throw new Error('解说组图设置无效');
  }
  CONFIG.commentator.imageId = imageId;
  writeSetting('commentator.imageId', imageId);
  return commentatorImageId();
}

function updateCommentatorLogoImageId(imageId) {
  if (typeof imageId !== 'string' || !imageId.trim()) throw new Error('解说 LOGO 设置无效');
  CONFIG.commentator.logoImageId = imageId;
  writeSetting('commentator.logoImageId', imageId);
  return commentatorLogoImageId();
}

module.exports = {
  CONFIG,
  OBS_INPUTS: CONFIG.obsInputs,
  commentatorImageId,
  updateCommentatorImageId,
  commentatorLogoImageId,
  updateCommentatorLogoImageId,
  reloadCharacterRoster
};
