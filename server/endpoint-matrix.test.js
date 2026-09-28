const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

// 全端点状态码基线矩阵：路由表化重构的保护网。
// 每行断言三类身份下的状态码落在允许集合内——
// 匿名未登录、operator（低权限账号）、developer（全权限）。
// 捕获的失败模式：端点消失（404）、鉴权门丢失（匿名 200）、权限门丢失（operator 200）、处理器崩溃（500）。
// SSE 长连接、shutdown、window/maximize、需要真实业务 id 的参数化端点不在矩阵内（另行覆盖）。

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

let childStderr = '';

async function spawnServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-matrix-'));
  const dbPath = path.join(directory, 'data', 'app.db');
  const port = 39000 + Math.floor(Math.random() * 1500);
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
  return { directory, baseUrl };
}

async function login(baseUrl, account, password, role = 'developer') {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, account, password })
  });
  assert.equal(response.status, 200, `login ${account} failed: ${response.status}`);
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

async function probe(baseUrl, cookie, method, apiPath, body) {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(8000)
  });
  // 消费响应体避免连接泄漏（SSE 端点不在矩阵内，普通响应都会结束）
  await response.arrayBuffer().catch(() => {});
  return response.status;
}

const MATRIX = [
  ["system health", "GET", "/api/system/health", null, { anon: [200], operator: [200], dev: [200] }],
  ["system shutdown without token", "POST", "/api/system/shutdown", null, { anon: [403], operator: [403], dev: [403] }],
  ["auth status", "GET", "/api/auth/status", null, { anon: [200], operator: [200], dev: [200] }],
  ["auth session", "GET", "/api/auth/session", null, { anon: [200], operator: [200], dev: [200] }],
  ["presence heartbeat", "POST", "/api/presence/heartbeat", { lastActivityAt: Date.now() }, { anon: [401], operator: [200], dev: [200] }],
  ["presence disconnect", "POST", "/api/presence/disconnect", null, { anon: [401], operator: [200], dev: [200] }],
  ["presence preference", "POST", "/api/presence/preference", {"status":"online"}, { anon: [401], operator: [400], dev: [400] }],
  ["presence work", "POST", "/api/presence/work", {"working":true}, { anon: [401], operator: [200], dev: [200] }],
  ["profile read", "GET", "/api/profile", null, { anon: [401], operator: [200], dev: [200] }],
  ["profile update", "PUT", "/api/profile", {}, { anon: [401], operator: [200], dev: [200] }],
  ["profile identity", "POST", "/api/profile/identity", {}, { anon: [401], operator: [400], dev: [400] }],
  ["operations personal", "GET", "/api/operations/personal", null, { anon: [401], operator: [200], dev: [200] }],
  ["operations teams", "GET", "/api/operations/teams?limit=20&offset=0", null, { anon: [401], operator: [200], dev: [200] }],
  ["operations terminal", "GET", "/api/operations/terminal", null, { anon: [401], operator: [200], dev: [200] }],
  ["operations dataConfig", "GET", "/api/operations/dataConfig", null, { anon: [401], operator: [200], dev: [200] }],
  ["operations settings", "GET", "/api/operations/settings", null, { anon: [401], operator: [200], dev: [200] }],
  ["events list", "GET", "/api/events", null, { anon: [401], operator: [200], dev: [200] }],
  ["events team candidates", "GET", "/api/events/team-candidates", null, { anon: [401], operator: [200], dev: [200] }],
  ["events create", "POST", "/api/events", {}, { anon: [401], operator: [400], dev: [400] }],
  ["bp bootstrap", "GET", "/api/bp/bootstrap", null, { anon: [401], operator: [200], dev: [200] }],
  ["bp presentation read", "GET", "/api/bp/presentation", null, { anon: [401], operator: [200], dev: [200] }],
  ["bp timer-config read", "GET", "/api/bp/timer-config", null, { anon: [401], operator: [200], dev: [200] }],
  ["bp timer-config write", "POST", "/api/bp/timer-config", {}, { anon: [401], operator: [400], dev: [400] }],
  ["bp commentator options", "GET", "/api/bp/commentator-options", null, { anon: [401], operator: [200], dev: [200] }],
  ["notifications read", "GET", "/api/notifications", null, { anon: [401], operator: [200], dev: [200] }],
  ["notifications read-all", "POST", "/api/notifications/read-all", null, { anon: [401], operator: [200], dev: [200] }],
  ["communications bootstrap", "GET", "/api/communications/bootstrap", null, { anon: [401], operator: [200], dev: [200] }],
  ["friends list", "GET", "/api/friends", null, { anon: [401], operator: [200], dev: [200] }],
  ["users search", "GET", "/api/users/search?q=a", null, { anon: [401], operator: [200], dev: [200] }],
  ["materials list", "GET", "/api/materials?offset=0&limit=20", null, { anon: [401], operator: [200], dev: [200] }],
  ["character stats", "GET", "/api/character-stats?division=all", null, { anon: [401], operator: [200], dev: [200] }],
  ["hubs countdown state", "GET", "/api/hubs/countdown/state", null, { anon: [401], operator: [200], dev: [200] }],
  ["hubs countdown logs", "GET", "/api/hubs/countdown/logs?limit=5", null, { anon: [401], operator: [200], dev: [200] }],
  ["hubs obs status", "GET", "/api/hubs/obs/status", null, { anon: [401], operator: [200], dev: [200] }],
  ["hubs create", "POST", "/api/hubs", null, { anon: [401], operator: [201], dev: [201] }],
  ["obs status", "GET", "/api/obs/status", null, { anon: [401], operator: [200], dev: [200] }],
  ["update log", "GET", "/api/update-log", null, { anon: [401], operator: [200], dev: [200] }],
  ["logs account", "GET", "/api/logs?category=account&offset=0&limit=10", null, { anon: [401], operator: [200], dev: [200] }],
  ["auth logout", "POST", "/api/auth/logout", null, { anon: [200], operator: [200], dev: [200] }],
  ["unknown api path stays 404", "GET", "/api/definitely-not-a-real-endpoint", null, { anon: [401], operator: [401], dev: [401] }],
];

test('endpoint status matrix: every route stays reachable and correctly gated', { timeout: 120000 }, async t => {
  const { baseUrl } = await spawnServer(t);

  // 初始化开发者密码，产生 administrator 加 operator 两个账号
  let response = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'matrix-test-password' })
  });
  assert.equal(response.status, 201);

  const devCookie = await login(baseUrl, 'administrator', 'matrix-test-password');
  // operator 走开发者门户（与 auth-server.test.js 的验证路径一致）
  const operatorCookie = await login(baseUrl, 'operator', 'matrix-test-password');

  const identities = {
    anon: null,
    operator: operatorCookie,
    dev: devCookie
  };

  const failures = [];
  for (const [label, method, apiPath, body, expectations] of MATRIX) {
    for (const identity of ['anon', 'operator', 'dev']) {
      const allowed = expectations[identity];
      const status = await probe(baseUrl, identities[identity], method, apiPath, body);
      if (!allowed.includes(status)) {
        failures.push(`${identity} ${method} ${apiPath} -> ${status} (allowed: ${allowed.join('/')}) [${label}]`);
      }
    }
  }
  assert.deepEqual(failures, [], `endpoint matrix violations:\n${failures.join('\n')}`);
});
