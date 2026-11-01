// 常用设备与安全密码：服务层行为测试 + v37 迁移种子测试。
// 服务级用例跑在 :memory: 库上直调 device-security-service；迁移用例用临时库子进程走完整迁移链。
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

process.env.STELLA_DB_PATH = ':memory:';

const { db } = require('./db');
const deviceSecurity = require('./device-security-service');

function createTestUser(username = 'device-tester', role = 'user') {
  const userId = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO users
    (id, username, display_name, password_hash, salt, role, permissions_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .run(userId, username, username, crypto.scryptSync('password-123456', salt, 64).toString('hex'),
      salt, role, '[]', Date.now(), Date.now());
  return userId;
}

function fingerprint(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex');
}

function addLoginHistory(userId, fp, loggedAt, userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36') {
  db.prepare(`INSERT INTO user_login_history
    (id, user_id, ip_hash, ip_address, region, device_fingerprint, device_name, user_agent, logged_in_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), userId, 'hash', '1.2.3.4', '测试地区', fp, '测试机', userAgent, loggedAt);
}

test('安全密码：三种类型均可设置、验证与解密查看', () => {
  const userId = createTestUser('cred-all-types');
  assert.equal(deviceSecurity.getCredential(db, userId), null);
  assert.equal(deviceSecurity.verifySecurityPassword(db, userId, 'anything'), false);

  deviceSecurity.grantSetupWindow(db, userId);
  deviceSecurity.setCredential(db, userId, { type: 'numeric', secret: '482913', windowMinutes: 60 });
  assert.equal(deviceSecurity.verifySecurityPassword(db, userId, '482913'), true);
  assert.equal(deviceSecurity.verifySecurityPassword(db, userId, '482914'), false);
  const stored = deviceSecurity.getCredential(db, userId);
  assert.equal(stored.type, 'numeric');
  assert.equal(stored.verify_window_minutes, 60);
  assert.equal(deviceSecurity.decryptSecret(db, stored.secret_encrypted), '482913');

  // 挑战窗口过期后重设被拒绝；重新开窗可重置为图案并更换类型
  db.prepare('UPDATE app_settings SET value_json = ? WHERE key = ?')
    .run(JSON.stringify(Date.now() - 6 * 60 * 1000), `security.setupWindow.${userId}`);
  assert.throws(() => deviceSecurity.setCredential(db, userId, { type: 'mixed', secret: 'abc123', windowMinutes: 0 }),
    /账号密码验证/);
  deviceSecurity.grantSetupWindow(db, userId);
  deviceSecurity.setCredential(db, userId, { type: 'pattern', secret: '0-2-4-8'.replace(/-/g, ''), windowMinutes: 0 });
  assert.equal(deviceSecurity.verifySecurityPassword(db, userId, '0248'), true);
  assert.equal(deviceSecurity.verifySecurityPassword(db, userId, '482913'), false);

  deviceSecurity.grantSetupWindow(db, userId);
  deviceSecurity.setCredential(db, userId, { type: 'mixed', secret: 's3cret!pass', windowMinutes: 10080 });
  assert.equal(deviceSecurity.verifySecurityPassword(db, userId, 's3cret!pass'), true);
});

test('安全密码：格式校验与挑战窗口过期', () => {
  const userId = createTestUser('cred-validation');
  assert.throws(() => deviceSecurity.normalizeSecret('numeric', '12'), /4-12/);
  assert.throws(() => deviceSecurity.normalizeSecret('numeric', '12ab'), /4-12/);
  assert.throws(() => deviceSecurity.normalizeSecret('pattern', '0112'), /不重复/);
  assert.throws(() => deviceSecurity.normalizeSecret('pattern', '01289'), /4-9/);
  assert.throws(() => deviceSecurity.normalizeSecret('mixed', 'abc12'), /6-64/);
  assert.throws(() => deviceSecurity.normalizeWindowMinutes(-1), /窗口/);
  assert.throws(() => deviceSecurity.normalizeWindowMinutes(99999999), /窗口/);

  // 挑战窗口存 app_settings 标记：未开窗口时设置被拒，窗口内放行，超时后再拒
  assert.equal(deviceSecurity.setupWindowActive(db, userId), false);
  assert.throws(() => deviceSecurity.setCredential(db, userId, { type: 'numeric', secret: '246810', windowMinutes: 60 }),
    /账号密码验证/);
  deviceSecurity.grantSetupWindow(db, userId);
  assert.equal(deviceSecurity.setupWindowActive(db, userId), true);
  db.prepare('UPDATE app_settings SET value_json = ? WHERE key = ?')
    .run(JSON.stringify(Date.now() - 6 * 60 * 1000), `security.setupWindow.${userId}`);
  assert.equal(deviceSecurity.setupWindowActive(db, userId), false);
  assert.throws(() => deviceSecurity.setCredential(db, userId, { type: 'numeric', secret: '246810', windowMinutes: 60 }),
    /账号密码验证/);
});

test('自动登录：单设备互踢、过期与停用账号拒绝', () => {
  const userId = createTestUser('auto-login-user');
  const fpA = fingerprint('device-a');
  const fpB = fingerprint('device-b');
  deviceSecurity.upsertDevice(db, userId, { deviceFingerprint: fpA, deviceName: 'A 机', userAgent: 'UA-A', ipAddress: '1.1.1.1', region: 'r' });
  deviceSecurity.upsertDevice(db, userId, { deviceFingerprint: fpB, deviceName: 'B 机', userAgent: 'UA-B', ipAddress: '2.2.2.2', region: 'r' });
  const deviceA = db.prepare('SELECT * FROM user_devices WHERE device_fingerprint = ?').get(fpA);
  const deviceB = db.prepare('SELECT * FROM user_devices WHERE device_fingerprint = ?').get(fpB);

  const tokenA = deviceSecurity.enableAutoLogin(db, userId, deviceA.id);
  assert.match(tokenA.token, /^[a-f0-9]{64}$/);
  assert.equal(deviceSecurity.findAutoLoginDevice(db, tokenA.token).id, deviceA.id);

  // B 机开启后 A 机状态被踢掉
  const tokenB = deviceSecurity.enableAutoLogin(db, userId, deviceB.id);
  assert.equal(deviceSecurity.findAutoLoginDevice(db, tokenA.token), null);
  const kickedA = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(deviceA.id);
  assert.equal(kickedA.auto_login_enabled, 0);
  assert.equal(kickedA.auto_login_token_hash, null);
  assert.equal(deviceSecurity.findAutoLoginDevice(db, tokenB.token).id, deviceB.id);

  // 滑动续期
  const before = deviceB.auto_login_expires_at;
  deviceSecurity.renewAutoLogin(db, deviceB.id);
  const renewed = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(deviceB.id);
  assert.ok(renewed.auto_login_expires_at > before);

  // 过期与停用账号
  db.prepare('UPDATE user_devices SET auto_login_expires_at = ? WHERE id = ?')
    .run(Date.now() - 1000, deviceB.id);
  assert.equal(deviceSecurity.findAutoLoginDevice(db, tokenB.token), null);
  db.prepare('UPDATE user_devices SET auto_login_expires_at = ? WHERE id = ?')
    .run(Date.now() + 60 * 1000, deviceB.id);
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run('disabled', userId);
  assert.equal(deviceSecurity.findAutoLoginDevice(db, tokenB.token), null);

  // 关闭后 token 立即失效
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run('active', userId);
  deviceSecurity.disableAutoLogin(db, userId, deviceB.id);
  assert.equal(deviceSecurity.findAutoLoginDevice(db, tokenB.token), null);
});

test('租约：永久/限时/撤销与指纹校验', () => {
  const userId = createTestUser('lease-user');
  const fpA = fingerprint('lease-device-a');
  const fpB = fingerprint('lease-device-b');
  deviceSecurity.upsertDevice(db, userId, { deviceFingerprint: fpA, deviceName: '租约机', userAgent: 'UA', ipAddress: '3.3.3.3', region: 'r' });
  deviceSecurity.upsertDevice(db, userId, { deviceFingerprint: fpB, deviceName: '无租约机', userAgent: 'UA', ipAddress: '4.4.4.4', region: 'r' });
  const deviceA = db.prepare('SELECT * FROM user_devices WHERE device_fingerprint = ?').get(fpA);

  assert.equal(deviceSecurity.findLeaseDevice(db, userId, fpA), null, '未授租约时不可租约登录');

  deviceSecurity.setLease(db, userId, deviceA.id, 'permanent');
  const permanent = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(deviceA.id);
  assert.equal(permanent.lease_until, deviceSecurity.PERMANENT_LEASE_AT);
  assert.equal(deviceSecurity.findLeaseDevice(db, userId, fpA).id, deviceA.id);

  deviceSecurity.setLease(db, userId, deviceA.id, Date.now() + 60 * 1000);
  assert.equal(deviceSecurity.findLeaseDevice(db, userId, fpA).id, deviceA.id);
  db.prepare('UPDATE user_devices SET lease_until = ? WHERE id = ?').run(Date.now() - 1000, deviceA.id);
  assert.equal(deviceSecurity.findLeaseDevice(db, userId, fpA), null, '过期租约不可用');

  deviceSecurity.setLease(db, userId, deviceA.id, Date.now() + 60 * 1000);
  assert.equal(deviceSecurity.findLeaseDevice(db, userId, fpB), null, '指纹不匹配不可租约登录');
  assert.equal(deviceSecurity.findLeaseDevice(db, 'other-user', fpA), null, '账号不匹配不可租约登录');
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run('disabled', userId);
  assert.equal(deviceSecurity.findLeaseDevice(db, userId, fpA), null, '停用账号不可租约登录');

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run('active', userId);
  deviceSecurity.setLease(db, userId, deviceA.id, null);
  assert.equal(deviceSecurity.findLeaseDevice(db, userId, fpA), null, '撤销租约立即生效');
  assert.throws(() => deviceSecurity.setLease(db, userId, deviceA.id, Date.now() - 1000), /租约时间无效/);
});

test('设备登记：upsert 刷新而不重复，UA 解析分类正确', () => {
  const userId = createTestUser('upsert-user');
  const fp = fingerprint('upsert-device');
  const first = deviceSecurity.upsertDevice(db, userId, {
    deviceFingerprint: fp, deviceName: '旧名', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1',
    ipAddress: '5.5.5.5', region: '旧地区'
  });
  const second = deviceSecurity.upsertDevice(db, userId, {
    deviceFingerprint: fp, deviceName: '新名', userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
    ipAddress: '6.6.6.6', region: '新地区'
  });
  assert.equal(first.id, second.id);
  const rows = db.prepare('SELECT COUNT(*) AS n FROM user_devices WHERE user_id = ?').get(userId).n;
  assert.equal(rows, 1);
  assert.equal(second.device_name, '新名');
  assert.equal(second.device_type, 'mobile');
  assert.equal(second.device_os, 'Android');
  assert.equal(second.device_model, 'Pixel 7');
  assert.equal(second.browser, 'Chrome');
  assert.equal(second.last_ip, '6.6.6.6');

  const desktop = deviceSecurity.parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36');
  assert.deepEqual([desktop.deviceType, desktop.deviceOs], ['desktop', 'Windows']);
  const pad = deviceSecurity.parseUserAgent('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1');
  assert.deepEqual([pad.deviceType, pad.deviceOs, pad.deviceModel], ['tablet', 'iPadOS', 'iPad']);
  const androidTablet = deviceSecurity.parseUserAgent('Mozilla/5.0 (Linux; Android 12; SM-X200) AppleWebKit/537.36 Chrome/110.0 Safari/537.36');
  assert.equal(androidTablet.deviceType, 'tablet');
});

test('外显视图：敏感字段仅开发者视角可见，凭据默认掩蔽', () => {
  const userId = createTestUser('view-user');
  const fp = fingerprint('view-device');
  deviceSecurity.upsertDevice(db, userId, {
    deviceFingerprint: fp, deviceName: '视图机', userAgent: 'UA', ipAddress: '7.7.7.7', region: '归属地', networkEnv: 'wan-4g'
  });
  const row = db.prepare('SELECT * FROM user_devices WHERE device_fingerprint = ?').get(fp);

  const plain = deviceSecurity.deviceView(row, { includeSensitive: false });
  assert.equal(plain.fingerprint, undefined);
  assert.equal(plain.lastIp, undefined);
  assert.equal(plain.lastRegion, undefined);
  assert.equal(plain.networkEnv, undefined);
  const full = deviceSecurity.deviceView(row, { includeSensitive: true, currentFingerprint: fp });
  assert.equal(full.fingerprint, fp);
  assert.equal(full.lastIp, '7.7.7.7');
  assert.equal(full.lastRegion, '归属地');
  assert.equal(full.networkEnv, 'wan-4g');
  assert.equal(full.isCurrentDevice, true);

  deviceSecurity.grantSetupWindow(db, userId);
  deviceSecurity.setCredential(db, userId, { type: 'numeric', secret: '135790', windowMinutes: 60 });
  const masked = deviceSecurity.credentialView(deviceSecurity.getCredential(db, userId));
  assert.equal(masked.configured, true);
  assert.equal(masked.secret, undefined);
  const revealed = deviceSecurity.credentialView(deviceSecurity.getCredential(db, userId), { includeSecret: true, database: db });
  assert.equal(revealed.secret, '135790');
  const tampered = deviceSecurity.credentialView(
    { ...deviceSecurity.getCredential(db, userId), secret_encrypted: '00'.repeat(40) },
    { includeSecret: true, database: db }
  );
  assert.equal(tampered.secret, null);
  assert.equal(tampered.decryptFailed, true);
});

test('删除设备移除行；加密密钥复用同一把', () => {
  const userId = createTestUser('delete-user');
  const fp = fingerprint('delete-device');
  deviceSecurity.upsertDevice(db, userId, { deviceFingerprint: fp, deviceName: '待删机', userAgent: 'UA', ipAddress: '8.8.8.8', region: 'r' });
  const device = db.prepare('SELECT * FROM user_devices WHERE device_fingerprint = ?').get(fp);
  deviceSecurity.deleteDevice(db, userId, device.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_devices WHERE id = ?').get(device.id).n, 0);

  const cipherA = deviceSecurity.encryptSecret(db, 'same-secret');
  const cipherB = deviceSecurity.encryptSecret(db, 'same-secret');
  assert.equal(deviceSecurity.decryptSecret(db, cipherA), 'same-secret');
  assert.equal(deviceSecurity.decryptSecret(db, cipherB), 'same-secret');
  assert.notEqual(cipherA, cipherB, '每次加密使用新 iv');
});

test('v37+v38 迁移：登录历史回填设备、unknown 指纹忽略、同系统多行归并', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-device-migration-'));
  const dbPath = path.join(directory, 'legacy.db');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      permissions_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      expires_at INTEGER,
      last_login_at INTEGER,
      last_login_ip_hash TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE user_login_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      ip_address TEXT NOT NULL DEFAULT 'unknown',
      region TEXT NOT NULL,
      device_fingerprint TEXT NOT NULL DEFAULT 'unknown',
      device_name TEXT NOT NULL DEFAULT '未知设备',
      user_agent TEXT NOT NULL DEFAULT '',
      logged_in_at INTEGER NOT NULL
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
  `);
  const seedUser = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  legacy.prepare(`INSERT INTO users (id, username, display_name, password_hash, salt, role, permissions_json, status, created_at, updated_at)
    VALUES (?, 'legacy-user', '老用户', ?, ?, 'user', '[]', 'active', ?, ?)`)
    .run(seedUser, crypto.scryptSync('legacy-password', salt, 64).toString('hex'), salt, Date.now(), Date.now());
  const fpPhone = fingerprint('legacy-phone');
  const fpDesktop = fingerprint('legacy-desktop');
  const fpDesktop2 = fingerprint('legacy-desktop-2');
  const fpDesktop3 = fingerprint('legacy-desktop-3');
  addLegacyHistory(legacy, seedUser, fpPhone, 1000, 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Mobile Safari');
  addLegacyHistory(legacy, seedUser, fpPhone, 2000, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari');
  addLegacyHistory(legacy, seedUser, fpDesktop, 1500, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36');
  addLegacyHistory(legacy, seedUser, fpDesktop2, 2500, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/132.0 Safari/537.36');
  addLegacyHistory(legacy, seedUser, fpDesktop3, 400, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/110.0 Safari/537.36');
  addLegacyHistory(legacy, seedUser, 'unknown', 3000, 'Mozilla/5.0 (compatible)');
  legacy.exec('PRAGMA user_version = 36');
  legacy.close();

  const result = spawnSync(process.execPath, ['-e', "require('./server/db').db.close()"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, STELLA_DB_PATH: dbPath, STELLA_DATA_DIR: directory },
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const migrated = new DatabaseSync(dbPath);
  try {
    assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 39);
    assert.equal(migrated.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'user_devices'").get().n, 1);
    assert.equal(migrated.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'user_security_credentials'").get().n, 1);
    const devices = migrated.prepare('SELECT * FROM user_devices ORDER BY device_fingerprint').all();
    // 3 条 Windows 历史指纹在 v38 归并为一行，iOS 一行独立，unknown 不入表
    assert.equal(devices.length, 2, '同系统历史设备归并、unknown 指纹不入表');
    const phone = devices.find(row => row.device_fingerprint === fpPhone);
    assert.ok(phone, '手机设备已登记');
    assert.equal(phone.device_type, 'mobile');
    assert.equal(phone.last_login_at, 2000, '同指纹取最近一次登录时间');
    const desktop = devices.find(row => row.device_os === 'Windows');
    assert.ok(desktop, '桌面设备已登记');
    assert.equal(desktop.device_fingerprint, fpDesktop2, '归并存活行取最近登录的指纹');
    assert.equal(desktop.last_login_at, 2500, '归并后最近登录取最大值');
    assert.equal(migrated.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_user_devices_user_fp'").get().n, 1, '指纹索引仍存在');
  } finally {
    migrated.close();
  }

  function addLegacyHistory(database, userId, fp, at, userAgent) {
    database.prepare(`INSERT INTO user_login_history
      (id, user_id, ip_hash, ip_address, region, device_fingerprint, device_name, user_agent, logged_in_at)
      VALUES (?, ?, 'hash', '9.9.9.9', '种子地区', ?, '种子机', ?, ?)`)
      .run(crypto.randomUUID(), userId, fp, userAgent, at);
  }
});

test('v38 迁移：归并保留自动登录与租约状态', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-device-merge-'));
  const dbPath = path.join(directory, 'legacy.db');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      permissions_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      expires_at INTEGER,
      last_login_at INTEGER,
      last_login_ip_hash TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE TABLE user_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_fingerprint TEXT NOT NULL,
      device_name TEXT NOT NULL DEFAULT '',
      device_type TEXT NOT NULL DEFAULT 'desktop',
      device_os TEXT NOT NULL DEFAULT '',
      device_model TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      network_env TEXT NOT NULL DEFAULT '',
      last_ip TEXT NOT NULL DEFAULT '',
      last_region TEXT NOT NULL DEFAULT '',
      last_login_at INTEGER NOT NULL DEFAULT 0,
      auto_login_enabled INTEGER NOT NULL DEFAULT 0,
      auto_login_token_hash TEXT,
      auto_login_expires_at INTEGER,
      lease_until INTEGER,
      lease_granted_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  const seedUser = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  legacy.prepare(`INSERT INTO users (id, username, display_name, password_hash, salt, role, permissions_json, status, created_at, updated_at)
    VALUES (?, 'merge-user', '归并用户', ?, ?, 'user', '[]', 'active', ?, ?)`)
    .run(seedUser, crypto.scryptSync('merge-password', salt, 64).toString('hex'), salt, Date.now(), Date.now());
  const insertDevice = legacy.prepare(`INSERT INTO user_devices
    (id, user_id, device_fingerprint, device_name, device_os, device_type, last_ip, last_region,
     last_login_at, auto_login_enabled, auto_login_token_hash, auto_login_expires_at,
     lease_until, lease_granted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Windows', 'desktop', '1.1.1.1', 'r', ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertDevice.run(crypto.randomUUID(), seedUser, fingerprint('m-a'), '自动登录机', 500, 1, 'token-hash', Date.now() + 86400000, null, null, 100, 500);
  insertDevice.run(crypto.randomUUID(), seedUser, fingerprint('m-b'), '租约机', 300, 0, null, null, deviceSecurity.PERMANENT_LEASE_AT, 200, 200, 300);
  insertDevice.run(crypto.randomUUID(), seedUser, fingerprint('m-c'), '最近机器', 900, 0, null, null, null, null, 300, 900);
  legacy.exec('PRAGMA user_version = 37');
  legacy.close();

  const result = spawnSync(process.execPath, ['-e', "require('./server/db').db.close()"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, STELLA_DB_PATH: dbPath, STELLA_DATA_DIR: directory },
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const migrated = new DatabaseSync(dbPath);
  try {
    assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 39);
    const devices = migrated.prepare('SELECT * FROM user_devices').all();
    assert.equal(devices.length, 1, '同系统三行归并为一行');
    const survivor = devices[0];
    assert.equal(survivor.auto_login_enabled, 1, '自动登录状态优先保留');
    assert.equal(survivor.auto_login_token_hash, 'token-hash');
    assert.equal(survivor.lease_until, deviceSecurity.PERMANENT_LEASE_AT, '租约取最大（永久胜出）');
    assert.equal(survivor.created_at, 100, '创建时间取最早');
    assert.equal(survivor.last_login_at, 900, '最近登录取最新');
    assert.equal(survivor.device_name, '最近机器', '档案快照取最近登录行');
  } finally {
    migrated.close();
  }
});

test('指纹 v2：GPU 归一跨浏览器一致、服务端重算确定、大版本外显', () => {
  const edgeTraits = deviceSecurity.normalizeTraits({
    platform: 'Win32',
    gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    cores: 16, memory: 8, language: 'zh-CN', timezone: 'Asia/Shanghai',
    brand: 'Microsoft Edge', hostname: 'STUDIO-01'
  });
  const firefoxTraits = deviceSecurity.normalizeTraits({
    platform: 'Win32',
    gpu: 'NVIDIA GeForce RTX 3060/PCIe/SSE2',
    cores: '16', memory: '8', language: 'zh-CN', timezone: 'Asia/Shanghai',
    brand: 'Mozilla Firefox'
  });
  assert.equal(edgeTraits.gpu, 'NVIDIA GeForce RTX 3060', 'ANGLE 包装剥离');
  assert.equal(firefoxTraits.gpu, 'NVIDIA GeForce RTX 3060', 'PCIe 尾巴剥离');
  assert.equal(deviceSecurity.computeMachineFingerprint(edgeTraits),
    deviceSecurity.computeMachineFingerprint(firefoxTraits), '同机不同浏览器同指纹');
  assert.notEqual(deviceSecurity.computeMachineFingerprint(edgeTraits),
    deviceSecurity.computeMachineFingerprint({ ...edgeTraits, cores: 8 }), '核数变化换指纹');
  assert.equal(deviceSecurity.normalizeTraits(null), null);
  assert.equal(deviceSecurity.normalizeTraits({}), null, '全空特征无效');
  const ua = deviceSecurity.parseUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0');
  assert.deepEqual([ua.browser, ua.browserVersion], ['Edge', '132']);
  const safari = deviceSecurity.parseUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  assert.deepEqual([safari.browser, safari.browserVersion], ['Safari', '17']);
});

test('upsert 身份链：密钥优先、hostname 认回轮换、指纹收编、同指纹异名新建', () => {
  const userId = createTestUser('identity-chain');
  const traits = { platform: 'Win32', gpu: 'NVIDIA GeForce RTX 3060', cores: 16, memory: 8, language: 'zh-CN', timezone: 'Asia/Shanghai' };
  const fp = deviceSecurity.computeMachineFingerprint(deviceSecurity.normalizeTraits(traits));
  const keyHashOf = value => deviceSecurity.hashDeviceKey(value);
  const rowCount = () => db.prepare('SELECT COUNT(*) AS n FROM user_devices WHERE user_id = ?').get(userId).n;

  // 新建：锚定客户端密钥，电脑名成为设备名
  const first = deviceSecurity.upsertDevice(db, userId, {
    deviceId: 'key-A', deviceFingerprint: fp,
    deviceTraits: { ...traits, brand: 'Microsoft Edge', hostname: 'STUDIO-01' },
    hostname: 'STUDIO-01', deviceName: 'Win32 · Edge',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Edg/120.0', ipAddress: '1.1.1.1', region: 'r'
  });
  assert.equal(first.device_key_hash, keyHashOf('key-A'), '新建锚定终端密钥');
  assert.equal(first.hostname, 'STUDIO-01');
  assert.equal(first.device_name, 'STUDIO-01', '电脑名优先作为设备名');
  assert.equal(first.device_fingerprint, fp);

  // 密钥命中：UA/浏览器版本升级仍是同一行
  const second = deviceSecurity.upsertDevice(db, userId, {
    deviceId: 'key-A', deviceFingerprint: fp,
    deviceTraits: { ...traits, brand: 'Microsoft Edge', hostname: 'STUDIO-01' },
    hostname: 'STUDIO-01', deviceName: 'Win32 · Edge',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/132.0 Edg/132.0', ipAddress: '1.1.1.1', region: 'r'
  });
  assert.equal(second.id, first.id, '终端密钥优先命中');
  assert.equal(second.user_agent, 'Mozilla/5.0 (Windows NT 10.0) Chrome/132.0 Edg/132.0');
  assert.equal(rowCount(), 1);

  // 新浏览器档案（新密钥）经电脑名认回同一行并轮换密钥
  const third = deviceSecurity.upsertDevice(db, userId, {
    deviceId: 'key-B', deviceFingerprint: fp,
    deviceTraits: { ...traits, brand: 'Google Chrome', hostname: 'STUDIO-01' },
    hostname: 'STUDIO-01', deviceName: 'Win32 · Chrome',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/132.0', ipAddress: '1.1.1.1', region: 'r'
  });
  assert.equal(third.id, first.id, '同机跨浏览器经电脑名归并');
  assert.equal(third.device_key_hash, keyHashOf('key-B'), 'hostname 路径轮换密钥');
  assert.equal(rowCount(), 1);

  // 密钥与电脑名都缺失（清数据 + 解析失败）：指纹收编，不轮换已有密钥
  const fourth = deviceSecurity.upsertDevice(db, userId, {
    deviceFingerprint: fp,
    deviceTraits: { ...traits, brand: 'Microsoft Edge', hostname: 'STUDIO-01' },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Edg/120.0', ipAddress: '1.1.1.1', region: 'r'
  });
  assert.equal(fourth.id, first.id, '指纹收编');
  assert.equal(fourth.device_key_hash, keyHashOf('key-B'), '弱路径不轮换密钥');

  // 指纹相同但电脑名不同 = 同配置的另一台机器，新建消歧
  const other = deviceSecurity.upsertDevice(db, userId, {
    deviceId: 'key-C', deviceFingerprint: fp,
    deviceTraits: { ...traits, brand: 'Microsoft Edge', hostname: 'STUDIO-02' },
    hostname: 'STUDIO-02', deviceName: 'Win32 · Edge',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Edg/120.0', ipAddress: '2.2.2.2', region: 'r'
  });
  assert.notEqual(other.id, first.id, '同配置双机按电脑名消歧');
  assert.equal(other.device_key_hash, keyHashOf('key-C'));
  assert.equal(rowCount(), 2);

  // 同机换显卡：电脑名认回 + 指纹更新
  const upgraded = deviceSecurity.upsertDevice(db, userId, {
    deviceId: 'key-C', deviceFingerprint: 'stale'.padEnd(64, '0'),
    deviceTraits: { ...traits, gpu: 'NVIDIA GeForce RTX 5090', brand: 'Microsoft Edge', hostname: 'STUDIO-02' },
    hostname: 'STUDIO-02', deviceName: 'Win32 · Edge',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Edg/120.0', ipAddress: '2.2.2.2', region: 'r'
  });
  assert.equal(upgraded.id, other.id, '换硬件经电脑名认回');
  assert.equal(upgraded.device_fingerprint,
    deviceSecurity.computeMachineFingerprint(deviceSecurity.normalizeTraits({ ...traits, gpu: 'NVIDIA GeForce RTX 5090' })));
});

test('upsert GPU 采集漂移恢复与旧版收编', () => {
  const userId = createTestUser('gpu-drift');
  const traits = { platform: 'Win32', cores: 16, memory: 8, language: 'zh-CN', timezone: 'Asia/Shanghai' };
  // 首次 WebGL 采集失败（gpu 空）
  const first = deviceSecurity.upsertDevice(db, userId, {
    deviceId: 'key-E',
    deviceFingerprint: deviceSecurity.computeMachineFingerprint(deviceSecurity.normalizeTraits(traits)),
    deviceTraits: { ...traits, gpu: '', brand: 'Google Chrome', hostname: '' },
    deviceName: 'Win32 · Chrome',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0', ipAddress: '5.5.5.5', region: 'r'
  });
  assert.ok(first.device_fingerprint);
  // WebGL 恢复后：特征模糊匹配收编（gpu 一方为空允许）
  const second = deviceSecurity.upsertDevice(db, userId, {
    deviceId: 'key-E',
    deviceTraits: { ...traits, gpu: 'NVIDIA GeForce RTX 3060', brand: 'Google Chrome', hostname: '' },
    deviceName: 'Win32 · Chrome',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0', ipAddress: '5.5.5.5', region: 'r'
  });
  assert.equal(second.id, first.id, 'GPU 采集漂移经特征收编');
  assert.equal(second.device_fingerprint,
    deviceSecurity.computeMachineFingerprint(deviceSecurity.normalizeTraits({ ...traits, gpu: 'NVIDIA GeForce RTX 3060' })));

  // 旧版收编：无特征历史行按系统认回并锚定密钥
  const legacyUserId = createTestUser('legacy-adopt');
  db.prepare(`INSERT INTO user_devices
    (id, user_id, device_fingerprint, device_name, device_os, device_type, last_login_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), legacyUserId, 'f'.repeat(64), '旧机器', 'Windows', 'desktop', 1000, 1000, 1000);
  const adopted = deviceSecurity.upsertDevice(db, legacyUserId, {
    deviceId: 'key-D', deviceFingerprint: 'e'.repeat(64),
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36',
    ipAddress: '3.3.3.3', region: 'r'
  });
  assert.equal(adopted.device_name, '旧机器', '无 hostname 无上报名时保留旧名');
  assert.equal(adopted.device_key_hash, deviceSecurity.hashDeviceKey('key-D'), '收编时锚定密钥');
  assert.equal(adopted.traits_json, '');
  // 杂行（空系统名）不互相吞并
  const junk = deviceSecurity.upsertDevice(db, legacyUserId, {
    deviceFingerprint: 'd'.repeat(64), userAgent: '', ipAddress: '4.4.4.4', region: 'r'
  });
  assert.notEqual(junk.device_fingerprint, 'e'.repeat(64), '空系统名不参与收编');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_devices WHERE user_id = ?').get(legacyUserId).n, 2);
});

test('findLeaseDevice 电脑名消歧与 deviceView 敏感字段扩展', () => {
  const userId = createTestUser('lease-disambiguate');
  const traits = { platform: 'Win32', gpu: 'NVIDIA GeForce RTX 3060', cores: 16, memory: 8, language: 'zh-CN', timezone: 'Asia/Shanghai' };
  const fp = deviceSecurity.computeMachineFingerprint(deviceSecurity.normalizeTraits(traits));
  const rowA = deviceSecurity.upsertDevice(db, userId, {
    deviceId: 'key-A', deviceTraits: { ...traits, brand: 'Edge', hostname: 'STUDIO-01' },
    hostname: 'STUDIO-01', userAgent: 'UA', ipAddress: '1.1.1.1', region: 'r'
  });
  const rowB = deviceSecurity.upsertDevice(db, userId, {
    deviceId: 'key-B', deviceTraits: { ...traits, brand: 'Edge', hostname: 'STUDIO-02' },
    hostname: 'STUDIO-02', userAgent: 'UA', ipAddress: '2.2.2.2', region: 'r'
  });
  assert.notEqual(rowA.id, rowB.id, '同配置双机两行');
  deviceSecurity.setLease(db, userId, rowA.id, 'permanent');
  // 指纹相同（同配置），电脑名消歧：STUDIO-02 的请求拿不到 STUDIO-01 的租约
  assert.equal(deviceSecurity.findLeaseDevice(db, userId, fp, 'STUDIO-02'), null, '电脑名消歧拒绝');
  assert.equal(deviceSecurity.findLeaseDevice(db, userId, fp, 'STUDIO-01').id, rowA.id, '电脑名命中租约');
  assert.equal(deviceSecurity.findLeaseDevice(db, userId, fp, '').id, rowA.id, '解析失败退回指纹匹配');

  const fullView = deviceSecurity.deviceView(deviceSecurity.getDevice(db, userId, rowA.id), { includeSensitive: true });
  assert.equal(fullView.hostname, 'STUDIO-01');
  assert.equal(fullView.gpu, 'NVIDIA GeForce RTX 3060');
  const plainView = deviceSecurity.deviceView(deviceSecurity.getDevice(db, userId, rowA.id));
  assert.equal(plainView.hostname, undefined, '非开发者视角不含电脑名');
  assert.equal(plainView.gpu, undefined, '非开发者视角不含 GPU');
  assert.equal(plainView.browserVersion !== undefined, true, '浏览器版本所有视角可见');
});
