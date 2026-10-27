// 常用设备与安全密码：前端/服务端源码契约测试。
// 锁定页面挂载点、加载顺序、路由权限门、敏感页清单前后端一致与文字目录键齐全。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const moduleSource = read('public', 'assets', 'js', 'device-security.js');
const serverServiceSource = read('server', 'device-security-service.js');
const serverSource = read('server', 'server.js');
const controlHtml = read('public', 'control.html');
const loginHtml = read('public', 'login.html');
const loginJs = read('public', 'assets', 'js', 'login.js');
const profileJs = read('public', 'assets', 'js', 'profile.js');
const controlJs = read('public', 'assets', 'js', 'control.js');
const textCatalog = JSON.parse(read('public', 'assets', 'data', 'ui-text.json'));

function extractArray(source, name) {
  const match = source.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  assert.ok(match, `${name} must be declared`);
  return match[1].split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

test('device-security.js 保持零汉字、暴露 open/close 并接入页面切换门禁', () => {
  assert.doesNotMatch(moduleSource, /[\u4e00-\u9fff]/, 'new frontend modules must stay free of CJK characters');
  assert.match(moduleSource, /window\.DeviceSecurity = Object\.freeze\(\{ open, close \}\)/);
  assert.match(moduleSource, /stella:before-page-change/);
  assert.match(moduleSource, /scope: 'pages'/);
  assert.match(moduleSource, /scope: 'devices'/);
  assert.match(moduleSource, /stella\.autoLogin\.token/);
});

test('敏感页清单前后端一致', () => {
  const frontendPages = extractArray(moduleSource, 'SENSITIVE_PAGES');
  const backendPages = extractArray(serverServiceSource, 'SENSITIVE_PAGES');
  assert.deepEqual(frontendPages, backendPages);
  const backendPrefixes = extractArray(serverServiceSource, 'SENSITIVE_API_PREFIXES');
  assert.ok(backendPrefixes.length >= frontendPages.length);
  assert.ok(backendPrefixes.includes('/api/friends'));
  assert.ok(backendPrefixes.includes('/api/communications'));
});

test('control.html 以独立功能页挂载常用设备并按序加载样式与脚本', () => {
  assert.match(controlHtml, /data-page="devices"/);
  assert.match(controlHtml, /data-text="nav\.item\.devices"/);
  assert.match(controlHtml, /id="devicesPage"/);
  assert.match(controlHtml, /data-page-panel="devices"/);
  assert.match(controlHtml, /id="deviceSecurityRoot"/);
  assert.match(controlHtml, /assets\/css\/device-security\.css\?v=\d+/);
  // 旧形态（个人设置弹窗内的选项卡）必须彻底移除
  assert.doesNotMatch(controlHtml, /data-settings-tab="devices"/);
  assert.doesNotMatch(controlHtml, /profilePanelDevices/);
  const textTag = controlHtml.indexOf('assets/js/text.js');
  const securityTag = controlHtml.indexOf('assets/js/device-security.js');
  const dataCacheTag = controlHtml.indexOf('assets/js/data-cache.js');
  assert.ok(textTag >= 0 && securityTag > textTag, 'text.js must precede device-security.js');
  assert.ok(dataCacheTag >= 0 && securityTag > dataCacheTag, 'data-cache.js must precede device-security.js');

  // pageCopy 深链注册（/?page=devices 直达）
  assert.match(controlJs, /devices: \{ titleKey: 'page\.devices\.title', descriptionKey: 'page\.devices\.desc' \}/);

  for (const page of ['overlay.html', 'bp-animation-design.html', 'match-intro-concept.html']) {
    const source = read('public', page);
    assert.ok(!source.includes('device-security.js'), `${page} must not load device-security.js`);
  }
});

test('profile.js 不再承载常用设备入口，模块由页面切换事件驱动', () => {
  assert.doesNotMatch(profileJs, /DeviceSecurity/);
  assert.doesNotMatch(profileJs, /data-settings-panel="devices"/);
  assert.match(moduleSource, /stella:page-change/);
  assert.match(moduleSource, /page === 'devices'/);
});

test('服务端路由权限门与租约敏感 API 门禁齐备', () => {
  const permissions = [
    'POST /api/auth/auto-login',
    'POST /api/auth/lease-login',
    'GET /api/security/overview',
    'GET /api/security/accounts',
    'POST /api/security/devices/challenge-account',
    'POST /api/security/challenge-security',
    'PUT /api/security/credential',
    'PUT /api/security/window',
    'PUT /api/security/devices/:id',
    'DELETE /api/security/devices/:id'
  ];
  for (const entry of permissions) {
    assert.ok(serverSource.includes(`'${entry}':`), `ROUTE_PERMISSIONS must cover ${entry}`);
  }
  assert.match(serverSource, /requestSession\?\.leaseGated && requestSession\.pagesUnlockedAt == null/);
  assert.match(serverSource, /SECURITY_UNLOCK_REQUIRED/);
  assert.match(serverSource, /clearUserSecurityUnlocks/);
  assert.match(serverSource, /deviceSecurity\.enableAutoLogin/);
  assert.match(serverSource, /deviceSecurity\.findLeaseDevice/);
  assert.match(serverSource, /\{ leaseGated: true \}/);
});

test('登录页提供自动登录勾选，login.js 完成静默重登链路', () => {
  assert.match(loginHtml, /name="autoLogin"/);
  assert.match(loginHtml, /data-text="login\.autoLogin"/);
  assert.match(loginJs, /autoLogin: Boolean\(forms\.user\.autoLogin\?\.checked\)/);
  assert.match(loginJs, /stella\.autoLogin\.token/);
  assert.match(loginJs, /stella\.lease\.userId/);
  assert.match(loginJs, /api\/auth\/auto-login/);
  assert.match(loginJs, /api\/auth\/lease-login/);
  const autoAttempt = loginJs.indexOf('api/auth/auto-login');
  const leaseAttempt = loginJs.indexOf('api/auth/lease-login');
  assert.ok(autoAttempt >= 0 && leaseAttempt > autoAttempt, 'auto-login must be attempted before lease login');
  // 登出必须清掉本机自动登录 token，否则无法真正退出
  assert.match(controlJs, /stella\.autoLogin\.token/);
});

test('本功能引用的目录键全部存在', () => {
  const keys = new Set();
  for (const match of moduleSource.matchAll(/text\('([^']+)'/g)) keys.add(match[1]);
  for (const match of moduleSource.matchAll(/text\(`([^`]+)`/g)) {
    const template = match[1];
    if (template.includes('${')) {
      const expansions = template.includes('secret') ? ['numeric', 'pattern', 'mixed'] : ['desktop', 'mobile', 'tablet'];
      for (const expansion of expansions) {
        keys.add(template.replace(/\$\{[^}]+\}/g, expansion));
      }
    } else {
      keys.add(template);
    }
  }
  keys.add('nav.item.devices');
  keys.add('page.devices.title');
  keys.add('page.devices.desc');
  keys.add('login.autoLogin');
  keys.add('login.autoLoginPending');
  const missing = [...keys].filter(key => !(key in textCatalog));
  assert.deepEqual(missing, [], `missing catalog keys: ${missing.join(', ')}`);
});

test('安全密码类型与租约选项在目录中齐备', () => {
  for (const key of ['devices.typeNumeric', 'devices.typePattern', 'devices.typeMixed',
    'devices.leaseNone', 'devices.lease7', 'devices.lease30', 'devices.lease90',
    'devices.lease365', 'devices.leasePermanent',
    'devices.window0', 'devices.window60', 'devices.window480', 'devices.window1440', 'devices.window10080']) {
    assert.ok(key in textCatalog, `${key} must exist in ui-text.json`);
  }
});
