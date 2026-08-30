const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

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
        if (response.ok) {
          clearInterval(timer);
          resolve();
          return;
        }
      } catch {}
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error('server health check timed out'));
      }
    }, 100);
  });
}

function cookieFrom(response) {
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

test('authentication protects control pages and APIs while preserving OBS outputs', { timeout: 20000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-auth-test-'));
  const port = 39000 + Math.floor(Math.random() * 1500);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      STELLA_DATA_DIR: path.join(directory, 'data'),
      STELLA_DB_PATH: path.join(directory, 'data', 'app.db'),
      STELLA_DEFAULTS_DIR: path.resolve(__dirname, '..', 'defaults', 'data')
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

  let response = await fetch(`${baseUrl}/api/update-log`, { redirect: 'manual' });
  assert.equal(response.status, 401);

  response = await fetch(`${baseUrl}/control`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/');

  response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /id="loginFormUser"/);

  response = await fetch(`${baseUrl}/overlay`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /class="stage"/);

  response = await fetch(`${baseUrl}/api/auth/status`);
  assert.deepEqual(await response.json(), { setupRequired: true });

  response = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'release-test-password' })
  });
  assert.equal(response.status, 201);

  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user', account: 'operator', password: 'release-test-password', remember: false })
  });
  assert.equal(response.status, 200);
  const operatorCookie = cookieFrom(response);
  assert.match(operatorCookie, /^stella_session=/);
  assert.doesNotMatch(String(response.headers.get('set-cookie')), /Max-Age=/);

  response = await fetch(`${baseUrl}/api/update-log`, { headers: { Cookie: `x=1; ${operatorCookie}; y=2` } });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/bp/events`);
  assert.equal(response.status, 401);

  response = await fetch(`${baseUrl}/api/bp/timer-config`, {
    method: 'POST',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(response.status, 403);

  response = await fetch(`${baseUrl}/api/materials/import`, {
    method: 'POST',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(response.status, 403);

  response = await fetch(`${baseUrl}/api/materials/test-entry/delete`, {
    method: 'POST',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(response.status, 403);

  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'developer', account: 'administrator', password: 'release-test-password', remember: true })
  });
  assert.equal(response.status, 200);
  const developerCookie = cookieFrom(response);
  assert.match(String(response.headers.get('set-cookie')), /Max-Age=/);

  response = await fetch(`${baseUrl}/`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /data-page-panel="countdown"/);

  response = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: operatorCookie } });
  assert.equal(response.status, 200);
  assert.match(String(response.headers.get('set-cookie')), /Max-Age=0/);

  response = await fetch(`${baseUrl}/api/update-log`, { headers: { Cookie: operatorCookie } });
  assert.equal(response.status, 401);
});
