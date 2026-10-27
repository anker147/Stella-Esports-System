const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

// 真实故障演练：spawn 真实服务器（文件库），由外部连接持有 BEGIN IMMEDIATE 写锁，
// 制造一次真实形态的写入失败（busy_timeout 耗尽 → SQLITE_BUSY）。
// 载体：计时中心 HUB 动作（withTransaction 包裹的通用写路径）。
// 验证三件事：写请求失败且进程存活；库中状态保持事务前原样（整体回滚）；
// 锁释放后同一写路径自愈。

const HUB_ID = 'countdown';

let childStderr = '';

async function spawnServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-drill-'));
  const dbPath = path.join(directory, 'data', 'app.db');
  const port = 39500 + Math.floor(Math.random() * 400);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      STELLA_DATA_DIR: path.join(directory, 'data'),
      STELLA_DB_PATH: dbPath,
      STELLA_DEFAULTS_DIR: path.resolve(__dirname, '..', 'defaults', 'data')
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  childStderr = '';
  child.stderr.on('data', chunk => { childStderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await waitForHealth(baseUrl, child);
  return { baseUrl, dbPath };
}

function waitForHealth(baseUrl, child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (child.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`server exited before health check (${child.exitCode})\n${childStderr}`));
        return;
      }
      try {
        const response = await fetch(`${baseUrl}/api/system/health`);
        if (response.ok) { clearInterval(timer); resolve(); return; }
      } catch {}
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`server health check timed out\n${childStderr}`));
      }
    }, 100);
  });
}

async function setupDeveloper(baseUrl) {
  let response = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'drill-test-password' })
  });
  assert.equal(response.status, 201);
  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'developer', account: 'administrator', password: 'drill-test-password' })
  });
  assert.equal(response.status, 200);
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

function hubAction(baseUrl, cookie, action) {
  return fetch(`${baseUrl}/api/hubs/${HUB_ID}/actions`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
    signal: AbortSignal.timeout(20000)
  });
}

function hubRunning(dbPath) {
  const probe = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return Boolean(probe.prepare('SELECT running FROM hub_states WHERE hub_id = ?').get(HUB_ID).running);
  } finally {
    probe.close();
  }
}

test('persist failure drill: write lock injects SQLITE_BUSY, transaction rolls back, server self-heals', { timeout: 90000 }, async t => {
  const { baseUrl, dbPath } = await spawnServer(t);
  const cookie = await setupDeveloper(baseUrl);

  // 基线：锁注入前写路径正常，start 动作落库（running = 1）
  const baseline = await hubAction(baseUrl, cookie, { type: 'start' });
  const baselineBody = await baseline.text();
  assert.equal(baseline.status, 200, baselineBody);
  assert.equal(hubRunning(dbPath), true);

  // 注入故障：外部连接持 BEGIN IMMEDIATE，服务器侧写入将在 busy_timeout(5s) 后 SQLITE_BUSY
  const lockHolder = new DatabaseSync(dbPath);
  lockHolder.exec('BEGIN IMMEDIATE');

  // 演练写操作：pause 需要落库，持锁期间必然失败，handler 回 4xx
  const drillResponse = await hubAction(baseUrl, cookie, { type: 'pause' });
  assert.ok(drillResponse.status >= 400,
    `drill action should fail under the write lock, got ${drillResponse.status}`);
  const drillBody = await drillResponse.text();
  console.log('[drill] locked action ->', drillResponse.status, drillBody);

  // 库中 running 仍是基线值：事务已整体回滚，未出现半写状态
  assert.equal(hubRunning(dbPath), true);

  // 进程存活且读路径正常（uncaughtException 守卫未触发崩溃）
  const health = await fetch(`${baseUrl}/api/system/health`);
  assert.equal(health.status, 200);
  await health.arrayBuffer().catch(() => {});

  // 释放锁后自愈：同一写操作成功，状态真正推进（running = 0）
  lockHolder.exec('COMMIT');
  lockHolder.close();
  const healed = await hubAction(baseUrl, cookie, { type: 'pause' });
  const healedBody = await healed.text();
  assert.equal(healed.status, 200, healedBody);
  assert.equal(hubRunning(dbPath), false);
});
