const fs = require('fs');
const path = require('path');
const { db, withTransaction } = require('./db');
const { DEFAULTS_ROOT, DATA_ROOT } = require('./data-paths');
const { importBpConfig } = require('./db-migrate');

const ANIMATION_STYLES = new Set(['classic', 'luminance']);

function seedCandidates() {
  return [path.join(DATA_ROOT, 'bp-config.json'), path.join(DEFAULTS_ROOT, 'bp-config.json')]
    .filter(candidate => fs.existsSync(candidate));
}

function ensureSeeded() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM characters').get().n;
  if (count > 0) return;
  const result = importBpConfig();
  if (result.skipped) {
    // 没有种子文件时给出一个可运行的最小骨架，避免服务无法启动
    withTransaction(() => {
      db.prepare("INSERT INTO app_settings (key, value_json) VALUES ('timer.durationSeconds', '30')").run();
      db.prepare("INSERT INTO app_settings (key, value_json) VALUES ('overlay.animationStyle', '\"luminance\"')").run();
    });
  }
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

function loadConfig() {
  ensureSeeded();
  const escape = db.prepare("SELECT id FROM characters WHERE role = 'escape' AND enabled = 1 ORDER BY sort_order").all().map(row => row.id);
  const hunter = db.prepare("SELECT id FROM characters WHERE role = 'hunter' AND enabled = 1 ORDER BY sort_order").all().map(row => row.id);
  const slotRows = db.prepare('SELECT * FROM bp_slots ORDER BY sort_order').all();
  const slots = {};
  for (const row of slotRows) {
    slots[row.id] = {
      label: row.label,
      kind: row.kind,
      role: row.role,
      ...(row.image_source ? { imageSource: row.image_source } : {}),
      ...(row.text_source ? { textSource: row.text_source } : {}),
      ...(row.image_group ? { imageGroup: row.image_group } : {}),
      ...(row.text_group ? { textGroup: row.text_group } : {}),
      ...(row.group_name ? { group: row.group_name } : {})
    };
  }
  const phaseSlotRows = db.prepare('SELECT * FROM bp_phase_slots ORDER BY sort_order').all();
  const slotsByPhase = new Map();
  for (const row of phaseSlotRows) {
    if (!slotsByPhase.has(row.phase_id)) slotsByPhase.set(row.phase_id, []);
    slotsByPhase.get(row.phase_id).push(row.slot_id);
  }
  const phases = db.prepare('SELECT * FROM bp_phases ORDER BY sort_order').all().map(row => ({
    id: row.id,
    label: row.label,
    slots: slotsByPhase.get(row.id) || []
  }));
  const phaseDurationsMap = Object.fromEntries(
    db.prepare('SELECT id, duration_seconds FROM bp_phases').all().map(row => [row.id, row.duration_seconds])
  );
  const config = {
    schemaVersion: 1,
    characters: { escape, hunter },
    slots,
    phases,
    timer: {
      durationSeconds: readSetting('timer.durationSeconds', 30),
      zeroPulseMs: readSetting('timer.zeroPulseMs', 600),
      phaseDurations: phaseDurationsMap
    },
    overlay: { animationStyle: readSetting('overlay.animationStyle', 'luminance') },
    commentator: {
      imageId: readSetting('commentator.imageId'),
      logoImageId: readSetting('commentator.logoImageId')
    },
    assets: readSetting('assets', {}),
    obsScenes: readSetting('obsScenes', {}),
    obsGroups: readSetting('obsGroups', {}),
    obsInputs: readSetting('obsInputs', {}),
    ui: {
      sections: {
        ban: db.prepare("SELECT slot_id FROM bp_ui_sections WHERE kind = 'ban' ORDER BY sort_order").all().map(row => row.slot_id),
        hunterPick: db.prepare("SELECT slot_id FROM bp_ui_sections WHERE kind = 'hunterPick' ORDER BY sort_order").all().map(row => row.slot_id),
        escapePick: db.prepare("SELECT slot_id FROM bp_ui_sections WHERE kind = 'escapePick' ORDER BY sort_order").all().map(row => row.slot_id)
      }
    }
  };
  return config;
}

const CONFIG = loadConfig();

if (CONFIG.characters.escape.length === 0 || CONFIG.characters.hunter.length === 0
  || Object.keys(CONFIG.slots).length === 0 || CONFIG.phases.length === 0) {
  throw new Error('Invalid BP configuration');
}

CONFIG.timer.phaseDurations ||= Object.fromEntries(
  CONFIG.phases.map(phase => [phase.id, CONFIG.timer.durationSeconds])
);
CONFIG.overlay ||= { animationStyle: 'luminance' };
CONFIG.commentator ||= { imageId: null };
CONFIG.commentator.logoImageId ||= 'logo';
CONFIG.assets.commentatorLogo ||= '场景底图/解说席/解说席LOGO.png';
CONFIG.assets.commentatorCodeRoot ||= '场景底图/解说席/兑换码';
CONFIG.obsScenes.commentator ||= '解说席/CDK';
CONFIG.obsGroups ||= {};
CONFIG.obsGroups.commentator ||= '解说席底板';
CONFIG.obsInputs.commentatorLogo ||= '解说LOGO';

function phaseDurations() {
  return Object.fromEntries(CONFIG.phases.map(phase => [
    phase.id,
    Number(CONFIG.timer.phaseDurations[phase.id] || CONFIG.timer.durationSeconds)
  ]));
}

function normalizedPhaseDurations(values) {
  const next = {};
  for (const phase of CONFIG.phases) {
    const seconds = Number(values?.[phase.id]);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) {
      throw new Error(`${phase.label}的倒计时必须是1到300秒的整数`);
    }
    next[phase.id] = seconds;
  }
  return next;
}

function animationStyle() {
  return ANIMATION_STYLES.has(CONFIG.overlay.animationStyle) ? CONFIG.overlay.animationStyle : 'luminance';
}

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

function updateBpTimerConfig({ phaseDurations: values, animationStyle: style } = {}) {
  const nextDurations = normalizedPhaseDurations(values);
  style ||= animationStyle();
  if (!ANIMATION_STYLES.has(style)) throw new Error('BP展开动画设置无效');
  CONFIG.overlay.animationStyle = style;
  CONFIG.timer.phaseDurations = nextDurations;
  withTransaction(() => {
    const updatePhase = db.prepare('UPDATE bp_phases SET duration_seconds = ? WHERE id = ?');
    for (const [phaseId, seconds] of Object.entries(nextDurations)) updatePhase.run(seconds, phaseId);
    writeSetting('overlay.animationStyle', style);
  });
  return { phaseDurations: phaseDurations(), animationStyle: animationStyle() };
}

function updatePhaseDurations(values) {
  const next = normalizedPhaseDurations(values);
  CONFIG.timer.phaseDurations = next;
  withTransaction(() => {
    const updatePhase = db.prepare('UPDATE bp_phases SET duration_seconds = ? WHERE id = ?');
    for (const [phaseId, seconds] of Object.entries(next)) updatePhase.run(seconds, phaseId);
  });
  return phaseDurations();
}

module.exports = {
  CONFIG,
  ESCAPE_CHARACTERS: CONFIG.characters.escape,
  HUNTER_CHARACTERS: CONFIG.characters.hunter,
  OBS_INPUTS: CONFIG.obsInputs,
  PHASES: CONFIG.phases,
  SLOT_CONFIG: CONFIG.slots,
  phaseDurations,
  updatePhaseDurations,
  animationStyle,
  updateBpTimerConfig,
  commentatorImageId,
  updateCommentatorImageId,
  commentatorLogoImageId,
  updateCommentatorLogoImageId
};
