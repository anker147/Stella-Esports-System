const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('laboratory BP layout keeps the required side counts and dynamic central picker', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'bp-control.js'), 'utf8');
  assert.match(html, /id="bpModernEscapeSlots"/);
  assert.match(html, /id="bpModernHunterSlots"/);
  assert.match(html, /id="bpModernEscapeBans"/);
  assert.match(html, /id="bpModernHunterBans"/);
  assert.match(html, /id="bpModernCharacterGrid"/);
  assert.match(script, /bootstrap\.ui\.sections\.escapePick\.map\(modernSlotMarkup\)/);
  assert.match(script, /bootstrap\.ui\.sections\.hunterPick\.map\(modernSlotMarkup\)/);
  assert.match(script, /bootstrap\.characters\[config\.role\]/);
  assert.match(script, /session\.currentPhaseIndex/);
  assert.match(script, /stella:lab-settings-change/);
});

test('system settings page exposes only the laboratory content surface', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'operations-center.js'), 'utf8');
  const section = html.match(/<section class="page-view" id="systemSettingsPage"[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(section, /data-operations-toolbar/);
  assert.match(script, /panel\('实验室功能'/);
  assert.match(script, /启用新版 BP 界面/);
  assert.doesNotMatch(script.match(/function renderSettings\(data\) \{[\s\S]*?return fragment;\n  \}/)?.[0] || '', /运行策略|访问与会话|素材索引/);
});
