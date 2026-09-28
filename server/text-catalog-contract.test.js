const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(
  path.join(root, 'public', 'assets', 'data', 'ui-text.json'),
  'utf8'
));
const jsDir = path.join(root, 'public', 'assets', 'js');

async function loadTextRuntime() {
  const sandbox = {
    window: {},
    Date,
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(catalog) }),
    document: {
      querySelectorAll: () => [],
      dispatchEvent: () => {}
    }
  };
  sandbox.window.fetch = sandbox.fetch;
  const source = fs.readFileSync(path.join(jsDir, 'text.js'), 'utf8');
  vm.runInNewContext(source, sandbox);
  await sandbox.window.Text.ready;
  return sandbox.window;
}

test('text runtime loads asynchronously, applies declarative text and exposes the shared helper', async () => {
  const win = await loadTextRuntime();
  assert.equal(typeof win.t, 'function');
  assert.equal(typeof win.text, 'function');
  assert.equal(typeof win.PageText.apply, 'function');
  assert.equal(win.UI_TEXT['ops.todoTitle'], catalog['ops.todoTitle']);
});

test('shared text helper is reusable by any module without local copies', async () => {
  const win = await loadTextRuntime();
  // 目录命中优先于兜底文案
  assert.equal(win.text('ops.todoTitle', '本地兜底'), catalog['ops.todoTitle']);
  // 键缺失回退兜底文案，且支持插值
  assert.equal(win.text('ops.notARealKey', '共 {count} 条', { count: 7 }), '共 7 条');
  // 键缺失且无兜底文案时回退空兜底
  assert.equal(win.text('ops.notARealKey', '占位'), '占位');
  // t 保持原语义：缺失返回键名，命中支持插值
  assert.equal(win.t('ops.notARealKey'), 'ops.notARealKey');
  assert.equal(win.t('ops.totalCount', { count: 12 }), catalog['ops.totalCount'].replace('{count}', '12'));
  // 同一运行时可被多个模块共享调用（无模块内状态）
  assert.equal(win.text('bp.modernBan', '禁用'), catalog['bp.modernBan']);
});

test('every t()/text() key referenced by frontend modules exists in the catalog', () => {
  const moduleFiles = fs.readdirSync(jsDir).filter(name => name.endsWith('.js'));
  for (const required of ['operations-center.js', 'bp-control.js', 'communications.js', 'schedule-manager.js']) {
    assert(moduleFiles.includes(required), `${required} should be scanned`);
  }
  const missing = [];
  for (const name of moduleFiles) {
    const source = fs.readFileSync(path.join(jsDir, name), 'utf8');
    const keys = new Set();
    for (const match of source.matchAll(/\bt\('([^']+)'/g)) keys.add(match[1]);
    for (const match of source.matchAll(/\btext\('([^']+)'/g)) keys.add(match[1]);
    for (const key of keys) {
      if (catalog[key] === undefined) missing.push(`${name}: ${key}`);
    }
  }
  assert.equal(missing.length, 0, `missing catalog keys:\n${missing.join('\n')}`);
});

test('every declarative data-text key on public pages exists in the catalog', () => {
  const missing = [];
  for (const name of fs.readdirSync(path.join(root, 'public')).filter(n => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, 'public', name), 'utf8');
    for (const match of html.matchAll(/data-text(?:-aria|-title|-placeholder)?="([^"]+)"/g)) {
      if (catalog[match[1]] === undefined) missing.push(`${name}: ${match[1]}`);
    }
  }
  assert.equal(missing.length, 0, `missing catalog keys:\n${missing.join('\n')}`);
});

test('operations center and bp control keep their UI copy inside the catalog', () => {
  for (const name of ['operations-center.js', 'bp-control.js']) {
    const source = fs.readFileSync(path.join(jsDir, name), 'utf8');
    const stripped = source.replace(/\btext\('([^']+)',\s*'[^']*'/g, `text('$1', ''`);
    assert.doesNotMatch(stripped, /\p{Script=Han}/u, `${name} still hardcodes UI text`);
  }
});

test('data-text hosts never wrap icon children on any page', () => {
  // text.js 的目录应用是 textContent 赋值：宿主若含 svg/img 等子元素，图标会被清掉。
  // 此契约做开标签级近似扫描（开标签之后 200 字符窗口内出现内联图标标签即违规），
  // 运行时兜底由 text.js apply 的纯文本守卫（跳过替换并告警）承担。
  const iconTag = /<(svg|img|video|canvas|object|iframe)\b/;
  const violations = [];
  for (const name of fs.readdirSync(path.join(root, 'public')).filter(n => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, 'public', name), 'utf8');
    const re = /<([a-z0-9]+)\b[^>]*\bdata-text="([^"]+)"[^>]*>/g;
    let match;
    while ((match = re.exec(html)) !== null) {
      // 只检查宿主自身的元素体：到同名闭合标签为止，兄弟节点的图标不算宿主子元素
      const bodyStart = match.index + match[0].length;
      const closeIdx = html.indexOf(`</${match[1]}>`, bodyStart);
      const body = html.slice(bodyStart, closeIdx === -1 ? bodyStart + 200 : closeIdx);
      if (iconTag.test(body)) violations.push(`${name}: <${match[1]}> ${match[2]}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('static HTML keeps non-catalog Chinese text nodes at or below the ratchet baseline', () => {
  // 棘轮断言：宿主无 data-text 的静态中文文本节点不得超过基线。
  // 收编存量后应手动下调基线；新增硬编码文案会直接失败。
  const pages = ['control.html', 'login.html', 'overlay.html', 'bp-overlay.html', 'bp-animation-design.html', 'match-intro-concept.html'];
  const baseline = {
    'control.html': 42,
    'login.html': 0,
    'overlay.html': 0,
    'bp-overlay.html': 0,
    'bp-animation-design.html': 14,
    'match-intro-concept.html': 4
  };
  for (const page of pages) {
    let source = fs.readFileSync(path.join(root, 'public', page), 'utf8');
    source = source.replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    let count = 0;
    for (const match of source.matchAll(/<([a-z][a-z0-9-]*)((?:[^<>])*?)>([^<>]*\p{Script=Han}[^<>]*)</gu)) {
      if (/data-text/.test(match[2])) continue;
      count += 1;
    }
    assert.ok(
      count <= baseline[page],
      `${page} 硬编码中文文本节点 ${count} 超过基线 ${baseline[page]}，请改用 data-text 或有意识地下调基线`
    );
  }
});
