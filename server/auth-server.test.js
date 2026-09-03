const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
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
    body: JSON.stringify({ role: 'developer', account: 'operator', password: 'wrong-password' })
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: 'INVALID_ADMIN_CREDENTIALS',
    error: '管理员账号或密码错误'
  });

  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'developer', account: 'administrator', password: 'wrong-password' })
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: 'INVALID_ADMIN_CREDENTIALS',
    error: '管理员账号或密码错误'
  });

  for (const role of ['user', 'developer']) {
    response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, account: `missing-${role}`, password: 'wrong-password' })
    });
    assert.equal(response.status, 401);
  }

  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'developer', account: 'operator', password: 'release-test-password' })
  });
  assert.equal(response.status, 200);
  const administratorCookie = cookieFrom(response);
  response = await fetch(`${baseUrl}/api/profile`, { headers: { Cookie: administratorCookie } });
  let administratorProfile = await response.json();
  assert.equal(administratorProfile.role, 'admin');
  assert.equal(administratorProfile.identityKey, 'administrator');
  assert.equal(administratorProfile.identity.systemManagement, true);
  response = await fetch(`${baseUrl}/api/admin/accounts`, { headers: { Cookie: administratorCookie } });
  assert.equal(response.status, 200);
  await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: administratorCookie } });

  const identityDb = new DatabaseSync(dbPath);
  const standardUser = identityDb.prepare("SELECT id FROM users WHERE username = 'operator'").get();
  identityDb.exec('BEGIN');
  identityDb.prepare("UPDATE users SET role = 'user', display_name = '操作员' WHERE id = ?").run(standardUser.id);
  identityDb.prepare("UPDATE user_profiles SET identity_key = 'director' WHERE user_id = ?").run(standardUser.id);
  identityDb.prepare('DELETE FROM user_identity_assignments WHERE user_id = ?').run(standardUser.id);
  identityDb.prepare(`INSERT INTO user_identity_assignments (user_id, identity_key, sort_order)
    VALUES (?, 'director', 0)`).run(standardUser.id);
  identityDb.exec('COMMIT');
  identityDb.close();

  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.20',
      'CF-IPCountry': 'CN',
      'CF-Region': encodeURIComponent('上海市'),
      'CF-IPCity': encodeURIComponent('上海')
    },
    body: JSON.stringify({
      role: 'user',
      account: 'operator',
      password: 'release-test-password',
      remember: false,
      deviceId: 'device-a',
      deviceFingerprint: 'a'.repeat(64),
      deviceName: 'Windows · Test Browser A'
    })
  });
  assert.equal(response.status, 200);
  let operatorCookie = cookieFrom(response);
  assert.match(operatorCookie, /^stella_session=/);
  assert.doesNotMatch(String(response.headers.get('set-cookie')), /Max-Age=/);

  response = await fetch(`${baseUrl}/api/update-log`, { headers: { Cookie: `x=1; ${operatorCookie}; y=2` } });
  assert.equal(response.status, 200);

  const replacedOperatorCookie = operatorCookie;
  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.20',
      'CF-IPCountry': 'CN',
      'CF-Region': encodeURIComponent('上海市'),
      'CF-IPCity': encodeURIComponent('上海')
    },
    body: JSON.stringify({
      role: 'user',
      account: 'operator',
      password: 'release-test-password',
      remember: false,
      deviceId: 'device-b',
      deviceFingerprint: 'b'.repeat(64),
      deviceName: 'Windows · Test Browser B'
    })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).replacedSessionCount, 1);
  operatorCookie = cookieFrom(response);
  response = await fetch(`${baseUrl}/api/update-log`, { headers: { Cookie: replacedOperatorCookie } });
  assert.equal(response.status, 401);

  response = await fetch(`${baseUrl}/api/profile`, { headers: { Cookie: operatorCookie } });
  assert.equal(response.status, 200);
  let profile = await response.json();
  assert.equal(profile.account, 'operator');
  assert.equal(profile.role, 'user');
  assert.equal(profile.identityKey, 'director');
  assert.deepEqual(profile.identity, {
    kind: 'operator',
    accessLevel: 'standard',
    systemManagement: false
  });
  assert.equal(profile.displayName, '操作员');
  assert.equal(profile.hasAvatar, false);
  assert.equal(profile.avatarUrl, null);
  assert.equal(Object.hasOwn(profile, 'avatar'), false);
  assert.equal(profile.home.defaultPage, 'personalCenter');
  assert.deepEqual(profile.visibleStats, ['duty_time', 'account_expiry', 'event_count', 'game_count']);
  assert.equal(profile.region, '上海市');
  assert.equal(profile.presenceStatus, 'online');
  assert.equal(profile.presencePreference, 'auto');

  response = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'A 房导播',
      title: '主控操作员',
      bio: '负责 BP 与赛事画面调度',
      avatar: 'data:image/png;base64,iVBORw0KGgo=',
      cover: 'data:image/webp;base64,AQIDBA==',
      gender: 'other',
      birthDate: '2000-08-08',
      presencePreference: 'away',
      visibleStats: ['duty_time', 'game_count']
    })
  });
  assert.equal(response.status, 200);
  profile = await response.json();
  assert.equal(profile.displayName, 'A 房导播');
  assert.equal(profile.home.defaultPage, 'personalCenter');
  assert.equal(profile.hasAvatar, true);
  assert.match(profile.avatarUrl, /^\/api\/profiles\/[a-f0-9-]+\/avatar\?v=[a-f0-9]{64}$/);
  assert.match(profile.coverUrl, /^\/api\/profiles\/[a-f0-9-]+\/cover\?v=[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(profile, 'avatar'), false);
  assert.deepEqual(profile.visibleStats, ['duty_time', 'game_count']);
  assert.equal(profile.gender, 'other');
  assert.equal(profile.presenceStatus, 'away');
  assert.equal(profile.presencePreference, 'away');
  assert.equal(profile.title, '');
  assert.equal(profile.pendingTitle, '主控操作员');

  response = await fetch(`${baseUrl}/api/presence/work`, {
    method: 'POST',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: true, contextId: 'bp:test-session' })
  });
  assert.equal(response.status, 200);
  let presence = await response.json();
  assert.equal(presence.status, 'working');
  assert.equal(presence.preference, 'away');

  response = await fetch(`${baseUrl}/api/presence/heartbeat`, {
    method: 'POST',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ activityCount: 20, lastActivityAt: Date.now() })
  });
  presence = await response.json();
  assert.equal(presence.status, 'working');

  response = await fetch(`${baseUrl}/api/presence/work`, {
    method: 'POST',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: false, contextId: 'bp:other-session' })
  });
  presence = await response.json();
  assert.equal(presence.status, 'working');

  response = await fetch(`${baseUrl}/api/presence/work`, {
    method: 'POST',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: false, contextId: 'bp:test-session' })
  });
  presence = await response.json();
  assert.equal(presence.status, 'away');
  assert.equal(presence.preference, 'away');

  response = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ presencePreference: 'auto' })
  });
  profile = await response.json();
  assert.equal(profile.presencePreference, 'auto');

  response = await fetch(`${baseUrl}/api/presence/heartbeat`, {
    method: 'POST',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ activityCount: 12, lastActivityAt: Date.now() })
  });
  presence = await response.json();
  assert.equal(presence.status, 'online');

  response = await fetch(`${baseUrl}/api/presence/preference`, {
    method: 'POST',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ preference: 'busy' })
  });
  assert.equal(response.status, 200);
  presence = await response.json();
  assert.equal(presence.status, 'busy');
  assert.equal(presence.preference, 'busy');

  response = await fetch(`${baseUrl}/api/presence/preference`, {
    method: 'POST',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ preference: 'auto' })
  });
  assert.equal(response.status, 200);

  const presenceDb = new DatabaseSync(dbPath);
  presenceDb.prepare(`UPDATE user_presence SET
    last_heartbeat_at = ?, last_activity_at = ?, activity_window_started_at = ?, activity_count = 0
    WHERE user_id = (SELECT id FROM users WHERE username = 'operator')`)
    .run(Date.now(), Date.now() - 6 * 60 * 1000, Date.now());
  presenceDb.close();
  response = await fetch(`${baseUrl}/api/profile`, { headers: { Cookie: operatorCookie } });
  profile = await response.json();
  assert.equal(profile.presenceStatus, 'away');

  const stalePresenceDb = new DatabaseSync(dbPath);
  stalePresenceDb.prepare(`UPDATE user_presence SET last_heartbeat_at = ?
    WHERE user_id = (SELECT id FROM users WHERE username = 'operator')`)
    .run(Date.now() - 80 * 1000);
  stalePresenceDb.close();
  response = await fetch(`${baseUrl}/api/profile`, { headers: { Cookie: operatorCookie } });
  profile = await response.json();
  assert.equal(profile.presenceStatus, 'offline');

  response = await fetch(`${baseUrl}/api/presence/heartbeat`, {
    method: 'POST',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ activityCount: 1, lastActivityAt: Date.now() })
  });
  presence = await response.json();
  assert.equal(presence.status, 'online');

  response = await fetch(`${baseUrl}/api/presence/disconnect`, {
    method: 'POST', headers: { Cookie: operatorCookie }
  });
  presence = await response.json();
  assert.equal(presence.status, 'offline');

  response = await fetch(`${baseUrl}/api/presence/heartbeat`, {
    method: 'POST',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ activityCount: 1, lastActivityAt: Date.now() })
  });
  presence = await response.json();
  assert.equal(presence.status, 'online');

  response = await fetch(`${baseUrl}/api/profile/avatar`, { headers: { Cookie: operatorCookie } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  const avatarEtag = response.headers.get('etag');
  assert.match(avatarEtag, /^"[a-f0-9]{64}"$/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from('iVBORw0KGgo=', 'base64'));

  response = await fetch(`${baseUrl}/api/profile/avatar`, {
    headers: { Cookie: operatorCookie, 'If-None-Match': avatarEtag }
  });
  assert.equal(response.status, 304);

  const avatarUrl = profile.avatarUrl;
  const profileSavePayload = { ...profile };
  delete profileSavePayload.region;
  delete profileSavePayload.regionSource;
  response = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(profileSavePayload)
  });
  assert.equal(response.status, 200);
  profile = await response.json();
  assert.equal(profile.avatarUrl, avatarUrl);
  response = await fetch(`${baseUrl}${profile.avatarUrl}`, { headers: { Cookie: operatorCookie } });
  assert.equal(response.headers.get('etag'), avatarEtag);

  const profileDb = new DatabaseSync(dbPath);
  const operator = profileDb.prepare("SELECT id FROM users WHERE username = 'operator'").get();
  assert.deepEqual(
    {
      ...profileDb.prepare('SELECT title, bio, gender, birth_date, region FROM user_profiles WHERE user_id = ?')
        .get(operator.id)
    },
    {
      title: '',
      bio: '负责 BP 与赛事画面调度',
      gender: 'other',
      birth_date: '2000-08-08',
      region: '上海市'
    }
  );
  assert.deepEqual(
    profileDb.prepare('SELECT stat_key, sort_order FROM user_profile_stat_visibility WHERE user_id = ? ORDER BY sort_order')
      .all(operator.id)
      .map(row => ({ ...row })),
    [{ stat_key: 'duty_time', sort_order: 0 }, { stat_key: 'game_count', sort_order: 1 }]
  );
  assert.deepEqual(
    {
      ...profileDb.prepare('SELECT mime_type, byte_size FROM user_avatars WHERE user_id = ?').get(operator.id)
    },
    { mime_type: 'image/png', byte_size: 8 }
  );
  assert.equal(
    profileDb.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key LIKE 'user.profile.%'").get().n,
    0
  );
  assert.deepEqual(
    {
      ...profileDb.prepare(`SELECT ip_address, region, device_fingerprint, device_name
        FROM user_login_history WHERE user_id = ? ORDER BY logged_in_at DESC LIMIT 1`).get(operator.id)
    },
    {
      ip_address: '203.0.113.20',
      region: '上海市',
      device_fingerprint: 'b'.repeat(64),
      device_name: 'Windows · Test Browser B'
    }
  );
  profileDb.close();

  response = await fetch(`${baseUrl}/api/profile`, { headers: { Cookie: operatorCookie } });
  profile = await response.json();
  assert.equal(profile.title, '');
  assert.equal(profile.pendingTitle, '主控操作员');
  assert.deepEqual(profile.visibleStats, ['duty_time', 'game_count']);

  response = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...profileSavePayload, avatar: 'data:image/svg+xml;base64,PHN2Zz4=' })
  });
  assert.equal(response.status, 400);

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

  response = await fetch(`${baseUrl}/api/admin/accounts`, { headers: { Cookie: operatorCookie } });
  assert.equal(response.status, 403);
  response = await fetch(`${baseUrl}/api/admin/permissions`, { headers: { Cookie: operatorCookie } });
  assert.equal(response.status, 403);
  response = await fetch(`${baseUrl}/api/admin/laboratory-settings`, { headers: { Cookie: operatorCookie } });
  assert.equal(response.status, 403);

  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'developer', account: 'administrator', password: 'release-test-password', remember: true })
  });
  assert.equal(response.status, 200);
  let developerCookie = cookieFrom(response);
  assert.match(String(response.headers.get('set-cookie')), /Max-Age=/);

  response = await fetch(`${baseUrl}/api/admin/laboratory-settings`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { newBpInterface: false });
  response = await fetch(`${baseUrl}/api/admin/laboratory-settings`, {
    method: 'PUT',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ newBpInterface: true })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { newBpInterface: true });
  response = await fetch(`${baseUrl}/api/bp/bootstrap`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).laboratory, { newBpInterface: true });

  response = await fetch(`${baseUrl}/api/profile`, { headers: { Cookie: developerCookie } });
  profile = await response.json();
  assert.deepEqual(profile.identity, {
    kind: 'developer',
    accessLevel: 'full',
    systemManagement: true
  });
  assert.equal(profile.displayName, '开发者');
  assert.equal(profile.identityKey, 'developer');
  assert.equal(profile.home.defaultPage, 'personalCenter');

  response = await fetch(`${baseUrl}/api/admin/permissions`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  let permissionsPayload = await response.json();
  assert.equal(permissionsPayload.catalog.some(item => item.key === 'permissions.manage'), true);
  assert.equal(permissionsPayload.identities.find(item => item.key === 'developer').immutable, true);
  assert.equal(permissionsPayload.accounts.some(item => item.id === operator.id), true);

  response = await fetch(`${baseUrl}/api/admin/permissions/accounts/${encodeURIComponent(operator.id)}`, {
    method: 'PUT',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ grants: ['communication.use', 'friends.manage'], denies: [] })
  });
  assert.equal(response.status, 200);
  permissionsPayload = await response.json();
  assert.deepEqual(
    permissionsPayload.accounts.find(item => item.id === operator.id).grants,
    ['communication.use', 'friends.manage']
  );

  const guestPolicy = permissionsPayload.identities.find(item => item.key === 'guest').permissions;
  response = await fetch(`${baseUrl}/api/admin/permissions/identities/guest`, {
    method: 'PUT',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissions: guestPolicy })
  });
  assert.equal(response.status, 200);

  const developerId = profile.id;
  response = await fetch(`${baseUrl}/api/admin/accounts/${developerId}`, {
    method: 'PUT',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityKeys: ['developer', 'director'] })
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/profile/identity`, {
    method: 'POST',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityKey: 'administrator' })
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    code: 'IDENTITY_SWITCH_INVALID',
    error: '该账号没有此身份'
  });

  response = await fetch(`${baseUrl}/api/profile/identity`, {
    method: 'POST',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityKey: 'director' })
  });
  assert.equal(response.status, 200);
  profile = await response.json();
  assert.equal(profile.role, 'developer');
  assert.equal(profile.activeIdentityKey, 'director');
  assert.deepEqual(profile.identity, {
    kind: 'operator',
    accessLevel: 'standard',
    systemManagement: false
  });

  response = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).activeIdentityKey, 'director');

  response = await fetch(`${baseUrl}/api/admin/system-access`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 403);

  response = await fetch(`${baseUrl}/api/profile/identity`, {
    method: 'POST',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityKey: 'developer' })
  });
  assert.equal(response.status, 200);
  profile = await response.json();
  assert.equal(profile.activeIdentityKey, 'developer');
  assert.equal(profile.identity.systemManagement, true);

  response = await fetch(`${baseUrl}/api/admin/system-access`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { open: true });

  response = await fetch(`${baseUrl}/api/admin/system-access`, { headers: { Cookie: operatorCookie } });
  assert.equal(response.status, 403);

  const sessionEventResponse = await fetch(`${baseUrl}/api/session/events`, {
    headers: { Cookie: operatorCookie }
  });
  assert.equal(sessionEventResponse.status, 200);
  const sessionEventReader = sessionEventResponse.body.getReader();
  const eventDecoder = new TextDecoder();
  const initialSessionEvent = await sessionEventReader.read();
  assert.match(eventDecoder.decode(initialSessionEvent.value), /event: session-state/);

  response = await fetch(`${baseUrl}/api/admin/system-access`, {
    method: 'PUT',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ open: false })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { open: false });
  let revokeTimeout;
  const revokedSessionEvent = await Promise.race([
    sessionEventReader.read(),
    new Promise((resolve, reject) => {
      revokeTimeout = setTimeout(() => reject(new Error('session revocation event timed out')), 2000);
    })
  ]);
  clearTimeout(revokeTimeout);
  assert.match(eventDecoder.decode(revokedSessionEvent.value), /event: session-revoked/);
  assert.match(eventDecoder.decode(revokedSessionEvent.value), /system-access-closed/);
  await sessionEventReader.cancel();

  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user', account: 'operator', password: 'release-test-password' })
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: 'SYSTEM_ACCESS_CLOSED',
    error: '系统暂未开放用户登录，请联系管理员'
  });

  response = await fetch(`${baseUrl}/api/update-log`, { headers: { Cookie: operatorCookie } });
  assert.equal(response.status, 401);
  response = await fetch(`${baseUrl}/api/update-log`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  const accessDb = new DatabaseSync(dbPath);
  assert.equal(accessDb.prepare("SELECT status FROM users WHERE username = 'operator'").get().status, 'active');
  assert.equal(JSON.parse(accessDb.prepare("SELECT value_json FROM app_settings WHERE key = 'system.access.open'").get().value_json), false);
  const storedSessions = JSON.parse(accessDb.prepare("SELECT value_json FROM app_settings WHERE key = 'auth.sessions'").get().value_json);
  assert.equal(storedSessions.length, 1);
  assert.equal(storedSessions[0].role, 'developer');
  const operatorPresence = accessDb.prepare('SELECT status, last_heartbeat_at FROM user_presence WHERE user_id = ?')
    .get(operator.id);
  assert.equal(operatorPresence.status, 'offline');
  assert.equal(operatorPresence.last_heartbeat_at, null);
  const latestOperatorDuty = accessDb.prepare(`SELECT ended_at FROM user_duty_logs
    WHERE user_id = ? ORDER BY started_at DESC LIMIT 1`).get(operator.id);
  assert.notEqual(latestOperatorDuty.ended_at, null);
  accessDb.close();

  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'developer', account: 'administrator', password: 'release-test-password', remember: true
    })
  });
  assert.equal(response.status, 200);
  developerCookie = cookieFrom(response);

  response = await fetch(`${baseUrl}/api/admin/system-access`, {
    method: 'PUT',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ open: true })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { open: true });

  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'user',
      account: 'operator',
      password: 'release-test-password',
      remember: false,
      deviceId: 'device-b',
      deviceFingerprint: 'b'.repeat(64),
      deviceName: 'Windows · Test Browser B'
    })
  });
  assert.equal(response.status, 200);
  operatorCookie = cookieFrom(response);

  const legacyAuditDb = new DatabaseSync(dbPath);
  legacyAuditDb.prepare(`UPDATE account_operation_logs SET actor_identity_key = 'unknown'
    WHERE action = '登录失败'
      AND actor_user_id = (SELECT id FROM users WHERE username = 'operator')`).run();
  legacyAuditDb.close();

  response = await fetch(`${baseUrl}/api/logs?category=account`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  let logPayload = await response.json();
  let logs = logPayload.logs;
  assert.equal(logPayload.offset, 0);
  assert.equal(logPayload.limit, 50);
  assert.equal(logPayload.total >= logs.length, true);
  assert.equal(logs.every(item => item.category === 'account'), true);
  assert.equal(logs.some(item => item.actorName === '开发者'), true);
  const operatorLoginLog = logs.find(item => item.action === '登录系统' && item.actorName === '操作员'
    && item.deviceFingerprint === 'b'.repeat(64));
  assert(operatorLoginLog);
  assert.equal(operatorLoginLog.ipAddress, '203.0.113.20');
  assert.equal(operatorLoginLog.region, '上海市');
  assert.equal(operatorLoginLog.deviceFingerprint, 'b'.repeat(64));
  assert.equal(operatorLoginLog.deviceName, 'Windows · Test Browser B');
  assert.equal(typeof operatorLoginLog.sessionId, 'string');
  assert.equal(operatorLoginLog.actorIdentityKey, 'director');
  assert.equal(operatorLoginLog.sensitive, false);
  const operatorFailedLoginLog = logs.find(item => item.action === '登录失败'
    && item.details?.account === 'operator' && item.details?.reason === '账号或密码错误');
  assert(operatorFailedLoginLog);
  assert.equal(operatorFailedLoginLog.actorIdentityKey, 'director');
  assert.equal(operatorFailedLoginLog.sensitive, false);
  const missingUserLoginLog = logs.find(item => item.action === '登录失败'
    && item.actorName === '未识别账号：missing-user');
  assert(missingUserLoginLog);
  assert.equal(missingUserLoginLog.actorIdentityKey, 'guest');
  assert.equal(missingUserLoginLog.details.targetIdentityKey, 'guest');
  const missingDeveloperLoginLog = logs.find(item => item.action === '登录失败'
    && item.actorName === '未识别账号：missing-developer');
  assert(missingDeveloperLoginLog);
  assert.equal(missingDeveloperLoginLog.actorIdentityKey, 'administrator');
  assert.equal(missingDeveloperLoginLog.details.targetIdentityKey, 'administrator');
  const developerAccessLog = logs.find(item => item.action === '关闭系统用户登录' && item.actorName === '开发者');
  assert(developerAccessLog);
  assert.equal(developerAccessLog.actorIdentityKey, 'developer');
  assert.equal(developerAccessLog.sensitive, false);
  assert.equal(developerAccessLog.details.revokedSessionCount, 1);
  assert.equal(developerAccessLog.details.revokedUserCount, 1);
  const accountPermissionLog = logs.find(item => item.action === '修改账号权限'
    && item.details?.targetUserId === operator.id);
  assert(accountPermissionLog);
  assert.equal(accountPermissionLog.actorIdentityKey, 'developer');
  assert.equal(accountPermissionLog.sensitive, false);
  const identityPermissionLog = logs.find(item => item.action === '修改身份权限'
    && item.details?.identityKey === 'guest');
  assert(identityPermissionLog);
  assert.equal(identityPermissionLog.sensitive, false);
  const developerIdentitySwitchLog = logs.find(item => item.action === '切换账号身份'
    && item.details?.identityKey === 'director');
  assert(developerIdentitySwitchLog);
  assert.equal(developerIdentitySwitchLog.actorIdentityKey, 'developer');
  assert.equal(developerIdentitySwitchLog.sensitive, false);
  assert.equal(developerIdentitySwitchLog.details.sessionAuthenticated, true);

  response = await fetch(`${baseUrl}/api/logs?category=account&limit=1`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  logPayload = await response.json();
  assert.equal(logPayload.logs.length, 1);
  assert.equal(logPayload.offset, 0);
  assert.equal(logPayload.limit, 1);
  assert.equal(logPayload.hasMore, true);
  assert.equal(logPayload.total > 1, true);
  assert.equal(typeof logPayload.nextCursor, 'string');
  const firstLogCursor = logPayload.nextCursor;

  response = await fetch(`${baseUrl}/api/logs?category=account&limit=1&cursor=${encodeURIComponent(firstLogCursor)}`,
    { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  logPayload = await response.json();
  assert.equal(logPayload.logs.length, 1);
  assert.equal(logPayload.offset, null);
  assert.equal(logPayload.total, null);

  response = await fetch(`${baseUrl}/api/logs?category=account&limit=1&offset=1`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  logPayload = await response.json();
  assert.equal(logPayload.logs.length, 1);
  assert.equal(logPayload.offset, 1);
  assert.equal(logPayload.total > 1, true);

  response = await fetch(`${baseUrl}/api/logs?category=account&q=${'b'.repeat(64)}`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  logPayload = await response.json();
  assert.equal(logPayload.total >= 1, true);
  assert.equal(logPayload.logs.every(item => item.deviceFingerprint === 'b'.repeat(64)), true);

  response = await fetch(`${baseUrl}/api/logs?category=event`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  logs = (await response.json()).logs;
  assert.equal(logs.every(item => item.category === 'event'), true);

  response = await fetch(`${baseUrl}/api/admin/accounts`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  let accounts = (await response.json()).accounts;
  assert.equal(accounts.length, 2);
  const managedOperator = accounts.find(account => account.id === operator.id);
  assert.equal(managedOperator.pendingTitle, '主控操作员');
  assert.equal(managedOperator.presenceStatus, 'online');

  response = await fetch(`${baseUrl}/api/admin/accounts/${encodeURIComponent(operator.id)}/title-review`, {
    method: 'POST',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approved' })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).title, '主控操作员');

  response = await fetch(`${baseUrl}/api/profile`, { headers: { Cookie: operatorCookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).title, '主控操作员');

  response = await fetch(`${baseUrl}/api/admin/accounts`, {
    method: 'POST',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account: 'blocked-region',
      displayName: '地区不可改',
      password: 'remote-test-password',
      identityKey: 'operator',
      region: '华东'
    })
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: '地区由登录 IP 自动识别，任何账号均无权手动修改' });

  response = await fetch(`${baseUrl}/api/admin/accounts`, {
    method: 'POST',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account: 'remote-director',
      displayName: '远程导播',
      password: 'remote-test-password',
      role: 'operator',
      status: 'active',
      title: '跨域协作',
      visibleStats: ['event_count', 'game_count']
    })
  });
  assert.equal(response.status, 201);
  const remoteAccount = await response.json();
  assert.equal(remoteAccount.account, 'remote-director');

  response = await fetch(`${baseUrl}/api/friends/requests`, {
    method: 'POST',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: profile.id })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).outgoing.length, 1);

  response = await fetch(`${baseUrl}/api/friends/${operator.id}/accept`, {
    method: 'POST',
    headers: { Cookie: developerCookie }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).friends.length, 1);

  response = await fetch(`${baseUrl}/api/profiles/${profile.id}`, { headers: { Cookie: operatorCookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).relationship, 'friend');

  response = await fetch(`${baseUrl}/api/admin/accounts/${remoteAccount.id}`, {
    method: 'DELETE',
    headers: { Cookie: developerCookie }
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /data-page-panel="countdown"/);

  response = await fetch(`${baseUrl}/api/hubs/countdown/actions`, {
    method: 'POST',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'set-duration', hours: 125, minutes: 2, seconds: 3 })
  });
  assert.equal(response.status, 200);
  const longCountdown = await response.json();
  assert.equal(longCountdown.durationSeconds, 125 * 3600 + 2 * 60 + 3);
  assert.equal(longCountdown.remainingSeconds, longCountdown.durationSeconds);
  assert.equal(longCountdown.eventLog.actionType, 'set-duration');
  assert.equal(longCountdown.eventLog.actorIdentityKey, 'developer');

  response = await fetch(`${baseUrl}/api/bp/timer-config`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  const timerConfig = await response.json();
  assert.equal(timerConfig.phases.filter(phase => phase.role === 'escape').length, 4);
  assert.equal(timerConfig.phases.filter(phase => phase.role === 'hunter').length, 3);

  response = await fetch(`${baseUrl}/api/hubs/countdown/actions`, {
    method: 'POST',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'reset' })
  });
  assert.equal(response.status, 200);
  const resetCountdown = await response.json();
  assert.equal(resetCountdown.mode, 'duration');
  assert.equal(resetCountdown.durationSeconds, 0);
  assert.equal(resetCountdown.targetAt, null);
  assert.equal(resetCountdown.remainingSeconds, 0);
  assert.equal(resetCountdown.eventLog.actionType, 'reset');

  response = await fetch(`${baseUrl}/api/hubs/countdown/logs?limit=1`, {
    headers: { Cookie: developerCookie }
  });
  assert.equal(response.status, 200);
  const firstCountdownLogPage = await response.json();
  assert.equal(firstCountdownLogPage.logs.length, 1);
  assert.equal(firstCountdownLogPage.logs[0].actionType, 'reset');
  assert.equal(firstCountdownLogPage.hasMore, true);
  assert(firstCountdownLogPage.nextCursor);

  response = await fetch(`${baseUrl}/api/hubs/countdown/logs?limit=1&cursor=${firstCountdownLogPage.nextCursor}`, {
    headers: { Cookie: developerCookie }
  });
  assert.equal(response.status, 200);
  const secondCountdownLogPage = await response.json();
  assert.equal(secondCountdownLogPage.logs.length, 1);
  assert.equal(secondCountdownLogPage.logs[0].actionType, 'set-duration');

  const countdownLogDb = new DatabaseSync(dbPath);
  const persistedCountdownLog = countdownLogDb.prepare(`SELECT action_type, actor_user_id,
    actor_identity_key, before_state_json, after_state_json FROM countdown_event_logs
    WHERE id = ?`).get(resetCountdown.eventLog.id);
  countdownLogDb.close();
  assert.equal(persistedCountdownLog.action_type, 'reset');
  assert(persistedCountdownLog.actor_user_id);
  assert.equal(persistedCountdownLog.actor_identity_key, 'developer');
  assert.equal(JSON.parse(persistedCountdownLog.after_state_json).remainingSeconds, 0);

  response = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ region: '本机网络' })
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: '地区由登录 IP 自动识别，任何账号均无权手动修改' });

  response = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: operatorCookie } });
  assert.equal(response.status, 200);
  assert.match(String(response.headers.get('set-cookie')), /Max-Age=0/);

  response = await fetch(`${baseUrl}/api/admin/accounts`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  accounts = (await response.json()).accounts;
  const operatorRegionBeforeAttempt = accounts.find(account => account.id === operator.id).region;

  response = await fetch(`${baseUrl}/api/admin/accounts/${operator.id}`, {
    method: 'PUT',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ region: '本机网络' })
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: '地区由登录 IP 自动识别，任何账号均无权手动修改' });

  response = await fetch(`${baseUrl}/api/admin/accounts`, { headers: { Cookie: developerCookie } });
  assert.equal(response.status, 200);
  accounts = (await response.json()).accounts;
  assert.equal(accounts.find(account => account.id === operator.id).region, operatorRegionBeforeAttempt);

  response = await fetch(`${baseUrl}/api/admin/accounts/${operator.id}`, {
    method: 'PUT',
    headers: { Cookie: developerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account: 'operator',
      displayName: '操作员',
      role: 'user',
      identityKey: 'director',
      status: 'disabled',
      title: '',
      bio: '',
      gender: 'unspecified',
      birthDate: '',
      visibleStats: ['duty_time', 'account_expiry', 'event_count', 'game_count']
    })
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user', account: 'operator', password: 'release-test-password', remember: false })
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: 'ACCOUNT_DISABLED',
    error: '您的账号已被停用，请联系开发者/管理员进行账号恢复'
  });

  response = await fetch(`${baseUrl}/api/update-log`, { headers: { Cookie: operatorCookie } });
  assert.equal(response.status, 401);
});
