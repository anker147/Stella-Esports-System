'use strict';
// 审计日志覆盖面测试：消息撤回/修改/加急、岗位申请提交、管理员操作回传 JSON、
// 账号离线（心跳超时与 beacon 断开）与页面刷新不误记离线。
// 全部走 HTTP 级测试（recordAuditLog 无法脱离 server.js 单测），
// 离线场景通过 STELLA_PRESENCE_TIMEOUT_MS / STELLA_PRESENCE_SWEEP_MS 缩短定时窗口。
const assert = require('node:assert/strict');
const child_process = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const PASSWORD = 'audit-log-test-password';

function waitForHealth(baseUrl, child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (child.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`server exited before health check (${child.exitCode})`));
        return;
      }
      try {
        const response = await fetch(`${baseUrl}/api/system/health`);
        if (response.ok) { clearInterval(timer); resolve(); return; }
      } catch {}
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error('server health check timed out'));
      }
    }, 100);
  });
}

async function spawnServer(t, env = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-audit-log-'));
  const dbPath = path.join(directory, 'data', 'app.db');
  const port = 42500 + Math.floor(Math.random() * 1500);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = child_process.spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      STELLA_DATA_DIR: path.join(directory, 'data'),
      STELLA_DB_PATH: dbPath,
      STELLA_DEFAULTS_DIR: path.resolve(__dirname, '..', 'defaults', 'data'),
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await waitForHealth(baseUrl, child).catch(error => {
    throw new Error(`${error.message}\n${output}`);
  });
  return baseUrl;
}

async function initializeSystem(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD })
  });
  assert.equal(response.status, 201, 'auth setup should succeed on a fresh database');
}

async function login(baseUrl, account, role = 'developer', password = PASSWORD) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, account, password })
  });
  assert.equal(response.status, 200, `login ${account} failed: ${response.status}`);
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

async function accountLogs(baseUrl, cookie, action) {
  const response = await fetch(
    `${baseUrl}/api/logs?category=account&limit=200&q=${encodeURIComponent(action)}`,
    { headers: { Cookie: cookie } }
  );
  assert.equal(response.status, 200, `log query failed for ${action}: ${response.status}`);
  const payload = await response.json();
  return payload.logs.filter(item => item.action === action);
}

test('audit logs record message ops, title applications and admin response payloads', { timeout: 120000 }, async t => {
  const baseUrl = await spawnServer(t);
  await initializeSystem(baseUrl);
  const adminCookie = await login(baseUrl, 'administrator');

  // 消息链路：发送 → 修改 → 加急 → 撤回，各自应产出独立审计日志
  const seeded = await fetch(`${baseUrl}/api/communications/channels/global/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ content: 'audit-log-probe-original' })
  });
  assert.equal(seeded.status, 201);
  const message = (await seeded.json()).message;

  const edited = await fetch(`${baseUrl}/api/communications/messages/${message.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ content: 'audit-log-probe-edited' })
  });
  assert.equal(edited.status, 200);

  const urgent = await fetch(`${baseUrl}/api/communications/messages/${message.id}/urgent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ urgent: true })
  });
  assert.equal(urgent.status, 200);

  const recalled = await fetch(`${baseUrl}/api/communications/messages/${message.id}/recall`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: '{}'
  });
  assert.equal(recalled.status, 200);

  let logs = await accountLogs(baseUrl, adminCookie, '修改消息');
  assert.equal(logs.length, 1, 'editing a message should log exactly once');
  assert.equal(logs[0].details.contentPreview, 'audit-log-probe-edited');
  assert.equal(logs[0].details.previousContentPreview, 'audit-log-probe-original');
  assert.equal(logs[0].details.channelId, 'global');
  assert.equal(logs[0].details.messageId, message.id);

  logs = await accountLogs(baseUrl, adminCookie, '设置消息加急');
  assert.equal(logs.length, 1, 'marking a message urgent should log exactly once');
  assert.equal(logs[0].details.messageId, message.id);
  assert.equal(logs[0].details.channelId, 'global');

  logs = await accountLogs(baseUrl, adminCookie, '撤回消息');
  assert.equal(logs.length, 1, 'recalling a message should log exactly once');
  assert.equal(logs[0].details.contentPreview, 'audit-log-probe-original');
  assert.equal(logs[0].details.kind, 'text');
  assert.equal(logs[0].details.channelId, 'global');

  // 管理员创建账号：审计日志应包含接口回传的完整 JSON
  const created = await fetch(`${baseUrl}/api/admin/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      account: 'title-applicant',
      displayName: '岗位申请测试号',
      password: 'applicant-password-123'
    })
  });
  assert.equal(created.status, 201);
  const account = await created.json();
  assert.equal(account.role, 'user');

  logs = await accountLogs(baseUrl, adminCookie, '创建账号');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].details.account, 'title-applicant');
  assert.equal(logs[0].details.response.id, account.id);
  assert.equal(logs[0].details.response.account, 'title-applicant');
  assert.equal(logs[0].details.response.role, 'user');

  // 普通用户修改岗位会生成待审申请，应产出「提交岗位申请」日志
  const applicantCookie = await login(baseUrl, 'title-applicant', 'user', 'applicant-password-123');
  const profileUpdate = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: applicantCookie },
    body: JSON.stringify({ title: '测试岗位申请' })
  });
  assert.equal(profileUpdate.status, 200);

  logs = await accountLogs(baseUrl, adminCookie, '提交岗位申请');
  assert.equal(logs.length, 1, 'submitting a title request should log exactly once');
  assert.equal(logs[0].details.requestedTitle, '测试岗位申请');
  assert.equal(logs[0].actorUserId, account.id);

  // 审批日志应包含申请的岗位与审批后的账号回传 JSON
  const review = await fetch(`${baseUrl}/api/admin/accounts/${account.id}/title-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ decision: 'approved' })
  });
  assert.equal(review.status, 200);

  logs = await accountLogs(baseUrl, adminCookie, '批准岗位申请');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].details.requestedTitle, '测试岗位申请');
  assert.equal(logs[0].details.response.title, '测试岗位申请');
  assert.equal(logs[0].details.response.id, account.id);
});

test('presence sweep records offline events and ignores page refresh', { timeout: 120000 }, async t => {
  const baseUrl = await spawnServer(t, {
    STELLA_PRESENCE_TIMEOUT_MS: '1200',
    STELLA_PRESENCE_SWEEP_MS: '300'
  });
  await initializeSystem(baseUrl);
  const cookie = await login(baseUrl, 'administrator');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const offlineLogs = () => accountLogs(baseUrl, cookie, '账号离线');
  const heartbeat = () => fetch(`${baseUrl}/api/presence/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ lastActivityAt: Date.now() })
  });
  const disconnect = () => fetch(`${baseUrl}/api/presence/disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: '{}'
  });

  // 情形一：登录后心跳断档（模拟崩溃/休眠）→ 记录「心跳超时」
  await sleep(2600);
  let logs = await offlineLogs();
  assert.equal(logs.length, 1, 'heartbeat gap should log one offline event');
  assert.equal(logs[0].details.reason, '心跳超时');
  assert.equal(logs[0].success, true);

  // 情形二：beacon 主动断开（页面关闭）→ 宽限期后记录「连接断开」
  await heartbeat();
  await disconnect();
  await sleep(2600);
  logs = await offlineLogs();
  assert.equal(logs.length, 2, 'beacon disconnect should log one more offline event');
  const reasons = logs.map(item => item.details.reason).sort();
  assert.deepEqual(reasons, ['心跳超时', '连接断开']);

  // 刷新场景：断开后心跳立即恢复并持续 → 宽限期内不算离线，不产生新记录
  await heartbeat();
  await disconnect();
  const beat = setInterval(() => { heartbeat().catch(() => {}); }, 300);
  await sleep(2600);
  logs = await offlineLogs();
  assert.equal(logs.length, 2, 'page refresh within grace period must not log offline again');
  clearInterval(beat);
});
