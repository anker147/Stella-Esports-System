const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const uiText = JSON.parse(fs.readFileSync(
  path.join(root, 'public', 'assets', 'data', 'ui-text.json'),
  'utf8'
));
const script = fs.readFileSync(
  path.join(root, 'public', 'assets', 'js', 'character-stats.js'),
  'utf8'
);
const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');
const service = fs.readFileSync(path.join(root, 'server', 'character-stats.js'), 'utf8');

test('character page dynamic copy only references the shared text catalog', () => {
  const keys = [...script.matchAll(/\bt\('([^']+)'/g)].map(match => match[1]);
  assert(keys.length > 0);
  for (const key of keys) assert.notEqual(uiText[key], undefined, `missing UI text: ${key}`);
  assert.doesNotMatch(script, /\p{Script=Han}/u);
});

test('character page declarative text keys exist in the shared text catalog', () => {
  const pageStart = html.indexOf('id="characterStatsPage"');
  const pageEnd = html.indexOf('</dialog>', html.indexOf('id="characterStatsDetailDialog"'));
  assert(pageStart >= 0 && pageEnd > pageStart);
  const markup = html.slice(pageStart, pageEnd);
  const keys = [...markup.matchAll(/data-text(?:-aria|-title|-placeholder)?="([^"]+)"/g)]
    .map(match => match[1]);
  for (const key of keys) assert.notEqual(uiText[key], undefined, `missing UI text: ${key}`);
});

test('character manager exposes indexed historical changes and square icon guidance', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'character-stats.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'assets', 'css', 'control.css'), 'utf8');
  const text = JSON.parse(fs.readFileSync(path.join(root, 'public', 'assets', 'data', 'ui-text.json'), 'utf8'));
  assert.match(html, /id="characterExistingChanges"/);
  assert.match(script, /renderExistingChanges\(character\)/);
  assert.match(text['characterStats.skillIconHelp'], /128×128/);
  assert.match(text['characterStats.skillIconHelp'], /512KB/);
  assert.match(html, /class="character-editor-topline"/);
  assert.match(html, /btn btn-primary character-portrait-select/);
  assert.match(css, /\.character-editor-topline\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 4\.5fr\) minmax\(0, 5\.5fr\)/);
  assert.match(css, /\.character-editor-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.character-editor-grid label:nth-child\(4\)\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
  assert.doesNotMatch(css, /\.character-usage-facts dd\.has-tooltip\s*\{[^}]*border-bottom/);
});

test('character detail keeps recent usage and recent changes as separate stacked cards', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'assets', 'css', 'control.css'), 'utf8');
  const usageStart = html.indexOf('<section class="character-latest-usage"');
  const changeStart = html.indexOf('<section class="character-change-history"', usageStart);
  const usageMarkup = html.slice(usageStart, changeStart);
  assert.match(usageMarkup, /id="characterLatestTeam"/);
  assert.match(usageMarkup, /id="characterLatestMatch"/);
  assert.match(css, /\.character-usage-primary\s*\{[\s\S]*grid-template-rows:\s*minmax\(0, 4\.6fr\) minmax\(0, 5\.4fr\)/);
  assert.doesNotMatch(usageMarkup, /<h[1-6][^>]*>\s*最近使用\s*<\/h[1-6]>/);
});

test('character statistics runtime no longer reads the JSON profile seed', () => {
  assert.doesNotMatch(service, /character-profile-data\.json|CHARACTER_PROFILES/);
});

test('character management uses one workspace with hosted portrait previews and server IDs', () => {
  assert.match(html, /id="characterManageButton"/);
  assert.match(html, /id="characterManagerList"/);
  assert.match(html, /id="characterManagerNew"/);
  assert.match(html, /id="characterPortraitPreview"/);
  assert.match(html, /id="characterPortraitInput"[^>]*type="file"/);
  assert.match(html, /id="characterEditorNickname"[^>]*name="nickname"[^>]*required/);
  assert.match(html, /id="characterChangeDraftAdd"/);
  assert.match(html, /id="characterChangeDrafts"/);
  assert.doesNotMatch(html, /id="characterDetailEdit"/);
  assert.doesNotMatch(html, /id="characterEditorPortraitUrl"/);
  assert.match(script, /dataset\.skillIconInput/);
  assert.match(script, /iconChanged:\s*true/);
  assert.match(script, /changesToAdd:/);
  assert.doesNotMatch(script, /data-skill-field="iconUrl"|window\.(?:alert|confirm)\s*\(/);
});

test('character detail preserves the equal main columns and bounded nested card scrolling', () => {
  const css = fs.readFileSync(path.join(root, 'public', 'assets', 'css', 'control.css'), 'utf8');
  assert.match(html, /id="characterChangeHistory"/);
  assert.match(html, /id="characterChangePrevious"/);
  assert.match(html, /id="characterChangeNext"/);
  assert.match(html, /id="characterChangeDetailDialog"[^>]*aria-labelledby="characterChangeDetailTitle"[^>]*aria-describedby="characterChangeDetailContent"/);
  assert.match(script, /document\.createElement\('button'\)[\s\S]*aria-haspopup[\s\S]*openChangeDetail/s);
  assert.match(css, /\.character-detail-body\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(html, /character-usage-layout[\s\S]*character-usage-primary[\s\S]*character-latest-usage[\s\S]*character-change-history[\s\S]*character-usage-secondary[\s\S]*character-common-card[\s\S]*character-recent-results/);
  assert.match(css, /\.character-usage-layout\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.character-usage-primary\s*\{[^}]*grid-template-rows:\s*minmax\(0, 4\.6fr\) minmax\(0, 5\.4fr\)/s);
  assert.doesNotMatch(html, /<h4[^>]*data-text="characterStats\.latestUsage"/);
  assert.match(css, /\.character-latest-usage-grid\s*\{[^}]*grid-template-columns:\s*minmax\(120px, 0\.84fr\) minmax\(0, 1\.16fr\)/s);
  assert.match(script, /character-team-logo-frame/);
  assert.match(css, /\.character-team-logo-frame\s*\{[^}]*aspect-ratio:\s*1;/s);
  assert.match(css, /\.character-team-row\.is-featured\s*\{[^}]*grid-template-columns:\s*minmax\(72px, 42%\) minmax\(0, 1fr\)/s);
  assert.match(css, /\.character-usage-facts\s*\{[^}]*grid-template-rows:\s*minmax\(38px, auto\)[^;]*minmax\(62px, 1fr\)/s);
  assert.match(css, /\.character-usage-facts div\s*\{[^}]*grid-template-columns:\s*58px minmax\(0, 1fr\)/s);
  assert.match(css, /\.character-usage-secondary\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.character-recent-results\s*\{[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(css, /\.character-change-columns\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.character-change-card\s*\{[^}]*height:\s*58px/s);
  assert.match(script, /dataset\.tooltip\s*=\s*t\('characterStats\.matchTooltip'/);
  assert.match(css, /\.character-manager-list\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /@keyframes character-manager-item-in/);
  assert.match(css, /@keyframes character-editor-layer-in/);
  assert.match(css, /\.character-compact-list,[\s\S]*?\.character-result-list\s*\{[^}]*overflow:\s*hidden auto;/s);
});
