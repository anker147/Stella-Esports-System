const fs = require('fs');
const { mutableDataPath, parseJsonFile } = require('./data-paths');

const CONFIG_PATH = mutableDataPath('bp-config.json');
const CONFIG = parseJsonFile(CONFIG_PATH);

if (CONFIG.schemaVersion !== 1 || !CONFIG.characters || !CONFIG.slots || !CONFIG.phases) {
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

const ANIMATION_STYLES = new Set(['classic', 'luminance']);

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

function persistConfig() {
  const tempPath = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(CONFIG, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, CONFIG_PATH);
}

function updateCommentatorImageId(imageId) {
  if (imageId !== null && (typeof imageId !== 'string' || !imageId.trim())) {
    throw new Error('解说组图设置无效');
  }
  CONFIG.commentator.imageId = imageId;
  persistConfig();
  return commentatorImageId();
}

function updateCommentatorLogoImageId(imageId) {
  if (typeof imageId !== 'string' || !imageId.trim()) throw new Error('解说 LOGO 设置无效');
  CONFIG.commentator.logoImageId = imageId;
  persistConfig();
  return commentatorLogoImageId();
}

function updateBpTimerConfig({ phaseDurations: values, animationStyle: style } = {}) {
  const nextDurations = normalizedPhaseDurations(values);
  style ||= animationStyle();
  if (!ANIMATION_STYLES.has(style)) throw new Error('BP展开动画设置无效');
  CONFIG.overlay.animationStyle = style;
  CONFIG.timer.phaseDurations = nextDurations;
  persistConfig();
  return { phaseDurations: phaseDurations(), animationStyle: animationStyle() };
}

function updatePhaseDurations(values) {
  const next = normalizedPhaseDurations(values);
  CONFIG.timer.phaseDurations = next;
  persistConfig();
  return phaseDurations();
}

module.exports = {
  CONFIG,
  CONFIG_PATH,
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
