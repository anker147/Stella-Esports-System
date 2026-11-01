// 常用设备与安全密码：凭据加解密、设备登记、自动登录单设备状态、设备租约。
// 本模块只做库内数据与纯计算；会话解锁态（devicesAuthAt / pagesUnlockedAt）由 server.js 持有，
// 避免与 server.js 相互 require。所有函数首参收 database，测试可用 :memory: 库直调。
const crypto = require('node:crypto');

const CREDENTIAL_TYPES = new Set(['numeric', 'pattern', 'mixed']);
const AUTO_LOGIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SETUP_WINDOW_MS = 5 * 60 * 1000;
// 租约"永久"的哨兵时间戳（2100-01-01），避免与真实到期时间混淆
const PERMANENT_LEASE_AT = 4102444800000;
const MAX_WINDOW_MINUTES = 43200;
// 租约登录后受限的敏感页（页面 id 与 control.html 的 data-page-panel 对应）
const SENSITIVE_PAGES = ['friends', 'addFriend', 'channels', 'bp', 'countdown', 'bracket', 'materials'];
// 租约未解锁时禁止访问的 API 前缀（与 SENSITIVE_PAGES 背后的数据接口对应；/api/admin 本有权限门，双保险）
const SENSITIVE_API_PREFIXES = [
  '/api/friends', '/api/users/search', '/api/communications', '/api/bp/',
  '/api/hubs', '/api/obs', '/api/materials', '/api/material-paths',
  '/api/bracket-image', '/api/admin'
];

function securityKey(database) {
  const row = database.prepare("SELECT value_json FROM app_settings WHERE key = 'security.credentialKey'").get();
  if (row) {
    try {
      const value = JSON.parse(row.value_json);
      if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) return Buffer.from(value, 'hex');
    } catch { /* 落到重新生成 */ }
  }
  const key = crypto.randomBytes(32);
  database.prepare(`INSERT INTO app_settings (key, value_json) VALUES ('security.credentialKey', ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`)
    .run(JSON.stringify(key.toString('hex')));
  return key;
}

// AES-256-GCM：iv(12B) + authTag(16B) + 密文，整体拼 hex 存 secret_encrypted
function encryptSecret(database, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', securityKey(database), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('hex');
}

function decryptSecret(database, payload) {
  const raw = Buffer.from(String(payload || ''), 'hex');
  if (raw.length <= 28) throw new Error('安全密码密文无效');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', securityKey(database), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function scryptHash(secret, salt) {
  return crypto.scryptSync(String(secret || ''), salt, 64).toString('hex');
}

function safeEqualHex(left, right) {
  try {
    const a = Buffer.from(String(left || ''), 'hex');
    const b = Buffer.from(String(right || ''), 'hex');
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// GPU 渲染器字符串归一化：剥 ANGLE 包装、优先取含显卡型号关键词的分段（其次厂商名分段）、
// 去掉图形后端后缀与 PCIe 尾巴。目标：同一块显卡在 Chrome / Edge / Firefox 下得到同一串。
function normalizeGpuRenderer(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  value = value.replace(/^ANGLE\s*\((.*)\)$/i, '$1');
  const segments = value.split(',').map(segment => segment.trim());
  const picked = segments.find(segment =>
    /geforce|radeon|\barc\b|iris|uhd|hd graphics|adreno|mali|apple gpu|quadro/i.test(segment))
    || segments.find(segment => /nvidia|amd|intel/i.test(segment))
    || value;
  return picked
    .replace(/\s*(?:Direct3D\d*|D3D\d+|OpenGL|Metal|Vulkan|WebGL)\b.*$/i, '')
    .replace(/\/.*$/, '')
    .trim()
    .slice(0, 80);
}

// 终端特征快照校验：只保留机器级字段（不含浏览器品牌与版本——版本 4 周一漂移，仅作档案外显）。
// 字段全部缺失视为无效（旧客户端未上报），返回 null。
function normalizeTraits(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const text = (value, max) => String(value ?? '').trim().slice(0, max);
  const traits = {
    platform: text(raw.platform, 40),
    gpu: normalizeGpuRenderer(raw.gpu),
    cores: Math.max(0, Math.min(4096, Math.floor(Number(raw.cores)) || 0)),
    memory: Math.max(0, Math.min(256, Math.floor(Number(raw.memory)) || 0)),
    language: text(raw.language, 35),
    timezone: text(raw.timezone, 64),
    brand: text(raw.brand, 40),
    hostname: text(raw.hostname, 64)
  };
  if (!traits.platform && !traits.gpu) return null;
  return traits;
}

// 机器指纹 v2：只哈希机器级特征。deviceId（终端密钥）与 hostname（解析可能失败）不参与哈希，
// 由 upsertDevice 的分级匹配单独处理。服务端重算是权威值，防客户端哈希漂移。
function computeMachineFingerprint(traits) {
  const source = ['v2', traits.platform, traits.gpu, traits.cores, traits.memory,
    traits.language, traits.timezone].join('|');
  return crypto.createHash('sha256').update(source).digest('hex');
}

function hashDeviceKey(deviceId) {
  const value = String(deviceId || '').trim().slice(0, 128);
  if (!value) return null;
  return crypto.createHash('sha256').update(value).digest('hex');
}

// 纯数字 4-12 位；图案为 3×3 网格（0-8）去重路径 4-9 节点；混合为任意可见字符 6-64 位
function normalizeSecret(type, secret) {
  const value = String(secret ?? '').trim();
  if (type === 'numeric') {
    if (!/^\d{4,12}$/.test(value)) throw new Error('数字安全密码需要 4-12 位数字');
    return value;
  }
  if (type === 'pattern') {
    if (!/^[0-8]{4,9}$/.test(value) || new Set(value).size !== value.length) {
      throw new Error('图案安全密码需要 4-9 个不重复的节点路径');
    }
    return value;
  }
  if (value.length < 6 || value.length > 64) throw new Error('混合安全密码需要 6-64 个字符');
  return value;
}

function normalizeWindowMinutes(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_WINDOW_MINUTES) {
    throw new Error('重新认证窗口无效');
  }
  return minutes;
}

function getCredential(database, userId) {
  return database.prepare('SELECT * FROM user_security_credentials WHERE user_id = ?').get(userId) || null;
}

// 账号密码挑战通过后调用：打开 5 分钟的设置/重置窗口。
// 窗口存 app_settings 标记（首次设置时凭据行还不存在，列放不下）。
function setupWindowKey(userId) {
  return `security.setupWindow.${userId}`;
}

function grantSetupWindow(database, userId) {
  database.prepare(`INSERT INTO app_settings (key, value_json) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`)
    .run(setupWindowKey(userId), JSON.stringify(Date.now()));
}

function setupWindowActive(database, userId) {
  const row = database.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(setupWindowKey(userId));
  if (!row) return false;
  try {
    const grantedAt = Number(JSON.parse(row.value_json));
    return Number.isFinite(grantedAt) && Date.now() - grantedAt <= SETUP_WINDOW_MS;
  } catch {
    return false;
  }
}

function setCredential(database, userId, { type, secret, windowMinutes }) {
  if (!CREDENTIAL_TYPES.has(type)) throw new Error('安全密码类型无效');
  const normalized = normalizeSecret(type, secret);
  const minutes = normalizeWindowMinutes(windowMinutes);
  if (!setupWindowActive(database, userId)) throw new Error('需要先通过账号密码验证才能设置安全密码');
  const salt = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  database.prepare(`INSERT INTO user_security_credentials
    (user_id, type, secret_encrypted, secret_hash, secret_salt, verify_window_minutes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      type = excluded.type, secret_encrypted = excluded.secret_encrypted,
      secret_hash = excluded.secret_hash, secret_salt = excluded.secret_salt,
      verify_window_minutes = excluded.verify_window_minutes, updated_at = excluded.updated_at`)
    .run(userId, type, encryptSecret(database, normalized), scryptHash(normalized, salt), salt, minutes, now);
  return getCredential(database, userId);
}

function verifySecurityPassword(database, userId, secret) {
  const row = getCredential(database, userId);
  if (!row) return false;
  return safeEqualHex(scryptHash(String(secret ?? ''), row.secret_salt), row.secret_hash);
}

// UA 解析：设备类型 / 系统 / 型号 / 浏览器。浏览器拿不到真实型号，安卓机型从 UA 片段提取，其余留空由客户端上报补齐。
function parseUserAgent(userAgent) {
  const value = String(userAgent || '');
  const lower = value.toLowerCase();
  let deviceType = 'desktop';
  let deviceOs = '';
  let deviceModel = '';
  if (lower.includes('android')) {
    deviceType = lower.includes('mobile') ? 'mobile' : 'tablet';
    deviceOs = 'Android';
    const build = value.match(/Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/|\))/i);
    if (build) deviceModel = build[1].trim().slice(0, 40);
  } else if (lower.includes('iphone') || lower.includes('ipod')) {
    deviceType = 'mobile';
    deviceOs = 'iOS';
    deviceModel = 'iPhone';
  } else if (lower.includes('ipad')) {
    deviceType = 'tablet';
    deviceOs = 'iPadOS';
    deviceModel = 'iPad';
  } else if (lower.includes('windows')) {
    deviceOs = 'Windows';
  } else if (lower.includes('mac os') || lower.includes('macintosh')) {
    deviceOs = 'macOS';
  } else if (lower.includes('linux')) {
    deviceOs = 'Linux';
  }
  let browser = '';
  let browserVersion = '';
  const versionOf = pattern => (value.match(pattern) || [])[1] || '';
  if (/edg(?:e|a|ios)?\//.test(lower)) {
    browser = 'Edge';
    browserVersion = versionOf(/edg(?:e|a|ios)?\/(\d+)/i);
  } else if (/opr\/|opera/.test(lower)) {
    browser = 'Opera';
    browserVersion = versionOf(/(?:opr|opera)\/(\d+)/i);
  } else if (/firefox|fxios/.test(lower)) {
    browser = 'Firefox';
    browserVersion = versionOf(/(?:firefox|fxios)\/(\d+)/i);
  } else if (/chrome|crios/.test(lower)) {
    browser = 'Chrome';
    browserVersion = versionOf(/(?:chrome|crios)\/(\d+)/i);
  } else if (/safari/.test(lower)) {
    browser = 'Safari';
    browserVersion = versionOf(/version\/(\d+)/i);
  }
  return { deviceType, deviceOs, deviceModel, browser, browserVersion };
}

// 每次成功登录（含自动登录/租约登录）调用：登记或刷新设备行。
// 身份链六级匹配（互为备份，可靠性递减）：
//   1. 终端密钥（客户端 deviceId 哈希锚定在行上）——抗升级/换屏/换网络，仅清浏览器数据失效
//   2. 电脑名（服务端解析）——密钥丢失后重新认回；此路径轮换密钥（重装/换浏览器档案后重新锚定）
//   3. 精确指纹（v2 机器特征）+ hostname 兼容检查——指纹同但电脑名不同视为另一台机器
//   4. 特征模糊匹配（platform+gpu+cores+memory，不含语言/时区——跨网/旅行不分裂）
//   5. 旧版行收编（无 traits 的历史行按系统匹配）
//   6. 新建（锚定客户端密钥）
function upsertDevice(database, userId, context) {
  const traits = normalizeTraits(context.deviceTraits);
  const fingerprint = traits ? computeMachineFingerprint(traits) : String(context.deviceFingerprint || '').trim();
  if (!fingerprint) return null;
  const now = Date.now();
  const parsed = parseUserAgent(context.userAgent);
  const hostname = String(context.hostname || '').trim().slice(0, 64);
  const hostnameKey = hostname.toLowerCase();
  const deviceKeyHash = hashDeviceKey(context.deviceId);

  const byKey = deviceKeyHash
    ? database.prepare('SELECT * FROM user_devices WHERE user_id = ? AND device_key_hash = ?')
      .get(userId, deviceKeyHash)
    : null;
  const byHostname = !byKey && hostname
    ? database.prepare('SELECT * FROM user_devices WHERE user_id = ? AND LOWER(hostname) = ? ORDER BY last_login_at DESC')
      .get(userId, hostnameKey)
    : null;
  let byFingerprint = null;
  if (!byKey && !byHostname && fingerprint) {
    const candidates = database.prepare(`SELECT * FROM user_devices
      WHERE user_id = ? AND device_fingerprint = ? ORDER BY last_login_at DESC`).all(userId, fingerprint);
    // 指纹相同但电脑名不同 = 配置相同的另一台机器，不吞并；无电脑名或相同才认
    byFingerprint = candidates.find(row => !row.hostname || !hostnameKey
      || row.hostname.toLowerCase() === hostnameKey) || null;
  }
  let byTraits = null;
  if (!byKey && !byHostname && !byFingerprint && traits) {
    const traitRows = database.prepare(`SELECT * FROM user_devices
      WHERE user_id = ? AND traits_json != '' ORDER BY last_login_at DESC`).all(userId);
    byTraits = traitRows.find(row => {
      if (row.hostname && hostnameKey && row.hostname.toLowerCase() !== hostnameKey) return false;
      try {
        const stored = JSON.parse(row.traits_json);
        return stored.platform === traits.platform && stored.cores === traits.cores
          && stored.memory === traits.memory
          // GPU 一方为空视为采集漂移（WebGL 首次失败/恢复），允许收编
          && (stored.gpu === traits.gpu || !stored.gpu || !traits.gpu);
      } catch {
        return false;
      }
    }) || null;
  }
  let byLegacy = null;
  if (!byKey && !byHostname && !byFingerprint && !byTraits && parsed.deviceOs) {
    // 空系统名（UA 缺失的请求）不参与收编，避免把无特征的杂行互相吞并
    byLegacy = database.prepare(`SELECT * FROM user_devices
      WHERE user_id = ? AND traits_json = '' AND device_os = ? ORDER BY last_login_at DESC`)
      .get(userId, parsed.deviceOs) || null;
  }

  const existing = byKey || byHostname || byFingerprint || byTraits || byLegacy;
  const nameSource = hostname || context.deviceName || (existing ? existing.device_name : '') || '';
  const merged = {
    deviceName: String(nameSource).slice(0, 80),
    hostname,
    deviceType: parsed.deviceType,
    deviceOs: parsed.deviceOs,
    deviceModel: String(context.deviceModel || parsed.deviceModel || existing?.device_model || '').slice(0, 40),
    browser: parsed.browser,
    browserVersion: parsed.browserVersion,
    userAgent: String(context.userAgent || '').slice(0, 500),
    networkEnv: String(context.networkEnv || existing?.network_env || '').slice(0, 24),
    lastIp: String(context.ipAddress || existing?.last_ip || '').slice(0, 64),
    lastRegion: String(context.region || existing?.last_region || '').slice(0, 120),
    traitsJson: traits ? JSON.stringify(traits) : (existing?.traits_json || '')
  };
  // 密钥规则：行无密钥时锚定客户端密钥；hostname 认回路径可轮换（重装/换浏览器档案后重新锚定）；
  // 其余路径不轮换（避免同机双浏览器密钥互相踩踏）。
  let nextKeyHash = existing?.device_key_hash || null;
  if (deviceKeyHash) {
    if (!nextKeyHash) nextKeyHash = deviceKeyHash;
    else if (byHostname && nextKeyHash !== deviceKeyHash) nextKeyHash = deviceKeyHash;
  }
  if (existing) {
    database.prepare(`UPDATE user_devices SET
      device_fingerprint = ?, device_name = ?, hostname = ?, device_type = ?, device_os = ?,
      device_model = ?, browser = ?, user_agent = ?, network_env = ?, last_ip = ?, last_region = ?,
      traits_json = ?, device_key_hash = ?, last_login_at = ?, updated_at = ?
      WHERE id = ?`)
      .run(fingerprint, merged.deviceName, merged.hostname || (existing.hostname || ''),
        merged.deviceType, merged.deviceOs, merged.deviceModel, merged.browser,
        merged.userAgent, merged.networkEnv, merged.lastIp, merged.lastRegion,
        merged.traitsJson, nextKeyHash, now, now, existing.id);
    return database.prepare('SELECT * FROM user_devices WHERE id = ?').get(existing.id);
  }
  const id = crypto.randomUUID();
  database.prepare(`INSERT INTO user_devices
    (id, user_id, device_fingerprint, device_name, hostname, device_type, device_os, device_model, browser,
     user_agent, network_env, last_ip, last_region, traits_json, device_key_hash,
     last_login_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, fingerprint, merged.deviceName, merged.hostname, merged.deviceType, merged.deviceOs,
      merged.deviceModel, merged.browser, merged.userAgent, merged.networkEnv, merged.lastIp,
      merged.lastRegion, merged.traitsJson, nextKeyHash, now, now, now);
  return database.prepare('SELECT * FROM user_devices WHERE id = ?').get(id);
}

function listDevices(database, userId) {
  return database.prepare('SELECT * FROM user_devices WHERE user_id = ? ORDER BY last_login_at DESC').all(userId);
}

function getDevice(database, userId, deviceId) {
  return database.prepare('SELECT * FROM user_devices WHERE user_id = ? AND id = ?').get(userId, deviceId) || null;
}

function deleteDevice(database, userId, deviceId) {
  database.prepare('DELETE FROM user_devices WHERE user_id = ? AND id = ?').run(userId, deviceId);
}

// 自动登录全账号（单设备）唯一：启用时先清掉同账号其他设备的 token
function enableAutoLogin(database, userId, deviceId) {
  const device = getDevice(database, userId, deviceId);
  if (!device) throw new Error('设备不存在');
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = Date.now() + AUTO_LOGIN_TTL_MS;
  database.prepare(`UPDATE user_devices SET
    auto_login_enabled = 0, auto_login_token_hash = NULL, auto_login_expires_at = NULL, updated_at = ?
    WHERE user_id = ? AND id != ?`).run(Date.now(), userId, deviceId);
  database.prepare(`UPDATE user_devices SET
    auto_login_enabled = 1, auto_login_token_hash = ?, auto_login_expires_at = ?, updated_at = ?
    WHERE id = ?`).run(tokenHash, expiresAt, Date.now(), deviceId);
  return { token, expiresAt };
}

function disableAutoLogin(database, userId, deviceId) {
  database.prepare(`UPDATE user_devices SET
    auto_login_enabled = 0, auto_login_token_hash = NULL, auto_login_expires_at = NULL, updated_at = ?
    WHERE user_id = ? AND id = ?`).run(Date.now(), userId, deviceId);
}

// 自动登录登录成功后的滑动续期
function renewAutoLogin(database, deviceId) {
  database.prepare('UPDATE user_devices SET auto_login_expires_at = ?, updated_at = ? WHERE id = ?')
    .run(Date.now() + AUTO_LOGIN_TTL_MS, Date.now(), deviceId);
}

// 用 token 找有效的自动登录设备（哈希比对 + 未过期 + 开关开着）
function findAutoLoginDevice(database, token) {
  const tokenHash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const device = database.prepare(`SELECT d.*, u.username, u.status AS user_status, u.expires_at AS user_expires_at, u.role AS user_role
    FROM user_devices d JOIN users u ON u.id = d.user_id
    WHERE d.auto_login_token_hash = ?`).get(tokenHash);
  if (!device) return null;
  if (!device.auto_login_enabled || !device.auto_login_token_hash) return null;
  if ((device.auto_login_expires_at || 0) <= Date.now()) return null;
  if (device.user_status !== 'active') return null;
  if (device.user_expires_at && device.user_expires_at <= Date.now()) return null;
  return device;
}

// until: null 撤销租约 | 'permanent' 永久 | 未来时间戳
function setLease(database, userId, deviceId, until) {
  const device = getDevice(database, userId, deviceId);
  if (!device) throw new Error('设备不存在');
  let leaseUntil = null;
  if (until === 'permanent') leaseUntil = PERMANENT_LEASE_AT;
  else if (until != null) {
    const value = Number(until);
    if (!Number.isFinite(value) || value <= Date.now()) throw new Error('租约时间无效');
    leaseUntil = Math.min(Math.floor(value), PERMANENT_LEASE_AT);
  }
  database.prepare('UPDATE user_devices SET lease_until = ?, lease_granted_at = ?, updated_at = ? WHERE id = ?')
    .run(leaseUntil, leaseUntil == null ? null : Date.now(), Date.now(), deviceId);
  return getDevice(database, userId, deviceId);
}

function leaseActive(device, now = Date.now()) {
  return Boolean(device?.lease_until && device.lease_until > now);
}

// 租约登录：客户端上报（userId + 指纹）对，命中有效租约才放行。
// 同配置机器指纹可能相同：电脑名能对上的候选行优先，消歧租约归属。
function findLeaseDevice(database, userId, fingerprint, hostname = '') {
  if (!userId || !fingerprint) return null;
  const candidates = database.prepare(`SELECT d.*, u.username, u.status AS user_status, u.expires_at AS user_expires_at, u.role AS user_role
    FROM user_devices d JOIN users u ON u.id = d.user_id
    WHERE d.user_id = ? AND d.device_fingerprint = ?`).all(userId, fingerprint);
  if (!candidates.length) return null;
  const hostnameKey = String(hostname || '').trim().toLowerCase();
  const device = (hostnameKey && candidates.find(row => row.hostname
    && row.hostname.toLowerCase() === hostnameKey)) || candidates[0];
  if (!device || !leaseActive(device)) return null;
  if (device.user_status !== 'active') return null;
  if (device.user_expires_at && device.user_expires_at <= Date.now()) return null;
  return device;
}

// 设备行转外显视图；includeSensitive 仅开发者视角为 true。
// 浏览器大版本不入库（版本自漂移只作档案），从 UA 现算。
function deviceView(row, { includeSensitive = false, currentFingerprint = '' } = {}) {
  if (!row) return null;
  const parsedView = parseUserAgent(row.user_agent);
  const view = {
    id: row.id,
    deviceName: row.device_name,
    deviceType: row.device_type,
    deviceOs: row.device_os,
    deviceModel: row.device_model,
    browser: row.browser || parsedView.browser,
    browserVersion: parsedView.browserVersion,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    autoLoginEnabled: Boolean(row.auto_login_enabled),
    autoLoginExpiresAt: row.auto_login_expires_at ? new Date(row.auto_login_expires_at).toISOString() : null,
    leaseUntil: row.lease_until ? new Date(row.lease_until).toISOString() : null,
    leasePermanent: (row.lease_until || 0) >= PERMANENT_LEASE_AT,
    isCurrentDevice: Boolean(currentFingerprint) && row.device_fingerprint === currentFingerprint
  };
  if (includeSensitive) {
    view.fingerprint = row.device_fingerprint;
    view.lastIp = row.last_ip;
    view.lastRegion = row.last_region;
    view.networkEnv = row.network_env;
    view.hostname = row.hostname || '';
    const traits = (() => {
      try { return JSON.parse(row.traits_json || '{}'); } catch { return {}; }
    })();
    view.gpu = traits.gpu || '';
  }
  return view;
}

function credentialView(row, { includeSecret = false, database } = {}) {
  if (!row) return { configured: false, type: null, verifyWindowMinutes: 0 };
  const view = {
    configured: true,
    type: row.type,
    verifyWindowMinutes: row.verify_window_minutes,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
  if (includeSecret && database) {
    try {
      view.secret = decryptSecret(database, row.secret_encrypted);
    } catch {
      view.secret = null;
      view.decryptFailed = true;
    }
  }
  return view;
}

module.exports = {
  CREDENTIAL_TYPES,
  AUTO_LOGIN_TTL_MS,
  SETUP_WINDOW_MS,
  PERMANENT_LEASE_AT,
  MAX_WINDOW_MINUTES,
  SENSITIVE_PAGES,
  SENSITIVE_API_PREFIXES,
  securityKey,
  encryptSecret,
  decryptSecret,
  normalizeSecret,
  normalizeWindowMinutes,
  normalizeGpuRenderer,
  normalizeTraits,
  computeMachineFingerprint,
  hashDeviceKey,
  getCredential,
  grantSetupWindow,
  setupWindowActive,
  setCredential,
  verifySecurityPassword,
  parseUserAgent,
  upsertDevice,
  listDevices,
  getDevice,
  deleteDevice,
  enableAutoLogin,
  disableAutoLogin,
  renewAutoLogin,
  findAutoLoginDevice,
  setLease,
  leaseActive,
  findLeaseDevice,
  deviceView,
  credentialView
};
