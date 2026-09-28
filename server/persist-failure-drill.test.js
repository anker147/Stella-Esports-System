const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

// 真实故障演练：spawn 真实服务器（文件库），由外部连接持有 BEGIN IMMEDIATE 写锁，
// 制造一次真实形态的 persist 失败（busy_timeout 耗尽 → SQLITE_BUSY）。
// 验证三件事：写请求失败且进程存活；内存权威态从库重载并向 SSE 广播 state-rolled-back；
// 锁释放后写路径自愈。测试场 matchId（bp-interface-test-match）免比赛上下文校验。

const TEST_MATCH_ID = 'bp-interface-test-match';

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

function createSession(baseUrl, cookie, gameNumber, { attempt = 1, room = 'A' } = {}) {
  return fetch(`${baseUrl}/api/bp/sessions`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId: TEST_MATCH_ID, gameNumber, room, attempt }),
    signal: AbortSignal.timeout(20000)
  });
}

function sessionCount(dbPath, gameNumber, attempt = 1) {
  const probe = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return probe.prepare('SELECT COUNT(*) AS n FROM bp_sessions WHERE match_id = ? AND game_number = ? AND attempt = ?')
      .get(TEST_MATCH_ID, gameNumber, attempt).n;
  } finally {
    probe.close();
  }
}

test('persist failure drill: write lock injects SQLITE_BUSY, state rolls back, server self-heals', { timeout: 90000 }, async t => {
  const { baseUrl, dbPath } = await spawnServer(t);
  const cookie = await setupDeveloper(baseUrl);

  // 订阅 BP 推送流，收集事件文本用于断言回滚广播
  const stream = await fetch(`${baseUrl}/api/bp/events`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(80000)
  });
  assert.equal(stream.status, 200);
  const streamText = { seen: '' };
  const streamReader = stream.body.getReader();
  t.after(() => { Promise.resolve(streamReader?.cancel()).catch(() => {}); });
  (async () => {
    try {
      for (;;) {
        const { done, value } = await streamReader.read();
        if (done) break;
        streamText.seen += Buffer.from(value).toString('utf8');
      }
    } catch {}
  })();

  // 基线：锁注入前写路径正常，game 1 落库
  const baseline = await createSession(baseUrl, cookie, 1);
  const baselineBody = await baseline.text();
  assert.equal(baseline.status, 200, baselineBody);
  assert.equal(sessionCount(dbPath, 1), 1);

  // 目标会话用 B 房 game 1：gameNumber=1 无前一局校验，room 维度独立成会话且非重赛；
  // 演练打击"更新已存在会话"的写路径，persist 失败后回滚才能从库重载到旧状态
  // （新建失败的回滚是内存移除，无广播）
  const target = await createSession(baseUrl, cookie, 1, { room: 'B' });
  const targetBody = await target.text();
  assert.equal(target.status, 200, targetBody);
  const targetId = JSON.parse(targetBody).id;
  assert.equal(sessionCount(dbPath, 1), 1);
  const targetCount = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(targetCount.prepare('SELECT COUNT(*) AS n FROM bp_sessions WHERE room = ?').get('B').n, 1);
  targetCount.close();

  // 注入故障：外部连接持 BEGIN IMMEDIATE，服务器侧写入将在 busy_timeout(5s) 后 SQLITE_BUSY
  const lockHolder = new DatabaseSync(dbPath);
  lockHolder.exec('BEGIN IMMEDIATE');

  // 演练写操作：对已存在会话发 start 动作，persist 失败上抛，handler 回 4xx/5xx
  const drillResponse = await fetch(`${baseUrl}/api/bp/sessions/${encodeURIComponent(targetId)}/actions`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'start' }),
    signal: AbortSignal.timeout(20000)
  });
  assert.ok(drillResponse.status >= 400,
    `drill action should fail under the write lock, got ${drillResponse.status}`);
  const drillBody = await drillResponse.text();
  console.log('[drill] locked action ->', drillResponse.status, drillBody);

  // 库中 game 2 仍是落库时的原始状态（status 未被推进）：事务已整体回滚
  const statusProbe = new DatabaseSync(dbPath, { readOnly: true });
  const persistedStatus = statusProbe.prepare('SELECT status FROM bp_sessions WHERE id = ?').get(targetId).status;
  statusProbe.close();
  assert.equal(persistedStatus, 'ready');

  // 进程存活且读路径正常（uncaughtException 守卫未触发崩溃）
  const health = await fetch(`${baseUrl}/api/system/health`);
  assert.equal(health.status, 200);
  await health.arrayBuffer().catch(() => {});

  // 释放锁后：SSE 流上应能看到 state-rolled-back（内存从库重载的纠正广播）
  lockHolder.exec('COMMIT');
  lockHolder.close();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !(streamText.seen || '').includes('state-rolled-back')) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok((streamText.seen || '').includes('state-rolled-back'), 'expected state-rolled-back broadcast on the bp stream');

  // 自愈：锁释放后同一写操作成功，会话状态真正推进
  const healed = await fetch(`${baseUrl}/api/bp/sessions/${encodeURIComponent(targetId)}/actions`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'start' }),
    signal: AbortSignal.timeout(20000)
  });
  const healedBody = await healed.text();
  assert.equal(healed.status, 200, healedBody);
  const healedProbe = new DatabaseSync(dbPath, { readOnly: true });
  const healedStatus = healedProbe.prepare('SELECT status FROM bp_sessions WHERE id = ?').get(targetId).status;
  healedProbe.close();
  assert.notEqual(healedStatus, 'ready');
});
