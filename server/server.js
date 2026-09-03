const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { migrateLegacyData, readAppSetting, writeAppSetting } = require('./db-migrate');
migrateLegacyData();
const { db } = require('./db');
const { MANAGEMENT_VIEWS, operationsView } = require('./operations-service');
const {
  applyEventAction,
  createManagedEvent,
  managedEventSnapshot,
  readEventMedia,
  updateManagedEvent
} = require('./event-management-service');
const { laboratorySettings, saveLaboratorySettings } = require('./laboratory-settings');
const { formatGeoRegion, needsLocalizedLookup, providerGeoRegion, readGeoJson } = require('./location-service');
const {
  IDENTITY_LABELS,
  effectivePermissionDetails,
  hasPermission,
  permissionCenterSnapshot,
  saveIdentityPermissions,
  saveAccountOverrides
} = require('./permissions-service');
const {
  canAccessChannel,
  communicationBootstrap,
  createCustomChannel,
  createPrivateChannel,
  deleteMessageForUser,
  editMessage,
  listMessages,
  markChannelRead,
  recallMessage,
  sendMessage,
  setMessageUrgent,
  toggleMessagePlusOne
} = require('./communication-service');
const {
  channelRecipientUserIds,
  createMessageNotification,
  createNotification,
  ensureVersionNotification,
  listNotifications,
  listPublishedNotifications,
  markAllNotificationsRead,
  markChannelNotificationsRead,
  markNotificationRead,
  publishNotification,
  syncMessageUrgency
} = require('./notification-service');

// 本机登录凭据与会话：首次使用由开发者初始化专属密码，密码采用 scrypt。
function scryptHash(password, salt) {
  return crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
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

function findUserRow(account) {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(account);
}

const IDENTITY_KEYS = ['developer', 'administrator', 'director', 'commentator', 'referee', 'scorer', 'guest'];

function identityKeysForUser(userId, fallbackRole = 'user') {
  const rows = db.prepare(`SELECT identity_key FROM user_identity_assignments
    WHERE user_id = ? ORDER BY sort_order`).all(userId);
  if (rows.length) return rows.map(row => row.identity_key);
  const profile = db.prepare('SELECT identity_key FROM user_profiles WHERE user_id = ?').get(userId);
  if (profile?.identity_key && IDENTITY_KEYS.includes(profile.identity_key)) return [profile.identity_key];
  if (fallbackRole === 'developer') return ['developer'];
  if (fallbackRole === 'admin' || fallbackRole === 'operator') return ['administrator'];
  return ['guest'];
}

function normalizeIdentityKeys(body, current = {}) {
  const supplied = Array.isArray(body.identityKeys)
    ? body.identityKeys
    : (body.identityKey ? [body.identityKey] : null);
  const fallback = supplied || current.identityKeys || (current.id
    ? identityKeysForUser(current.id, current.role)
    : [current.role === 'developer' ? 'developer' : current.role === 'admin' ? 'administrator' : 'guest']);
  const keys = [...new Set(fallback.filter(key => IDENTITY_KEYS.includes(key)))].slice(0, 8);
  if (keys.length) return keys;
  if (current.role === 'developer') return ['developer'];
  if (current.role === 'admin') return ['administrator'];
  return ['guest'];
}

function saveIdentityAssignments(userId, identityKeys) {
  db.prepare('DELETE FROM user_identity_assignments WHERE user_id = ?').run(userId);
  const insert = db.prepare(`INSERT INTO user_identity_assignments
    (user_id, identity_key, sort_order) VALUES (?, ?, ?)`);
  identityKeys.forEach((key, index) => insert.run(userId, key, index));
}

function authSetupRequired() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'developer' AND status = 'active'").get().n === 0;
}

function createUser({ username, displayName, password, role, permissions }) {
  const userId = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  db.prepare(`INSERT INTO users
    (id, username, display_name, password_hash, salt, role, permissions_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .run(userId, username, displayName, scryptHash(password, salt), salt, role,
      JSON.stringify(permissions || []), now, now);
  const identityKey = role === 'developer' ? 'developer' : role === 'admin' ? 'administrator' : 'guest';
  db.prepare(`INSERT INTO user_profiles (user_id, identity_key, created_at, updated_at)
    VALUES (?, ?, ?, ?)`).run(userId, identityKey, now, now);
  saveIdentityAssignments(userId, [identityKey]);
  const insertVisibility = db.prepare(
    'INSERT INTO user_profile_stat_visibility (user_id, stat_key, sort_order) VALUES (?, ?, ?)');
  ['duty_time', 'account_expiry', 'event_count', 'game_count']
    .forEach((key, index) => insertVisibility.run(userId, key, index));
  return userId;
}

function initializeCredentials(password) {
  if (!authSetupRequired()) throw new Error('系统已完成初始化');
  const value = String(password || '');
  if (value.length < 10) throw new Error('开发者密码至少需要 10 个字符');
  withAuthTransaction(() => {
    createUser({ username: 'administrator', displayName: '开发者', password: value, role: 'developer', permissions: ['*'] });
    createUser({ username: 'operator', displayName: '管理员', password: value, role: 'admin', permissions: [] });
  });
}

function withAuthTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function checkUserPassword(row, passwordInput) {
  if (!row || row.status !== 'active') return false;
  // 2.2.0 正式账户使用 scrypt；64 位旧 SHA-256 记录只用于兼容迁移。
  if (String(row.password_hash || '').length === 128) {
    return safeEqualHex(scryptHash(passwordInput, row.salt), row.password_hash);
  }
  const legacy = crypto.createHash('sha256').update(`${row.salt}:${passwordInput}`).digest('hex');
  return safeEqualHex(legacy, row.password_hash);
}

const LOGIN_PORTALS = Object.freeze({
  administrator: {
    allows: row => row?.role === 'developer' || row?.role === 'admin',
    invalidCode: 'INVALID_ADMIN_CREDENTIALS',
    invalidMessage: '管理员账号或密码错误'
  },
  user: {
    allows: row => row?.role === 'user',
    invalidCode: 'INVALID_USER_CREDENTIALS',
    invalidMessage: '用户账号或密码错误'
  }
});

const SYSTEM_ACCESS_SETTING_KEY = 'system.access.open';

function loginPortal(requestedRole) {
  return requestedRole === 'developer' ? LOGIN_PORTALS.administrator : LOGIN_PORTALS.user;
}

function systemAccessOpen() {
  return readAppSetting(SYSTEM_ACCESS_SETTING_KEY, true) !== false;
}

function systemAccessPolicy() {
  return { open: systemAccessOpen() };
}

function saveSystemAccessPolicy(open) {
  if (typeof open !== 'boolean') throw new Error('系统开放状态必须为布尔值');
  writeAppSetting(SYSTEM_ACCESS_SETTING_KEY, open);
  return systemAccessPolicy();
}

function verifyCredentials(account, password, portal) {
  const accountInput = String(account || '').trim();
  if (!accountInput || !password) return null;
  const row = findUserRow(accountInput);
  if (!row || !portal.allows(row)) return null;
  if (row.status !== 'active') return { disabled: true };
  if (!checkUserPassword(row, password)) return null;
  if (row.expires_at && row.expires_at <= Date.now()) return null;
  return {
    id: row.id,
    account: row.username,
    role: row.role,
    permissions: JSON.parse(row.permissions_json || '[]'),
    activeIdentityKey: identityKeysForUser(row.id, row.role)[0]
  };
}

const SESSION_SETTING_KEY = 'auth.sessions';
const SESSION_COOKIE = 'stella_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessionEventClients = new Map();

function getSessionToken(req) {
  const header = req.headers.cookie || '';
  const match = header.split(/;\s*/).find(part => part.startsWith(`${SESSION_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
}

function secureRequest(req) {
  return Boolean(req.socket.encrypted)
    || (shouldTrustProxy(req) && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}

function sessionCookie(token, remember, secure = false) {
  const maxAge = remember ? `; Max-Age=${SESSION_TTL_MS / 1000}` : '';
  const secureFlag = secure ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secureFlag}${maxAge}`;
}

function loadSessions() {
  const list = readAppSetting(SESSION_SETTING_KEY);
  return Array.isArray(list) ? list : [];
}

function saveSessions(list) {
  writeAppSetting(SESSION_SETTING_KEY, list);
}

function addSessionEventClient(token, res) {
  const clients = sessionEventClients.get(token) || new Set();
  clients.add(res);
  sessionEventClients.set(token, clients);
  return () => {
    clients.delete(res);
    if (!clients.size) sessionEventClients.delete(token);
  };
}

function revokeSessionClients(session, reason = 'session-revoked') {
  const clients = sessionEventClients.get(session?.token);
  if (!clients) return;
  const message = `event: session-revoked\ndata: ${JSON.stringify({ reason })}\n\n`;
  for (const client of clients) {
    if (!client.destroyed && !client.writableEnded) {
      client.write(message);
      client.end();
    }
  }
  sessionEventClients.delete(session.token);
}

function createSession(user, remember, requestContext) {
  const storedSessions = loadSessions();
  storedSessions.filter(item => item.expiresAt <= Date.now()).forEach(closeDutySession);
  const activeSessions = storedSessions.filter(item => item.expiresAt > Date.now());
  const replacedSessions = activeSessions.filter(item => item.userId === user.id);
  replacedSessions.forEach(closeDutySession);
  const sessions = activeSessions.filter(item => item.userId !== user.id);
  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    token: crypto.randomBytes(32).toString('hex'),
    userId: user.id,
    role: user.role,
    account: user.account,
    permissions: effectivePermissionDetails({
      userId: user.id,
      role: user.role,
      activeIdentityKey: user.activeIdentityKey
    }).effective,
    activeIdentityKey: user.activeIdentityKey || identityKeysForUser(user.id, user.role)[0],
    ipAddress: requestContext.ipAddress,
    region: requestContext.region,
    deviceFingerprint: requestContext.deviceFingerprint,
    deviceName: requestContext.deviceName,
    userAgent: requestContext.userAgent,
    persistent: Boolean(remember),
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  sessions.push(session);
  saveSessions(sessions);
  db.prepare(`INSERT INTO user_duty_logs
    (id, user_id, session_id, started_at, ended_at, duration_seconds)
    VALUES (?, ?, ?, ?, NULL, 0)`).run(crypto.randomUUID(), user.id, sessionId, Date.now());
  return { session, replacedSessions };
}

function validateSession(token) {
  if (!token) return null;
  const sessions = loadSessions();
  const session = sessions.find(item => item.token === token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    closeDutySession(session);
    saveSessions(sessions.filter(item => item.token !== token && item.expiresAt > Date.now()));
    return null;
  }
  const row = session.userId
    ? db.prepare('SELECT id, status, role, permissions_json, username, expires_at FROM users WHERE id = ?').get(session.userId)
    : null;
  if (!row || row.status !== 'active' || (row.expires_at && row.expires_at <= Date.now())) {
    closeDutySession(session);
    saveSessions(sessions.filter(item => item.token !== token));
    revokeSessionClients(session);
    if (!hasActiveSession(session.userId)) disconnectPresence(session.userId);
    return null;
  }
  if (!systemAccessOpen() && !hasSystemManagementEntitlement({
    ...row,
    activeIdentityKey: session.activeIdentityKey
  })) {
    closeDutySession(session);
    saveSessions(sessions.filter(item => item.token !== token));
    revokeSessionClients(session, 'system-access-closed');
    if (!hasActiveSession(session.userId)) disconnectPresence(session.userId);
    return null;
  }
  if (row) {
    session.role = row.role;
    session.account = row.username;
    const keys = identityKeysForUser(session.userId, row.role);
    if (!keys.includes(session.activeIdentityKey)) session.activeIdentityKey = keys[0];
    session.identityKeys = keys;
    session.permissions = effectivePermissionDetails(session).effective;
  }
  return session;
}

function closeDutySession(session) {
  if (!session?.id) return;
  const now = Date.now();
  db.prepare(`UPDATE user_duty_logs
    SET ended_at = ?, duration_seconds = MAX(0, CAST((? - started_at) / 1000 AS INTEGER))
    WHERE session_id = ? AND ended_at IS NULL`).run(now, now, session.id);
}

function destroySession(token) {
  if (!token) return;
  const sessions = loadSessions();
  closeDutySession(sessions.find(item => item.token === token));
  saveSessions(sessions.filter(item => item.token !== token));
}

function hasSystemManagementEntitlement(subject) {
  let permissions = subject?.permissions;
  if (!Array.isArray(permissions)) {
    try {
      permissions = JSON.parse(subject?.permissions_json || '[]');
    } catch {
      permissions = [];
    }
  }
  if (subject?.role === 'developer' || subject?.role === 'admin'
    || permissions.includes('*') || permissions.includes('system.manage')) return true;
  const userId = subject?.userId || subject?.id;
  if (!userId) return false;
  const activeIdentityKey = subject?.activeIdentityKey
    || identityKeysForUser(userId, subject?.role)[0];
  return hasPermission({ userId, role: subject?.role, activeIdentityKey }, 'system.manage');
}

function revokeNonManagementSessions() {
  const sessions = loadSessions();
  const remainingSessions = [];
  const revokedSessions = [];
  const now = Date.now();
  for (const session of sessions) {
    const row = session.userId
      ? db.prepare('SELECT id, status, role, permissions_json, expires_at FROM users WHERE id = ?').get(session.userId)
      : null;
    const validManagementSession = session.expiresAt > now
      && row?.status === 'active'
      && (!row.expires_at || row.expires_at > now)
      && hasSystemManagementEntitlement({ ...row, activeIdentityKey: session.activeIdentityKey });
    if (validManagementSession) {
      remainingSessions.push(session);
      continue;
    }
    closeDutySession(session);
    revokedSessions.push(session);
  }
  saveSessions(remainingSessions);
  revokedSessions.forEach(session => revokeSessionClients(session, 'system-access-closed'));
  const revokedUserIds = [...new Set(revokedSessions.map(session => session.userId).filter(Boolean))];
  revokedUserIds.forEach(userId => {
    if (!hasActiveSession(userId, now)) disconnectPresence(userId);
  });
  return {
    revokedSessionCount: revokedSessions.length,
    revokedUserCount: revokedUserIds.length
  };
}

function canManageSystem(session) {
  return Boolean(session) && hasPermission(session, 'system.manage');
}

function profileIdentity(session) {
  const systemManagement = canManageSystem(session);
  return {
    kind: systemManagement ? 'developer' : 'operator',
    accessLevel: systemManagement ? 'full' : 'standard',
    systemManagement
  };
}

const PROFILE_STATS = new Set(['duty_time', 'account_expiry', 'event_count', 'game_count']);
const PROFILE_GENDERS = new Set(['unspecified', 'male', 'female', 'other']);
const MANUAL_PRESENCE_STATUSES = new Set(['online', 'offline', 'away', 'busy']);
const PRESENCE_PREFERENCES = new Set(['auto', ...MANUAL_PRESENCE_STATUSES]);
const PRESENCE_HEARTBEAT_TIMEOUT_MS = 75 * 1000;
const PRESENCE_AWAY_TIMEOUT_MS = 5 * 60 * 1000;
const ACCOUNT_STATUSES = new Set(['active', 'disabled']);

function profileText(value, label, maxLength) {
  const text = String(value || '').trim();
  if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
  return text;
}

function profileImage(value, label, maxBytes) {
  const source = String(value || '');
  if (!source) return null;
  const match = source.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error(`${label}仅支持 PNG、JPG 或 WebP 图片`);
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > maxBytes) throw new Error(`${label}数据不能超过 ${Math.round(maxBytes / 1024)}KB`);
  return {
    mimeType: match[1],
    data,
    byteSize: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex')
  };
}

function profileBirthDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error('出生日期格式无效');
  }
  const year = Number(text.slice(0, 4));
  const currentYear = new Date().getUTCFullYear();
  if (year < 1900 || year > currentYear) throw new Error('出生日期超出允许范围');
  return text;
}

function profileAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  const [year, month, day] = birthDate.split('-').map(Number);
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
  return Math.max(0, age);
}

function isoTime(value) {
  return value == null ? null : new Date(value).toISOString();
}

function ensureUserProfile(userId) {
  const now = Date.now();
  db.prepare('INSERT OR IGNORE INTO user_profiles (user_id, created_at, updated_at) VALUES (?, ?, ?)')
    .run(userId, now, now);
  const count = db.prepare('SELECT COUNT(*) AS n FROM user_profile_stat_visibility WHERE user_id = ?').get(userId).n;
  if (!count) {
    const insert = db.prepare(
      'INSERT INTO user_profile_stat_visibility (user_id, stat_key, sort_order) VALUES (?, ?, ?)');
    ['duty_time', 'account_expiry', 'event_count', 'game_count']
      .forEach((key, index) => insert.run(userId, key, index));
  }
}

function ensurePresence(userId) {
  db.prepare(`INSERT OR IGNORE INTO user_presence
    (user_id, status, activity_count, updated_at) VALUES (?, 'offline', 0, ?)`)
    .run(userId, Date.now());
  return db.prepare('SELECT * FROM user_presence WHERE user_id = ?').get(userId);
}

function hasActiveSession(userId, now = Date.now()) {
  return loadSessions().some(item => item.userId === userId && item.expiresAt > now);
}

function computePresence(row, now = Date.now()) {
  if (!row || !hasActiveSession(row.user_id, now)
    || !row.last_heartbeat_at || now - row.last_heartbeat_at > PRESENCE_HEARTBEAT_TIMEOUT_MS) {
    return 'offline';
  }
  if (row.working_context_id) return 'working';
  if (MANUAL_PRESENCE_STATUSES.has(row.manual_status)) return row.manual_status;
  if (!row.last_activity_at || now - row.last_activity_at > PRESENCE_AWAY_TIMEOUT_MS) return 'away';
  return 'online';
}

function refreshPresence(userId, now = Date.now()) {
  const row = ensurePresence(userId);
  const status = computePresence(row, now);
  if (row.status !== status) {
    db.prepare('UPDATE user_presence SET status = ?, updated_at = ? WHERE user_id = ?')
      .run(status, now, userId);
  }
  return status;
}

function presenceSnapshot(userId) {
  const status = refreshPresence(userId);
  const row = ensurePresence(userId);
  return {
    status,
    preference: row.manual_status || 'auto',
    workingContextId: status === 'working' ? row.working_context_id : null
  };
}

function presenceForUser(userId) {
  return presenceSnapshot(userId).status;
}

function connectPresence(userId) {
  const now = Date.now();
  ensurePresence(userId);
  db.prepare(`UPDATE user_presence SET
    status = 'online', last_heartbeat_at = ?, last_activity_at = ?,
    activity_window_started_at = ?, activity_count = 0,
    working_context_id = NULL, working_started_at = NULL, updated_at = ?
    WHERE user_id = ?`).run(now, now, now, now, userId);
  return presenceSnapshot(userId);
}

function recordPresenceHeartbeat(userId, body = {}) {
  const now = Date.now();
  const row = ensurePresence(userId);
  if (!row.last_heartbeat_at || now - row.last_heartbeat_at > PRESENCE_HEARTBEAT_TIMEOUT_MS) {
    db.prepare(`UPDATE user_presence SET working_context_id = NULL, working_started_at = NULL
      WHERE user_id = ?`).run(userId);
  }
  const reportedActivity = Number(body.lastActivityAt);
  const boundedActivity = Number.isFinite(reportedActivity) && reportedActivity > 0
    ? Math.min(now, Math.max(now - 24 * 60 * 60 * 1000, reportedActivity))
    : null;
  const lastActivityAt = boundedActivity
    ? Math.max(Number(row.last_activity_at) || 0, boundedActivity)
    : row.last_activity_at;
  db.prepare(`UPDATE user_presence SET
    last_heartbeat_at = ?, last_activity_at = ?, activity_window_started_at = NULL,
    activity_count = 0, updated_at = ? WHERE user_id = ?`)
    .run(now, lastActivityAt, now, userId);
  return presenceSnapshot(userId);
}

function setManualPresence(userId, preference) {
  const next = PRESENCE_PREFERENCES.has(preference) ? preference : 'auto';
  ensurePresence(userId);
  db.prepare('UPDATE user_presence SET manual_status = ?, updated_at = ? WHERE user_id = ?')
    .run(next === 'auto' ? null : next, Date.now(), userId);
  return presenceSnapshot(userId);
}

function setWorkingPresence(userId, active, contextId = null) {
  const now = Date.now();
  ensurePresence(userId);
  const requestedContext = String(contextId || '').trim().slice(0, 128);
  const context = requestedContext || 'adjudication';
  if (active) {
    db.prepare(`UPDATE user_presence SET
      last_heartbeat_at = ?, last_activity_at = ?, working_context_id = ?,
      working_started_at = COALESCE(working_started_at, ?), updated_at = ?
      WHERE user_id = ?`).run(now, now, context, now, now, userId);
  } else {
    db.prepare(`UPDATE user_presence SET
      last_heartbeat_at = ?, last_activity_at = ?, updated_at = ? WHERE user_id = ?`)
      .run(now, now, now, userId);
    db.prepare(`UPDATE user_presence SET
      working_context_id = NULL, working_started_at = NULL, updated_at = ?
      WHERE user_id = ? AND (? = '' OR working_context_id = ?)`)
      .run(now, userId, requestedContext, requestedContext);
  }
  return presenceSnapshot(userId);
}

function disconnectPresence(userId) {
  ensurePresence(userId);
  const now = Date.now();
  db.prepare(`UPDATE user_presence SET
    status = 'offline', last_heartbeat_at = NULL,
    activity_window_started_at = NULL, activity_count = 0,
    working_context_id = NULL, working_started_at = NULL, updated_at = ?
    WHERE user_id = ?`).run(now, userId);
  return presenceSnapshot(userId);
}

function sweepPresence() {
  const now = Date.now();
  const rows = db.prepare('SELECT user_id, last_heartbeat_at FROM user_presence').all();
  for (const row of rows) {
    if (!row.last_heartbeat_at || now - row.last_heartbeat_at > PRESENCE_HEARTBEAT_TIMEOUT_MS) {
      db.prepare(`UPDATE user_presence SET
        status = 'offline', working_context_id = NULL, working_started_at = NULL, updated_at = ?
        WHERE user_id = ? AND (status <> 'offline' OR working_context_id IS NOT NULL)`)
        .run(now, row.user_id);
    } else {
      refreshPresence(row.user_id, now);
    }
  }
}

function identityFromRow(row, activeIdentityKey) {
  const details = effectivePermissionDetails({
    userId: row.id,
    role: row.role,
    activeIdentityKey
  });
  const systemManagement = ['system.manage', 'accounts.manage', 'permissions.manage', 'notifications.publish']
    .some(key => details.effective.includes(key));
  return {
    kind: systemManagement ? 'developer' : 'operator',
    accessLevel: systemManagement ? 'full' : 'standard',
    systemManagement
  };
}

function activeIdentityForSession(session, userId, role) {
  const keys = session?.userId === userId && Array.isArray(session.identityKeys)
    ? session.identityKeys : identityKeysForUser(userId, role);
  const active = session?.userId === userId ? session.activeIdentityKey : null;
  return keys.includes(active) ? active : keys[0];
}

function readProfileStats(userId) {
  const duty = db.prepare('SELECT COALESCE(SUM(duration_seconds), 0) AS n FROM user_duty_logs WHERE user_id = ?')
    .get(userId).n;
  const active = loadSessions()
    .filter(item => item.userId === userId && item.expiresAt > Date.now())
    .reduce((total, item) => total + Math.max(0, Math.floor((Date.now() - Date.parse(item.createdAt)) / 1000)), 0);
  return {
    dutySeconds: duty + active,
    eventCount: db.prepare('SELECT COUNT(*) AS n FROM user_event_history WHERE user_id = ?').get(userId).n,
    gameCount: db.prepare('SELECT COUNT(*) AS n FROM user_game_history WHERE user_id = ?').get(userId).n
  };
}

function relationshipStatus(viewerId, targetId) {
  if (viewerId === targetId) return 'self';
  const [low, high] = [viewerId, targetId].sort();
  const row = db.prepare(`SELECT status, requested_by FROM user_relationships
    WHERE user_low_id = ? AND user_high_id = ?`).get(low, high);
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friend';
  return row.requested_by === viewerId ? 'outgoing' : 'incoming';
}

function readUserProfile(session, targetUserId = session.userId) {
  ensureUserProfile(targetUserId);
  const row = db.prepare(`SELECT
      users.id,
      users.username,
      users.display_name,
      users.role,
      users.permissions_json,
      users.status,
      users.expires_at,
      users.created_at AS account_created_at,
      users.last_login_at,
      user_profiles.title,
      user_profiles.bio,
      user_profiles.gender,
      user_profiles.birth_date,
      user_profiles.region,
      user_profiles.region_source,
      user_profiles.identity_key,
      user_profiles.updated_at,
      user_avatars.sha256 AS avatar_sha256,
      user_profile_covers.sha256 AS cover_sha256
    FROM users
    LEFT JOIN user_profiles ON user_profiles.user_id = users.id
    LEFT JOIN user_avatars ON user_avatars.user_id = users.id
    LEFT JOIN user_profile_covers ON user_profile_covers.user_id = users.id
    WHERE users.id = ?`).get(targetUserId);
  if (!row || row.status !== 'active') throw new Error('用户不存在或账号不可用');
  const visibleStats = db.prepare(
    'SELECT stat_key FROM user_profile_stat_visibility WHERE user_id = ? ORDER BY sort_order')
    .all(targetUserId).map(item => item.stat_key);
  const recentExecutions = db.prepare(`SELECT
      user_game_history.executed_at,
      events.name AS event_name,
      matches.matchup_home,
      matches.matchup_away,
      bp_sessions.game_number,
      bp_sessions.room
    FROM user_game_history
    JOIN events ON events.id = user_game_history.event_id
    JOIN matches ON matches.id = user_game_history.match_id
    JOIN bp_sessions ON bp_sessions.id = user_game_history.session_id
    WHERE user_game_history.user_id = ?
    ORDER BY user_game_history.executed_at DESC LIMIT 6`).all(targetUserId);
  const hasAvatar = row.avatar_sha256 != null;
  const hasCover = row.cover_sha256 != null;
  const identityKeys = identityKeysForUser(row.id, row.role);
  const activeIdentityKey = activeIdentityForSession(session, row.id, row.role);
  const presence = presenceSnapshot(targetUserId);
  return {
    id: row.id,
    account: row.username,
    role: row.role,
    identity: identityFromRow(row, activeIdentityKey),
    identityKey: activeIdentityKey,
    activeIdentityKey,
    identityKeys,
    permissions: effectivePermissionDetails({ userId: row.id, role: row.role, activeIdentityKey }).effective,
    displayName: row.display_name || row.username,
    title: row.title || '',
    bio: row.bio || '',
    gender: row.gender || 'unspecified',
    birthDate: row.birth_date || null,
    age: profileAge(row.birth_date),
    region: row.region || '未知地区',
    regionSource: row.region_source || 'login_ip',
    hasAvatar,
    avatarUrl: hasAvatar ? `/api/profiles/${row.id}/avatar?v=${row.avatar_sha256}` : null,
    hasCover,
    coverUrl: hasCover ? `/api/profiles/${row.id}/cover?v=${row.cover_sha256}` : null,
    visibleStats,
    stats: readProfileStats(targetUserId),
    recentExecutions: recentExecutions.map(item => ({
      eventName: item.event_name,
      matchLabel: [item.matchup_home, item.matchup_away].filter(Boolean).join(' vs ') || '未命名对局',
      gameNumber: item.game_number,
      room: item.room,
      executedAt: isoTime(item.executed_at)
    })),
    accountCreatedAt: isoTime(row.account_created_at),
    accountExpiresAt: isoTime(row.expires_at),
    lastLoginAt: isoTime(row.last_login_at),
    presenceStatus: presence.status,
    presencePreference: presence.preference,
    pendingTitle: db.prepare(`SELECT requested_title FROM user_title_requests
      WHERE user_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1`).get(targetUserId)?.requested_title || null,
    titleApprovalStatus: db.prepare(`SELECT status FROM user_title_requests
      WHERE user_id = ? ORDER BY requested_at DESC LIMIT 1`).get(targetUserId)?.status || 'approved',
    relationship: relationshipStatus(session.userId, targetUserId),
    isSelf: session.userId === targetUserId,
    canManage: canManageSystem(session),
    home: { defaultPage: 'personalCenter' },
    updatedAt: isoTime(row.updated_at)
  };
}

function normalizeUserProfile(session, body) {
  rejectClientRegionFields(body);
  const current = readUserProfile(session);
  const account = profileText(body.account ?? current.account, '账号', 32);
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(account)) throw new Error('账号只能包含字母、数字、点、下划线和连字符');
  const gender = PROFILE_GENDERS.has(body.gender) ? body.gender : current.gender;
  const visibleStats = [...new Set(Array.isArray(body.visibleStats) ? body.visibleStats : current.visibleStats)]
    .filter(key => PROFILE_STATS.has(key)).slice(0, 4);
  const avatarChanged = Object.prototype.hasOwnProperty.call(body, 'avatar');
  const coverChanged = Object.prototype.hasOwnProperty.call(body, 'cover');
  const requestedPresence = PRESENCE_PREFERENCES.has(body.presencePreference)
    ? body.presencePreference : current.presencePreference;
  const sensitiveChange = account !== current.account || Boolean(body.newPassword);
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId);
  if (sensitiveChange && !checkUserPassword(userRow, body.currentPassword)) throw new Error('当前密码不正确');
  if (body.newPassword && String(body.newPassword).length < 10) throw new Error('新密码至少需要 10 个字符');
  return {
    avatarChanged,
    avatar: avatarChanged ? profileImage(body.avatar, '头像', 600 * 1024) : undefined,
    coverChanged,
    cover: coverChanged ? profileImage(body.cover, '主页顶置图', 2 * 1024 * 1024) : undefined,
    newPassword: body.newPassword ? String(body.newPassword) : '',
    profile: {
      account,
      displayName: profileText(body.displayName ?? current.displayName, '昵称', 32) || account,
      title: profileText(body.title ?? current.title, '岗位', 40),
      bio: profileText(body.bio ?? current.bio, '个人简介', 200),
      gender,
      birthDate: profileBirthDate(body.birthDate ?? current.birthDate),
      visibleStats,
      presencePreference: requestedPresence,
      updatedAt: new Date().toISOString()
    }
  };
}

function rejectClientRegionFields(body) {
  if (!body || typeof body !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(body, 'region')
    || Object.prototype.hasOwnProperty.call(body, 'regionSource')
    || Object.prototype.hasOwnProperty.call(body, 'region_source')) {
    throw new Error('地区由登录 IP 自动识别，任何账号均无权手动修改');
  }
}

function saveUserProfile(session, body) {
  const { profile, avatar, avatarChanged, cover, coverChanged, newPassword } = normalizeUserProfile(session, body || {});
  const updatedAt = Date.parse(profile.updatedAt);
  const currentProfile = readUserProfile(session);
  const titleChanged = profile.title !== currentProfile.title;
  const pendingTitle = db.prepare(`SELECT requested_title FROM user_title_requests
    WHERE user_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1`).get(session.userId)?.requested_title || null;
  withAuthTransaction(() => {
    if (newPassword) {
      const salt = crypto.randomBytes(16).toString('hex');
      db.prepare(`UPDATE users SET username = ?, display_name = ?, password_hash = ?, salt = ?, updated_at = ?
        WHERE id = ?`).run(profile.account, profile.displayName, scryptHash(newPassword, salt), salt, updatedAt, session.userId);
    } else {
      db.prepare('UPDATE users SET username = ?, display_name = ?, updated_at = ? WHERE id = ?')
        .run(profile.account, profile.displayName, updatedAt, session.userId);
    }
    db.prepare(`INSERT INTO user_profiles
      (user_id, title, bio, gender, birth_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET
        title = excluded.title, bio = excluded.bio, gender = excluded.gender,
        birth_date = excluded.birth_date, updated_at = excluded.updated_at`)
      .run(session.userId, currentProfile.title,
        profile.bio, profile.gender, profile.birthDate, updatedAt, updatedAt);
    if (titleChanged && pendingTitle !== profile.title) {
      if (canManageSystem(session)) {
        db.prepare(`UPDATE user_title_requests SET status = 'approved', reviewed_at = ?, reviewed_by = ?
          WHERE user_id = ? AND status = 'pending'`).run(updatedAt, session.userId, session.userId);
        db.prepare('UPDATE user_profiles SET title = ?, updated_at = ? WHERE user_id = ?')
          .run(profile.title, updatedAt, session.userId);
      } else {
        db.prepare(`UPDATE user_title_requests SET status = 'rejected', reviewed_at = ?
          WHERE user_id = ? AND status = 'pending'`).run(updatedAt, session.userId);
        db.prepare(`INSERT INTO user_title_requests
          (id, user_id, requested_title, status, requested_at)
          VALUES (?, ?, ?, 'pending', ?)`).run(crypto.randomUUID(), session.userId, profile.title, updatedAt);
      }
    }
    saveProfileVisibility(session.userId, profile.visibleStats);
    if (avatarChanged) saveProfileMedia('user_avatars', session.userId, avatar, updatedAt);
    if (coverChanged) saveProfileMedia('user_profile_covers', session.userId, cover, updatedAt);
  });
  setManualPresence(session.userId, profile.presencePreference);
  if (profile.account !== session.account) {
    const sessions = loadSessions();
    sessions.filter(item => item.userId === session.userId).forEach(item => { item.account = profile.account; });
    saveSessions(sessions);
    session.account = profile.account;
  }
  if (newPassword) {
    const sessions = loadSessions();
    sessions.filter(item => item.userId === session.userId && item.token !== session.token).forEach(closeDutySession);
    saveSessions(sessions.filter(item => item.userId !== session.userId || item.token === session.token));
  }
  return readUserProfile(session);
}

function switchIdentity(session, identityKey) {
  const keys = identityKeysForUser(session.userId, session.role);
  if (!keys.includes(identityKey)) throw new Error('该账号没有此身份');
  if (identityKey === session.activeIdentityKey) return readUserProfile(session);
  const sessions = loadSessions();
  sessions.filter(item => item.userId === session.userId).forEach(item => {
    item.identityKeys = keys;
    item.activeIdentityKey = identityKey;
    item.permissions = effectivePermissionDetails(item).effective;
  });
  saveSessions(sessions);
  session.identityKeys = keys;
  session.activeIdentityKey = identityKey;
  session.permissions = effectivePermissionDetails(session).effective;
  return readUserProfile(session);
}

function saveProfileVisibility(userId, keys) {
  db.prepare('DELETE FROM user_profile_stat_visibility WHERE user_id = ?').run(userId);
  const insert = db.prepare(
    'INSERT INTO user_profile_stat_visibility (user_id, stat_key, sort_order) VALUES (?, ?, ?)');
  keys.forEach((key, index) => insert.run(userId, key, index));
}

function saveProfileMedia(table, userId, media, updatedAt) {
  if (!['user_avatars', 'user_profile_covers'].includes(table)) throw new Error('未知资料媒体类型');
  if (!media) {
    db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    return;
  }
  db.prepare(`INSERT INTO ${table}
    (user_id, mime_type, data, byte_size, sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      mime_type = excluded.mime_type, data = excluded.data, byte_size = excluded.byte_size,
      sha256 = excluded.sha256, updated_at = excluded.updated_at`)
    .run(userId, media.mimeType, media.data, media.byteSize, media.sha256, updatedAt, updatedAt);
}

function readProfileMedia(userId, type) {
  const table = type === 'cover' ? 'user_profile_covers' : 'user_avatars';
  return db.prepare(`SELECT mime_type, data, byte_size, sha256, updated_at FROM ${table} WHERE user_id = ?`)
    .get(userId);
}

function normalizeIp(value) {
  let candidate = String(value || '').trim().replace(/^for=/i, '').replace(/^"|"$/g, '');
  if (candidate.startsWith('[')) {
    candidate = candidate.slice(1, candidate.indexOf(']') > 0 ? candidate.indexOf(']') : undefined);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(':'));
  }
  candidate = candidate.replace(/^::ffff:/i, '').split('%')[0];
  return net.isIP(candidate) ? candidate : '';
}

function privateIp(address) {
  const ip = normalizeIp(address);
  if (!ip) return false;
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')
      || normalized.startsWith('fe8') || normalized.startsWith('fe9')
      || normalized.startsWith('fea') || normalized.startsWith('feb');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function shouldTrustProxy(req) {
  if (process.env.STELLA_TRUST_PROXY === '0') return false;
  if (process.env.STELLA_TRUST_PROXY === '1') return true;
  const platformProxy = process.env.VERCEL || process.env.CF_PAGES || process.env.RAILWAY_ENVIRONMENT
    || process.env.RENDER || process.env.FLY_APP_NAME;
  return Boolean(platformProxy) || privateIp(req.socket.remoteAddress);
}

function firstHeaderIp(value) {
  for (const part of String(value || '').split(',')) {
    const ip = normalizeIp(part);
    if (ip) return ip;
  }
  return '';
}

function forwardedHeaderIp(value) {
  for (const segment of String(value || '').split(',')) {
    const match = segment.match(/(?:^|;)\s*for=("?\[?[^;\],"]+\]?"?)/i);
    const ip = normalizeIp(match?.[1]);
    if (ip) return ip;
  }
  return '';
}

function safeHeaderText(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return decodeURIComponent(text.replace(/\+/g, '%20')).slice(0, 80);
  } catch {
    return text.slice(0, 80);
  }
}

function requestLocation(req) {
  const trustProxy = shouldTrustProxy(req);
  const forwarded = trustProxy
    ? firstHeaderIp(req.headers['cf-connecting-ip'])
      || firstHeaderIp(req.headers['true-client-ip'])
      || firstHeaderIp(req.headers['x-real-ip'])
      || firstHeaderIp(req.headers['x-forwarded-for'])
      || forwardedHeaderIp(req.headers.forwarded)
    : '';
  const ipAddress = forwarded || normalizeIp(req.socket.remoteAddress) || 'unknown';
  const local = ipAddress === '::1' || ipAddress === '127.0.0.1' || privateIp(ipAddress);
  const city = trustProxy
    ? safeHeaderText(req.headers['cf-ipcity'] || req.headers['x-vercel-ip-city'] || req.headers['x-client-city'])
    : '';
  const region = trustProxy
    ? safeHeaderText(req.headers['cf-region'] || req.headers['x-vercel-ip-country-region'] || req.headers['x-client-region'])
    : '';
  const country = trustProxy
    ? safeHeaderText(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-client-country'])
    : '';
  const formattedRegion = formatGeoRegion({ country, region, city });
  const hasProxyGeo = Boolean(country || region || city);
  return {
    ipAddress,
    ipHash: crypto.createHash('sha256')
      .update(`${process.env.STELLA_IP_HASH_PEPPER || 'stella'}:${ipAddress}`).digest('hex'),
    region: local ? '本机网络' : formattedRegion,
    source: local ? 'local' : (hasProxyGeo ? 'proxy_geo' : 'login_ip')
  };
}

const locationCache = new Map();

async function resolveRequestLocation(req) {
  const location = requestLocation(req);
  if ((!needsLocalizedLookup(location) || location.ipAddress === 'unknown') || privateIp(location.ipAddress)) {
    return location;
  }
  const cached = locationCache.get(location.ipAddress);
  if (cached?.expiresAt > Date.now()) return { ...location, ...cached.value };
  const template = process.env.STELLA_IP_GEO_URL
    || 'https://whois.pconline.com.cn/ipJson.jsp?ip={ip}&json=true';
  const endpoint = template.includes('{ip}')
    ? template.replace('{ip}', encodeURIComponent(location.ipAddress))
    : `${template.replace(/\/$/, '')}/${encodeURIComponent(location.ipAddress)}`;
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json', 'User-Agent': 'StellaDirector/2.2' },
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) return location;
    const data = await readGeoJson(response);
    if (data.success === false) return location;
    const region = providerGeoRegion(data);
    if (region === '未知地区') return location;
    const value = { region, source: 'proxy_geo' };
    locationCache.set(location.ipAddress, { value, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    return { ...location, ...value };
  } catch {
    return location;
  }
}

function deviceContext(body, req, location) {
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
  const suppliedFingerprint = String(body.deviceFingerprint || '').trim().toLowerCase();
  const suppliedDeviceId = String(body.deviceId || '').trim().slice(0, 128);
  const deviceFingerprint = /^[a-f0-9]{64}$/.test(suppliedFingerprint)
    ? suppliedFingerprint
    : crypto.createHash('sha256').update(`${suppliedDeviceId}|${userAgent}|${location.ipAddress}`).digest('hex');
  const deviceName = String(body.deviceName || '').trim().slice(0, 80)
    || (userAgent ? userAgent.split(/[;(]/)[0].trim() : '未知设备');
  return { ...location, deviceFingerprint, deviceName, userAgent };
}

function applyRequestContext(session, req) {
  if (!session) return;
  const location = requestLocation(req);
  session.ipAddress = location.ipAddress;
  if (!needsLocalizedLookup(location)) session.region = location.region;
  session.userAgent = String(req.headers['user-agent'] || session.userAgent || '').slice(0, 500);
}

function recordUserLogin(userId, context) {
  const now = Date.now();
  ensureUserProfile(userId);
  withAuthTransaction(() => {
    db.prepare('UPDATE users SET last_login_at = ?, last_login_ip_hash = ?, updated_at = ? WHERE id = ?')
      .run(now, context.ipHash, now, userId);
    db.prepare(`UPDATE user_profiles SET region = ?, region_source = ?, updated_at = ? WHERE user_id = ?`)
      .run(context.region, context.source, now, userId);
    db.prepare(`INSERT INTO user_login_history
      (id, user_id, ip_hash, ip_address, region, device_fingerprint, device_name, user_agent, logged_in_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(crypto.randomUUID(), userId, context.ipHash,
      context.ipAddress, context.region, context.deviceFingerprint, context.deviceName, context.userAgent, now);
  });
}

function managedAccountInput(body, current = {}) {
  rejectClientRegionFields(body);
  const account = profileText(body.account ?? current.username, '账号', 32);
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(account)) throw new Error('账号只能包含字母、数字、点、下划线和连字符');
  const identityKeys = normalizeIdentityKeys(body, current);
  const role = identityKeys.includes('developer')
    ? 'developer'
    : identityKeys.includes('administrator') ? 'admin' : 'user';
  const identityKey = identityKeys[0];
  const status = ACCOUNT_STATUSES.has(body.status) ? body.status : (current.status || 'active');
  const expiresAt = body.expiresAt === '' || body.expiresAt == null
    ? null
    : Date.parse(String(body.expiresAt));
  if (expiresAt != null && !Number.isFinite(expiresAt)) throw new Error('账号到期时间无效');
  const gender = PROFILE_GENDERS.has(body.gender) ? body.gender : (current.gender || 'unspecified');
  const visibleStats = [...new Set(Array.isArray(body.visibleStats)
    ? body.visibleStats : ['duty_time', 'account_expiry', 'event_count', 'game_count'])]
    .filter(key => PROFILE_STATS.has(key)).slice(0, 4);
  return {
    account,
    displayName: profileText(body.displayName ?? current.display_name, '昵称', 32) || account,
    role,
    identityKey,
    identityKeys,
    status,
    permissions: role === 'developer' ? ['*'] : [],
    expiresAt,
    title: profileText(body.title ?? current.title, '岗位', 40),
    bio: profileText(body.bio ?? current.bio, '个人简介', 200),
    gender,
    birthDate: profileBirthDate(body.birthDate ?? current.birth_date),
    visibleStats,
    avatarChanged: Object.prototype.hasOwnProperty.call(body, 'avatar'),
    avatar: Object.prototype.hasOwnProperty.call(body, 'avatar')
      ? profileImage(body.avatar, '头像', 600 * 1024) : undefined,
    coverChanged: Object.prototype.hasOwnProperty.call(body, 'cover'),
    cover: Object.prototype.hasOwnProperty.call(body, 'cover')
      ? profileImage(body.cover, '主页顶置图', 2 * 1024 * 1024) : undefined,
    password: body.password ? String(body.password) : ''
  };
}

function writeManagedProfile(userId, input, now) {
  ensureUserProfile(userId);
  db.prepare(`UPDATE user_profiles SET title = ?, bio = ?, gender = ?, birth_date = ?,
    identity_key = ?, updated_at = ? WHERE user_id = ?`)
    .run(input.title, input.bio, input.gender, input.birthDate, input.identityKey, now, userId);
  saveProfileVisibility(userId, input.visibleStats);
  saveIdentityAssignments(userId, input.identityKeys);
  if (input.avatarChanged) saveProfileMedia('user_avatars', userId, input.avatar, now);
  if (input.coverChanged) saveProfileMedia('user_profile_covers', userId, input.cover, now);
}

function listManagedAccounts(session) {
  const rows = db.prepare(`SELECT users.*, user_profiles.title, user_profiles.bio, user_profiles.gender,
    user_profiles.birth_date, user_profiles.region, user_profiles.identity_key, user_avatars.sha256 AS avatar_sha256,
      user_profile_covers.sha256 AS cover_sha256
    FROM users
    LEFT JOIN user_profiles ON user_profiles.user_id = users.id
    LEFT JOIN user_avatars ON user_avatars.user_id = users.id
    LEFT JOIN user_profile_covers ON user_profile_covers.user_id = users.id
    ORDER BY users.created_at, users.username`).all();
  return rows.map(row => ({
    id: row.id,
    account: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    identityKey: row.identity_key || (row.role === 'developer' ? 'developer' : row.role === 'admin' ? 'administrator' : 'guest'),
    identityKeys: identityKeysForUser(row.id, row.role),
    status: row.status,
    permissions: JSON.parse(row.permissions_json || '[]'),
    title: row.title || '',
    bio: row.bio || '',
    gender: row.gender || 'unspecified',
    birthDate: row.birth_date || null,
    region: row.region || '未知地区',
    accountExpiresAt: isoTime(row.expires_at),
    lastLoginAt: isoTime(row.last_login_at),
    createdAt: isoTime(row.created_at),
    avatarUrl: row.avatar_sha256 ? `/api/profiles/${row.id}/avatar?v=${row.avatar_sha256}` : null,
    coverUrl: row.cover_sha256 ? `/api/profiles/${row.id}/cover?v=${row.cover_sha256}` : null,
    visibleStats: db.prepare(
      'SELECT stat_key FROM user_profile_stat_visibility WHERE user_id = ? ORDER BY sort_order')
      .all(row.id).map(item => item.stat_key),
    stats: readProfileStats(row.id),
    pendingTitle: db.prepare(`SELECT requested_title FROM user_title_requests
      WHERE user_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1`).get(row.id)?.requested_title || null,
    presenceStatus: presenceForUser(row.id),
    isCurrent: row.id === session.userId
  }));
}

function createManagedAccount(session, body) {
  const input = managedAccountInput(body);
  if (input.role === 'developer' && session.activeIdentityKey !== 'developer') {
    throw new Error('只有开发者可以创建开发者账号');
  }
  if (input.password.length < 10) throw new Error('初始密码至少需要 10 个字符');
  let userId;
  withAuthTransaction(() => {
    userId = createUser({
      username: input.account,
      displayName: input.displayName,
      password: input.password,
      role: input.role,
      permissions: input.permissions
    });
    const now = Date.now();
    db.prepare('UPDATE users SET status = ?, expires_at = ?, updated_at = ? WHERE id = ?')
      .run(input.status, input.expiresAt, now, userId);
    writeManagedProfile(userId, input, now);
  });
  return listManagedAccounts(session).find(item => item.id === userId);
}

function updateManagedAccount(session, userId, body) {
  const current = db.prepare(`SELECT users.*, user_profiles.title, user_profiles.bio, user_profiles.gender,
    user_profiles.birth_date FROM users
    LEFT JOIN user_profiles ON user_profiles.user_id = users.id WHERE users.id = ?`).get(userId);
  if (!current) throw new Error('账号不存在');
  const input = managedAccountInput(body, current);
  if ((current.role === 'developer' || input.role === 'developer') && session.activeIdentityKey !== 'developer') {
    throw new Error('只有开发者可以管理开发者账号');
  }
  if (input.password && input.password.length < 10) throw new Error('重置密码至少需要 10 个字符');
  if (current.role === 'developer' && (input.role !== 'developer' || input.status !== 'active')) {
    const activeDevelopers = db.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'developer' AND status = 'active' AND id <> ?").get(userId).n;
    if (!activeDevelopers) throw new Error('系统必须保留至少一个启用的开发者账号');
  }
  const now = Date.now();
  withAuthTransaction(() => {
    if (input.password) {
      const salt = crypto.randomBytes(16).toString('hex');
      db.prepare(`UPDATE users SET username = ?, display_name = ?, role = ?, permissions_json = ?, status = ?,
        expires_at = ?, password_hash = ?, salt = ?, updated_at = ? WHERE id = ?`)
        .run(input.account, input.displayName, input.role, JSON.stringify(input.permissions), input.status,
          input.expiresAt, scryptHash(input.password, salt), salt, now, userId);
    } else {
      db.prepare(`UPDATE users SET username = ?, display_name = ?, role = ?, permissions_json = ?, status = ?,
        expires_at = ?, updated_at = ? WHERE id = ?`)
        .run(input.account, input.displayName, input.role, JSON.stringify(input.permissions), input.status,
          input.expiresAt, now, userId);
    }
    writeManagedProfile(userId, input, now);
  });
  const sessions = loadSessions();
  if (input.status !== 'active' || input.password) {
    sessions.filter(item => item.userId === userId).forEach(closeDutySession);
    saveSessions(sessions.filter(item => item.userId !== userId));
  } else {
    sessions.filter(item => item.userId === userId).forEach(item => {
      item.account = input.account;
      item.role = input.role;
      item.permissions = input.permissions;
      item.identityKeys = input.identityKeys;
      if (!input.identityKeys.includes(item.activeIdentityKey)) item.activeIdentityKey = input.identityKeys[0];
    });
    saveSessions(sessions);
  }
  return listManagedAccounts(session).find(item => item.id === userId);
}

function reviewTitleRequest(session, userId, decision) {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('岗位审核结果无效');
  const request = db.prepare(`SELECT id, requested_title FROM user_title_requests
    WHERE user_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1`).get(userId);
  if (!request) throw new Error('没有待审核的岗位申请');
  const now = Date.now();
  withAuthTransaction(() => {
    db.prepare(`UPDATE user_title_requests SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`)
      .run(decision, now, session.userId, request.id);
    if (decision === 'approved') {
      db.prepare('UPDATE user_profiles SET title = ?, updated_at = ? WHERE user_id = ?')
        .run(request.requested_title, now, userId);
    }
  });
  return listManagedAccounts(session).find(item => item.id === userId);
}

function deleteManagedAccount(session, userId) {
  const current = db.prepare('SELECT role, status FROM users WHERE id = ?').get(userId);
  if (!current) throw new Error('账号不存在');
  if (current.role === 'developer' && session.activeIdentityKey !== 'developer') {
    throw new Error('只有开发者可以删除开发者账号');
  }
  if (current.role === 'developer' && current.status === 'active') {
    const others = db.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'developer' AND status = 'active' AND id <> ?").get(userId).n;
    if (!others) throw new Error('系统必须保留至少一个启用的开发者账号');
  }
  const sessions = loadSessions();
  sessions.filter(item => item.userId === userId).forEach(closeDutySession);
  saveSessions(sessions.filter(item => item.userId !== userId));
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

function bulkUpdateManagedAccountStatus(session, userIds, status) {
  if (!ACCOUNT_STATUSES.has(status)) throw new Error('账号状态无效');
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(String).filter(Boolean))];
  if (!ids.length) throw new Error('请选择至少一个账号');
  const includesDeveloper = db.prepare(`SELECT COUNT(*) AS n FROM users
    WHERE id IN (${ids.map(() => '?').join(',')}) AND role = 'developer'`).get(...ids).n > 0;
  if (includesDeveloper && session.activeIdentityKey !== 'developer') throw new Error('只有开发者可以管理开发者账号');
  if (status === 'disabled') {
    const activeDevelopers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'developer' AND status = 'active'").get().n;
    const selectedActiveDevelopers = db.prepare(`SELECT COUNT(*) AS n FROM users
      WHERE id IN (${ids.map(() => '?').join(',')}) AND role = 'developer' AND status = 'active'`).get(...ids).n;
    if (activeDevelopers - selectedActiveDevelopers < 1) throw new Error('系统必须保留至少一个启用的开发者账号');
  }
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id IN (${placeholders})`)
    .run(status, Date.now(), ...ids);
  const sessions = loadSessions();
  if (status === 'disabled') {
    sessions.filter(item => ids.includes(item.userId)).forEach(closeDutySession);
    saveSessions(sessions.filter(item => !ids.includes(item.userId)));
  }
  return { changed: result.changes, accounts: listManagedAccounts(session) };
}

function bulkDeleteManagedAccounts(session, userIds) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(String).filter(Boolean))];
  if (!ids.length) throw new Error('请选择至少一个账号');
  const includesDeveloper = db.prepare(`SELECT COUNT(*) AS n FROM users
    WHERE id IN (${ids.map(() => '?').join(',')}) AND role = 'developer'`).get(...ids).n > 0;
  if (includesDeveloper && session.activeIdentityKey !== 'developer') throw new Error('只有开发者可以删除开发者账号');
  const activeDevelopers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'developer' AND status = 'active'").get().n;
  const selectedActiveDevelopers = db.prepare(`SELECT COUNT(*) AS n FROM users
    WHERE id IN (${ids.map(() => '?').join(',')}) AND role = 'developer' AND status = 'active'`).get(...ids).n;
  if (activeDevelopers - selectedActiveDevelopers < 1) throw new Error('系统必须保留至少一个启用的开发者账号');
  const sessions = loadSessions();
  sessions.filter(item => ids.includes(item.userId)).forEach(closeDutySession);
  saveSessions(sessions.filter(item => !ids.includes(item.userId)));
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...ids);
  return { deleted: result.changes, accounts: listManagedAccounts(session) };
}

function importManagedAccounts(session, rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('名单中没有可导入的账号');
  const imported = [];
  const rejected = [];
  rows.slice(0, 1000).forEach((row, index) => {
    try {
      imported.push(createManagedAccount(session, row));
    } catch (error) {
      rejected.push({ index: index + 1, account: row?.account || '', error: error.message });
    }
  });
  return { imported, rejected, accounts: listManagedAccounts(session) };
}

function publicUserCard(userId) {
  const row = db.prepare(`SELECT users.id, users.username, users.display_name, users.role,
      user_profiles.title, user_profiles.region, user_profiles.identity_key,
      user_avatars.sha256 AS avatar_sha256
    FROM users
    LEFT JOIN user_profiles ON user_profiles.user_id = users.id
    LEFT JOIN user_avatars ON user_avatars.user_id = users.id
    WHERE users.id = ? AND users.status = 'active'`).get(userId);
  if (!row) return null;
  return {
    id: row.id,
    account: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    identityKey: row.identity_key || (row.role === 'developer' ? 'developer' : row.role === 'admin' ? 'administrator' : 'guest'),
    title: row.title || '',
    region: row.region || '未知地区',
    presenceStatus: presenceForUser(row.id),
    avatarUrl: row.avatar_sha256 ? `/api/profiles/${row.id}/avatar?v=${row.avatar_sha256}` : null
  };
}

function listFriends(session) {
  const rows = db.prepare(`SELECT * FROM user_relationships
    WHERE user_low_id = ? OR user_high_id = ? ORDER BY updated_at DESC`).all(session.userId, session.userId);
  const result = { friends: [], incoming: [], outgoing: [] };
  for (const row of rows) {
    const otherId = row.user_low_id === session.userId ? row.user_high_id : row.user_low_id;
    const user = publicUserCard(otherId);
    if (!user) continue;
    if (row.status === 'accepted') result.friends.push(user);
    else if (row.status === 'pending' && row.requested_by === session.userId) result.outgoing.push(user);
    else if (row.status === 'pending') result.incoming.push(user);
  }
  return result;
}

function searchUsers(session, query) {
  const value = `%${String(query || '').trim().replaceAll('%', '')}%`;
  if (value === '%%') return [];
  return db.prepare(`SELECT id FROM users
    WHERE id <> ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)
      AND (username LIKE ? OR display_name LIKE ?)
    ORDER BY username LIMIT 20`).all(session.userId, Date.now(), value, value)
    .map(item => ({ ...publicUserCard(item.id), relationship: relationshipStatus(session.userId, item.id) }));
}

function requestFriend(session, targetUserId) {
  if (targetUserId === session.userId) throw new Error('不能添加自己为好友');
  if (!publicUserCard(targetUserId)) throw new Error('用户不存在或账号不可用');
  const [low, high] = [session.userId, targetUserId].sort();
  const existing = db.prepare(
    'SELECT status, requested_by FROM user_relationships WHERE user_low_id = ? AND user_high_id = ?').get(low, high);
  if (existing?.status === 'accepted') throw new Error('你们已经是好友');
  const now = Date.now();
  if (existing?.status === 'pending' && existing.requested_by === targetUserId) {
    db.prepare(`UPDATE user_relationships SET status = 'accepted', updated_at = ?
      WHERE user_low_id = ? AND user_high_id = ?`).run(now, low, high);
  } else {
    db.prepare(`INSERT INTO user_relationships
      (user_low_id, user_high_id, requested_by, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
      ON CONFLICT (user_low_id, user_high_id) DO UPDATE SET
        requested_by = excluded.requested_by, status = 'pending', updated_at = excluded.updated_at`)
      .run(low, high, session.userId, now, now);
  }
  return listFriends(session);
}

function acceptFriend(session, otherUserId) {
  const [low, high] = [session.userId, otherUserId].sort();
  const result = db.prepare(`UPDATE user_relationships SET status = 'accepted', updated_at = ?
    WHERE user_low_id = ? AND user_high_id = ? AND status = 'pending' AND requested_by = ?`)
    .run(Date.now(), low, high, otherUserId);
  if (!result.changes) throw new Error('没有可接受的好友请求');
  return listFriends(session);
}

function removeFriend(session, otherUserId) {
  const [low, high] = [session.userId, otherUserId].sort();
  db.prepare('DELETE FROM user_relationships WHERE user_low_id = ? AND user_high_id = ?').run(low, high);
  return listFriends(session);
}

function recordUserExecution(userId, sessionId) {
  const row = db.prepare(`SELECT bp_sessions.match_id, matches.event_id FROM bp_sessions
    JOIN matches ON matches.id = bp_sessions.match_id WHERE bp_sessions.id = ?`).get(sessionId);
  if (!row) return;
  const now = Date.now();
  withAuthTransaction(() => {
    db.prepare(`INSERT INTO user_event_history (user_id, event_id, first_executed_at, last_executed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, event_id) DO UPDATE SET last_executed_at = excluded.last_executed_at`)
      .run(userId, row.event_id, now, now);
    db.prepare(`INSERT INTO user_game_history (user_id, session_id, event_id, match_id, executed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, session_id) DO UPDATE SET executed_at = excluded.executed_at`)
      .run(userId, sessionId, row.event_id, row.match_id, now);
  });
}

const { BpService } = require('./bp-service');
const { BpPresentationService } = require('./bp-presentation');
const {
  calculateCharacterStats,
  createCharacter,
  updateCharacter,
  archiveCharacter,
  readCharacterPortrait,
  readCharacterSkillIcon
} = require('./character-stats');
const { CONFIG, ESCAPE_CHARACTERS, HUNTER_CHARACTERS, PHASES, SLOT_CONFIG, phaseDurations, animationStyle, updateBpTimerConfig, commentatorImageId, updateCommentatorImageId, commentatorLogoImageId, updateCommentatorLogoImageId, reloadCharacterRoster } = require('./bp-config');
const { ObsController } = require('./obs-controller');
const { ObsWebSocketClient } = require('./obs-websocket');
const { MusicController } = require('./music-controller');
const { SceneMusicController } = require('./scene-music-controller');
const { MaterialLibrary } = require('./material-library');
const { ObsPathMigration } = require('./obs-path-migration');
const { readReleaseData } = require('./release-service');
const { createTournamentResolver, readAllData } = require('./tournament-data');
const { beijingTimestamp, selectSchedulePresentation } = require('./schedule-service');
const { DATA_ROOT } = require('./data-paths');
const { assertAssetDirectory, relativeAssetPath, resolveAssetPath } = require('./asset-paths');
const { createAssetResolver, indexedCommentatorImages } = require('./asset-fallback');

const PORT = Number(process.env.PORT || 3788);
const ROOT = path.resolve(__dirname, '..', 'public');
const COUNTDOWN_HUB_ID = 'countdown';
const BP_OVERLAY_URL = `http://127.0.0.1:${PORT}/bp-overlay.html`;
const WINDOW_CONTROL_SCRIPT = path.join(__dirname, 'window-control.ps1');
const MATERIAL_PICKER_SCRIPT = path.join(__dirname, 'material-picker.ps1');
const MATERIAL_OPEN_SCRIPT = path.join(__dirname, 'material-open.ps1');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon'
};
const IMAGE_TYPES = new Map([
  ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp']
]);
const MATERIAL_CONTENT_TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.bmp', 'image/bmp'],
  ['.svg', 'image/svg+xml'], ['.ico', 'image/x-icon'], ['.avif', 'image/avif'],
  ['.mp4', 'video/mp4'], ['.webm', 'video/webm'], ['.ogv', 'video/ogg'],
  ['.mov', 'video/quicktime'], ['.m4v', 'video/x-m4v'],
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.ogg', 'audio/ogg'],
  ['.m4a', 'audio/mp4'], ['.aac', 'audio/aac'], ['.flac', 'audio/flac']
]);
const COMMENTATOR_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const STARTED_AT = new Date().toISOString();
const CONTROL_TOKEN = String(process.env.STELLA_CONTROL_TOKEN || '');

const hubs = new Map();
const bpClients = new Set();
const bpPresentationClients = new Set();
const communicationClients = new Set();
const notificationClients = new Set();
const tournamentResolver = createTournamentResolver(readAllData());
const runtimeConfig = {
  obs: {
    url: readAppSetting('obs.url'),
    password: readAppSetting('obs.password')
  }
};
const localObsConfig = (() => {
  try {
    const configPath = path.join(process.env.APPDATA, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.server_enabled) return {};
    return {
      url: `ws://127.0.0.1:${config.server_port || 4455}`,
      password: config.auth_required ? config.server_password || '' : ''
    };
  } catch {
    return {};
  }
})();
const obsClient = new ObsWebSocketClient({
  url: process.env.OBS_WS_URL || runtimeConfig.obs?.url || localObsConfig.url || 'ws://127.0.0.1:4455',
  password: process.env.OBS_WS_PASSWORD || runtimeConfig.obs?.password || localObsConfig.password || ''
});
const materialLibrary = new MaterialLibrary();
const assetResolver = createAssetResolver(materialLibrary);
const obsController = new ObsController({ client: obsClient, resolver: tournamentResolver, assetPath: assetResolver });
const musicController = new MusicController();
const sceneMusicController = new SceneMusicController({ musicController });
let activeCommentatorImage = commentatorImages().find(image => image.id === commentatorImageId()) || null;
let activeCommentatorLogoImage = commentatorLogoImages().find(image => image.id === commentatorLogoImageId()) || commentatorLogoImages()[0] || null;
const bpService = new BpService({ resolver: tournamentResolver, commentatorImage: activeCommentatorImage });
tournamentResolver.setOutcomeResolver(matchId => bpService.matchWinner(matchId));
const bpPresentation = new BpPresentationService({
  resolver: tournamentResolver,
  getSession: id => bpService.serialize(bpService.getSession(id))
});
const obsPathMigration = new ObsPathMigration({ client: obsClient, obsController, materialLibrary });
ensureHub(COUNTDOWN_HUB_ID);

function pickMaterialPaths(mode) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', MATERIAL_PICKER_SCRIPT, '-Mode', mode
    ], { windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(new Error(`文件选择器打开失败: ${error.message}`));
        return;
      }
      try {
        const parsed = JSON.parse(String(stdout || '[]').trim() || '[]');
        resolve(Array.isArray(parsed) ? parsed : [parsed]);
      } catch (parseError) {
        reject(new Error(`文件选择器结果无效: ${parseError.message}`));
      }
    });
  });
}

function openMaterialPath(targetPath) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', MATERIAL_OPEN_SCRIPT, '-Path', targetPath
    ], { windowsHide: true, timeout: 15000 }, error => {
      if (error) reject(new Error(`无法使用系统关联程序打开文件: ${error.message}`));
      else resolve();
    });
  });
}

function currentSchedulePresentation(now = Date.now()) {
  return selectSchedulePresentation(
    tournamentResolver.schedules,
    matchId => Boolean(bpService.matchWinner(matchId)),
    now
  );
}

async function syncCurrentScheduleImage(now = Date.now()) {
  const presentation = currentSchedulePresentation(now);
  if (presentation?.image) await obsController.syncScheduleImage(presentation.image);
  if (presentation?.tableImage) await obsController.syncScheduleTableImage(presentation.tableImage);
  return presentation;
}

function commentatorImages() {
  const images = [];
  let root;
  try { root = resolveAssetPath(CONFIG.assets.commentatorRoot); } catch {}
  if (root && fs.existsSync(root)) {
    images.push(...fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.includes('组合') && COMMENTATOR_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase('en-US')))
      .map(entry => ({
        id: entry.name,
        name: path.basename(entry.name, path.extname(entry.name)),
        filePath: path.posix.join(CONFIG.assets.commentatorRoot.replaceAll('\\', '/'), entry.name),
        absolutePath: path.join(root, entry.name)
      })));
  }
  const seen = new Set(images.map(image => path.resolve(image.absolutePath).toLocaleLowerCase('en-US')));
  for (const image of indexedCommentatorImages(materialLibrary)) {
    const key = path.resolve(image.absolutePath).toLocaleLowerCase('en-US');
    if (!seen.has(key)) images.push(image);
    seen.add(key);
  }
  return images.map(({ absolutePath, indexed, ...image }) => image)
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }));
}

function commentatorImage(imageId) {
  const image = commentatorImages().find(item => item.id === imageId);
  if (!image) throw new Error('所选解说组图不存在');
  return image;
}

function commentatorLogoImages() {
  const images = [{
    id: 'logo',
    name: '解说席 LOGO',
    filePath: CONFIG.assets.commentatorLogo
  }];
  let root;
  try { root = resolveAssetPath(CONFIG.assets.commentatorCodeRoot); } catch {}
  if (root && fs.existsSync(root)) {
    images.push(...fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isFile() && COMMENTATOR_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase('en-US')))
      .map(entry => ({
        id: `code:${entry.name}`,
        name: path.basename(entry.name, path.extname(entry.name)),
        filePath: path.posix.join(CONFIG.assets.commentatorCodeRoot.replaceAll('\\', '/'), entry.name)
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true })));
  }
  return images;
}

function commentatorLogoImage(imageId) {
  const image = commentatorLogoImages().find(item => item.id === imageId);
  if (!image) throw new Error('所选解说 LOGO 或兑换码不存在');
  return image;
}

function sessionForObs(session) {
  if (!session?.commentatorImage?.id) return session;
  const image = commentatorImages().find(item => item.id === session.commentatorImage.id);
  return image ? { ...session, commentatorImage: image } : session;
}

function defaultCountdownState() {
  return {
    module: 'countdown',
    mode: 'duration',
    durationSeconds: 48,
    targetAt: null,
    remainingSeconds: 48,
    running: false,
    startedAt: null,
    deadline: null,
    updatedAt: Date.now()
  };
}

function ensureHub(id) {
  const normalizedId = id === COUNTDOWN_HUB_ID ? id : COUNTDOWN_HUB_ID;
  if (!hubs.has(normalizedId)) {
    const row = db.prepare('SELECT * FROM hub_states WHERE hub_id = ?').get(normalizedId);
    hubs.set(normalizedId, {
      id: normalizedId,
      state: row ? {
        module: 'countdown',
        mode: row.mode,
        durationSeconds: row.duration_seconds,
        targetAt: row.target_at,
        remainingSeconds: row.remaining_seconds,
        running: Boolean(row.running),
        startedAt: row.started_at,
        deadline: row.deadline_ms,
        updatedAt: row.updated_at
      } : defaultCountdownState(),
      clients: new Set(),
      logClients: new Set()
    });
  }
  return hubs.get(normalizedId);
}

function saveHubState(hub) {
  const state = hub.state;
  db.prepare(`INSERT INTO hub_states
    (hub_id, mode, duration_seconds, target_at, remaining_seconds, running, started_at, deadline_ms, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (hub_id) DO UPDATE SET
      mode = excluded.mode, duration_seconds = excluded.duration_seconds, target_at = excluded.target_at,
      remaining_seconds = excluded.remaining_seconds, running = excluded.running, started_at = excluded.started_at,
      deadline_ms = excluded.deadline_ms, updated_at = excluded.updated_at`)
    .run(hub.id, state.mode, state.durationSeconds ?? null, state.targetAt ?? null,
      state.remainingSeconds ?? 0, state.running ? 1 : 0, state.startedAt ?? null,
      state.deadline ?? null, state.updatedAt ?? Date.now());
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function readBuffer(req, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('图片不能超过20MB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function imageExtension(contentType) {
  const extension = IMAGE_TYPES.get(String(contentType || '').split(';')[0].toLowerCase());
  if (!extension) throw new Error('仅支持PNG、JPG和WebP图片');
  return extension;
}

function writeImage(root, baseName, extension, buffer) {
  if (!buffer.length) throw new Error('图片内容为空');
  const relativeRoot = relativeAssetPath(root);
  root = assertAssetDirectory(relativeRoot);
  const fileName = `${baseName}${extension}`;
  const filePath = path.join(root, fileName);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, filePath);
  return { fileName, filePath: path.posix.join(relativeRoot, fileName) };
}

function chineseRound(matchId) {
  const tournament = tournamentResolver.getTournamentByMatch(matchId);
  const index = tournament.matches.findIndex(match => match.id === matchId) + 1;
  return `第${['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'][index]}轮`;
}

function divisionLabel(matchId) {
  return tournamentResolver.getTournamentByMatch(matchId).event.division === 'pc' ? '端游赛区' : '手游赛区';
}

function broadcast(hub) {
  const payload = `event: state\ndata: ${JSON.stringify(hub.state)}\n\n`;
  for (const client of hub.clients) {
    client.write(payload);
  }
}

function broadcastCountdownLog(hub, eventLog) {
  const payload = `event: event-log\ndata: ${JSON.stringify(eventLog)}\n\n`;
  for (const client of hub.logClients || []) {
    client.write(payload);
  }
}

function broadcastBp(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of bpClients) client.write(message);
}

function broadcastCommunication(payload) {
  const message = `event: communication\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of [...communicationClients]) {
    const session = validateSession(client.token);
    if (!session || !hasPermission(session, 'communication.use')) {
      if (!client.res.writableEnded) client.res.end();
      communicationClients.delete(client);
      continue;
    }
    if (Array.isArray(payload.targetUserIds) && !payload.targetUserIds.includes(session.userId)) continue;
    if (payload.channelId && !canAccessChannel(db, session, payload.channelId)) continue;
    if (!client.res.destroyed && !client.res.writableEnded) client.res.write(message);
  }
}

function broadcastNotification(payload) {
  const message = `event: notification\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of [...notificationClients]) {
    const session = validateSession(client.token);
    if (!session) {
      if (!client.res.writableEnded) client.res.end();
      notificationClients.delete(client);
      continue;
    }
    if (Array.isArray(payload.targetUserIds) && !payload.targetUserIds.includes(session.userId)) continue;
    if (!client.res.destroyed && !client.res.writableEnded) client.res.write(message);
  }
}

function presentationStatus(reason) {
  return {
    ...bpPresentation.payload(reason),
    clientCount: bpPresentationClients.size,
    overlayUrl: BP_OVERLAY_URL
  };
}

function broadcastPresentation(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of bpPresentationClients) client.write(message);
  if (event === 'presentation') broadcastBp('bp-presentation', {
    ...payload,
    clientCount: bpPresentationClients.size,
    overlayUrl: BP_OVERLAY_URL
  });
}

bpPresentation.on('presentation', payload => broadcastPresentation('presentation', payload));
const bpPresentationHeartbeat = setInterval(() => {
  if (bpPresentationClients.size) broadcastPresentation('heartbeat', bpPresentation.heartbeat());
}, 1000);
bpPresentationHeartbeat.unref?.();
const presenceSweep = setInterval(sweepPresence, 15 * 1000);
const communicationHeartbeat = setInterval(() => {
  for (const client of [...communicationClients]) {
    const session = validateSession(client.token);
    if (!session || !hasPermission(session, 'communication.use')
      || client.res.destroyed || client.res.writableEnded) {
      if (!client.res.writableEnded) client.res.end();
      communicationClients.delete(client);
      continue;
    }
    client.res.write(': heartbeat\n\n');
  }
}, 25 * 1000);
const notificationHeartbeat = setInterval(() => {
  for (const client of [...notificationClients]) {
    const session = validateSession(client.token);
    if (!session || client.res.destroyed || client.res.writableEnded) {
      if (!client.res.writableEnded) client.res.end();
      notificationClients.delete(client);
      continue;
    }
    client.res.write(': heartbeat\n\n');
  }
}, 25 * 1000);
communicationHeartbeat.unref?.();
notificationHeartbeat.unref?.();
presenceSweep.unref?.();
bpService.on('session', payload => {
  broadcastBp('session', payload);
  bpPresentation.publishSession(payload.session, payload.reason);
});
bpService.on('push-slot', ({ session, slotId }) => {
  obsController.pushSlot(session, slotId).catch(() => {});
});
bpService.on('clear-slot', ({ session, slotId }) => {
  obsController.clearSlot(session, slotId).catch(() => {});
});
bpService.on('timer', ({ seconds }) => {
  obsController.setTimer(seconds).catch(() => {});
});
bpService.on('sync-session', ({ session }) => {
  obsController.syncSession(sessionForObs(session)).catch(() => {});
});
bpService.on('score', ({ score }) => {
  obsController.syncScore(score).catch(() => {});
});
obsClient.on('status', status => broadcastBp('obs-status', obsController.status(status)));
obsClient.on('CurrentProgramSceneChanged', event => {
  // 音乐联动内部钩子，暂不激活
  // sceneMusicController.setScene(event.sceneName).catch(() => {});
  if (event.sceneName !== CONFIG.obsScenes.bp && bpPresentation.state.visibility !== 'hidden') {
    bpPresentation.hide('scene-left-bp');
  }
});
obsController.on('operation', operation => broadcastBp('obs-operation', operation));
let activeAuditActor = null;
obsController.on('operation', operation => {
  db.prepare(`INSERT INTO obs_operation_logs
    (timestamp_ms, actor_user_id, actor_display_name, actor_identity_key, label, ok, error, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(operation.timestamp ?? Date.now(), activeAuditActor?.userId || null,
      activeAuditActor?.displayName || '系统', activeAuditActor?.identityKey || 'system',
      operation.label, operation.ok ? 1 : 0,
      operation.error || null, 'obs');
});

function actorDisplayName(userId) {
  if (!userId) return '系统';
  return db.prepare('SELECT COALESCE(display_name, username) AS name FROM users WHERE id = ?').get(userId)?.name || '系统';
}

const SENSITIVE_ACCOUNT_ACTIONS = new Set([
  '登录失败',
  '切换账号身份',
  '切换账号身份失败',
  '移除好友关系',
  '开放系统用户登录',
  '关闭系统用户登录',
  '创建账号',
  '批量导入账号',
  '批量变更账号状态',
  '批量删除账号',
  '修改账号',
  '删除账号',
  '修改身份权限',
  '修改账号权限',
  '新增角色',
  '修改角色基础数据',
  '停用角色',
  '发布系统通知',
  '批准岗位申请',
  '驳回岗位申请'
]);

function sensitiveAccountAction(category, session, action, details) {
  if (category !== 'account' || !session || hasSystemManagementEntitlement(session)) return false;
  if (action === '修改个人资料') return Boolean(details.sensitiveFields?.length);
  return SENSITIVE_ACCOUNT_ACTIONS.has(action);
}

function recordAuditLog(category, session, action, details = {}, success = true, error = null) {
  if (!['event', 'account'].includes(category)) return;
  const name = session?.actorDisplayName || (session ? actorDisplayName(session.userId) : '系统');
  const actorIdentityKey = details.actorIdentityKey || session?.activeIdentityKey || 'system';
  const sensitive = sensitiveAccountAction(category, session, action, details);
  const context = {
    ...details,
    actorIdentityKey,
    sensitive,
    sessionId: session?.id || details.sessionId || null,
    ipAddress: session?.ipAddress || details.ipAddress || 'unknown',
    region: session?.region || details.region || '未知地区',
    deviceFingerprint: session?.deviceFingerprint || details.deviceFingerprint || 'unknown',
    deviceName: session?.deviceName || details.deviceName || '未知设备',
    userAgent: session?.userAgent || details.userAgent || ''
  };
  db.prepare(`INSERT INTO account_operation_logs
    (id, timestamp_ms, actor_user_id, actor_display_name, category, action, success, error,
      session_id, ip_address, region, device_fingerprint, device_name, user_agent,
      actor_identity_key, sensitive, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), Date.now(), session?.userId || null, name, category, action, success ? 1 : 0,
      error || null, context.sessionId, context.ipAddress, context.region, context.deviceFingerprint,
      context.deviceName, context.userAgent, actorIdentityKey, sensitive ? 1 : 0, JSON.stringify(context));
}

const COUNTDOWN_ACTION_LABELS = {
  'set-target': '设置目标时间',
  'set-duration': '设置指定倒计时',
  start: '启动倒计时',
  pause: '暂停倒计时',
  reset: '重置倒计时',
  'update-bp-timer-config': '保存 BP 流程计时设置'
};

function countdownActionLabel(action = {}) {
  const base = COUNTDOWN_ACTION_LABELS[action.type] || `执行计时操作：${action.type || '未知'}`;
  if (action.type === 'set-target' && action.targetAt) {
    const target = new Date(action.targetAt);
    if (Number.isFinite(target.getTime())) return `${base}：${target.toLocaleString('zh-CN')}`;
  }
  if (action.type === 'set-duration') {
    const hours = normalizeSeconds(action.hours);
    const minutes = normalizeSeconds(action.minutes);
    const seconds = normalizeSeconds(action.seconds);
    return `${base}：${hours} 时 ${minutes} 分 ${seconds} 秒`;
  }
  return base;
}

function serializeCountdownEvent(row) {
  return {
    id: Number(row.id),
    hubId: row.hub_id,
    timestamp: Number(row.timestamp_ms),
    actorUserId: row.actor_user_id || null,
    actorName: row.actor_display_name || '系统',
    actorIdentityKey: row.actor_identity_key || 'system',
    actionType: row.action_type,
    action: row.action_label,
    success: Boolean(row.success),
    error: row.error || null,
    details: parseLogDetails(row.details_json)
  };
}

function recordCountdownEvent(hubId, session, action, beforeState, afterState, success = true, error = null) {
  const timestamp = Date.now();
  const result = db.prepare(`INSERT INTO countdown_event_logs
    (hub_id, timestamp_ms, actor_user_id, actor_display_name, actor_identity_key,
      action_type, action_label, success, error, session_id, ip_address, region,
      device_fingerprint, device_name, user_agent, details_json, before_state_json, after_state_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    hubId, timestamp, session?.userId || null,
    session?.actorDisplayName || (session ? actorDisplayName(session.userId) : '系统'),
    session?.activeIdentityKey || 'system', action?.type || 'unknown', countdownActionLabel(action),
    success ? 1 : 0, error || null, session?.id || null, session?.ipAddress || 'unknown',
    session?.region || '未知地区', session?.deviceFingerprint || 'unknown',
    session?.deviceName || '未知设备', session?.userAgent || '', JSON.stringify(action || {}),
    beforeState ? JSON.stringify(beforeState) : null, afterState ? JSON.stringify(afterState) : null);
  return serializeCountdownEvent(db.prepare('SELECT * FROM countdown_event_logs WHERE id = ?').get(result.lastInsertRowid));
}

function pagedCountdownEvents(hubId, options = {}) {
  const limit = Math.max(1, paginationNumber(options.limit, 50, 100));
  const cursor = paginationNumber(options.cursor, 0, Number.MAX_SAFE_INTEGER);
  const params = [hubId];
  const cursorWhere = cursor > 0 ? 'AND id < ?' : '';
  if (cursor > 0) params.push(cursor);
  const rows = db.prepare(`SELECT * FROM countdown_event_logs
    WHERE hub_id = ? ${cursorWhere}
    ORDER BY id DESC LIMIT ?`).all(...params, limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  return {
    logs: pageRows.map(serializeCountdownEvent),
    hasMore,
    nextCursor: hasMore && pageRows.length ? String(pageRows.at(-1).id) : null
  };
}

function parseLogDetails(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function persistRuntimeConfig() {
  writeAppSetting('obs.url', runtimeConfig.obs.url);
  writeAppSetting('obs.password', runtimeConfig.obs.password);
}

function paginationNumber(value, fallback, maximum) {
  const number = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(number, maximum);
}

function encodeLogCursor(row) {
  return Buffer.from(JSON.stringify([Number(row.timestamp), String(row.row_key)]), 'utf8').toString('base64url');
}

function parseLogCursor(value) {
  if (!value || String(value).length > 300) return null;
  try {
    const [timestamp, rowKey] = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!Number.isFinite(Number(timestamp)) || typeof rowKey !== 'string' || !rowKey) return null;
    return { timestamp: Number(timestamp), rowKey };
  } catch {
    return null;
  }
}

function logIdentityExpression(tableName) {
  return `CASE
    WHEN ${tableName}.actor_identity_key IS NOT NULL
      AND ${tableName}.actor_identity_key NOT IN ('', 'unknown')
      THEN ${tableName}.actor_identity_key
    WHEN ${tableName}.actor_user_id IS NULL THEN 'system'
    ELSE COALESCE((SELECT assignment.identity_key
      FROM user_identity_assignments AS assignment
      WHERE assignment.user_id = ${tableName}.actor_user_id
      ORDER BY assignment.sort_order, assignment.identity_key
      LIMIT 1), 'guest')
    END`;
}

function pagedLogs(category = 'all', session = null, options = {}) {
  const limit = Math.max(1, paginationNumber(options.limit, 50, 200));
  const offset = paginationNumber(options.offset, 0, 1_000_000);
  const cursor = parseLogCursor(options.cursor);
  const query = String(options.query || '').trim().slice(0, 120);
  const sources = [];
  if (category !== 'account') {
    sources.push(`SELECT 'countdown:' || id AS row_key, timestamp_ms AS timestamp, 'event' AS category,
      '赛事' AS type, action_label AS action, actor_display_name AS actor_name, actor_user_id,
      session_id, ip_address, region, device_fingerprint, device_name, user_agent, '计时' AS source,
      error, details_json, success, actor_identity_key, 0 AS sensitive
      FROM countdown_event_logs`);
    sources.push(`SELECT 'bp:' || seq AS row_key, timestamp_ms AS timestamp, 'event' AS category,
      '赛事' AS type, action, actor_display_name AS actor_name, actor_user_id, session_id,
      NULL AS ip_address, NULL AS region, NULL AS device_fingerprint, NULL AS device_name,
      NULL AS user_agent, 'BP' AS source, NULL AS error, details_json, 1 AS success,
      ${logIdentityExpression('bp_session_history')} AS actor_identity_key,
      0 AS sensitive FROM bp_session_history`);
    sources.push(`SELECT 'obs:' || id AS row_key, timestamp_ms AS timestamp, 'event' AS category,
      '赛事' AS type, label AS action, actor_display_name AS actor_name, actor_user_id,
      NULL AS session_id, NULL AS ip_address, NULL AS region, NULL AS device_fingerprint,
      NULL AS device_name, NULL AS user_agent, 'OBS' AS source, error, '{}' AS details_json,
      ok AS success, ${logIdentityExpression('obs_operation_logs')} AS actor_identity_key,
      0 AS sensitive FROM obs_operation_logs`);
    sources.push(`SELECT 'audit:' || id AS row_key, timestamp_ms AS timestamp, 'event' AS category,
      '赛事' AS type, action, actor_display_name AS actor_name, actor_user_id, session_id,
      ip_address, region, device_fingerprint, device_name, user_agent, '审计' AS source,
      error, details_json, success,
      ${logIdentityExpression('account_operation_logs')} AS actor_identity_key,
      sensitive FROM account_operation_logs
      WHERE category = 'event'`);
  }
  if (category !== 'event') {
    sources.push(`SELECT 'audit:' || id AS row_key, timestamp_ms AS timestamp, 'account' AS category,
      '账号' AS type, action, actor_display_name AS actor_name, actor_user_id, session_id,
      ip_address, region, device_fingerprint, device_name, user_agent, '账号审计' AS source,
      error, details_json, success,
      ${logIdentityExpression('account_operation_logs')} AS actor_identity_key,
      sensitive FROM account_operation_logs
      WHERE category = 'account'`);
  }
  const union = sources.join(' UNION ALL ');
  const filters = [];
  const filterParams = [];
  if (session && !canManageSystem(session)) {
    filters.push('actor_user_id = ?');
    filterParams.push(session.userId);
  }
  if (query) {
    filters.push(`(action LIKE ? OR actor_name LIKE ? OR COALESCE(session_id, '') LIKE ?
      OR COALESCE(details_json, '') LIKE ? OR COALESCE(actor_identity_key, '') LIKE ?)`);
    const pattern = `%${query}%`;
    filterParams.push(pattern, pattern, pattern, pattern, pattern);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const total = cursor
    ? null
    : db.prepare(`SELECT COUNT(*) AS n FROM (${union}) ${where}`).get(...filterParams).n;
  const pageFilters = [...filters];
  const pageParams = [...filterParams];
  if (cursor) {
    pageFilters.push('(timestamp < ? OR (timestamp = ? AND row_key < ?))');
    pageParams.push(cursor.timestamp, cursor.timestamp, cursor.rowKey);
  }
  const pageWhere = pageFilters.length ? `WHERE ${pageFilters.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM (${union}) ${pageWhere}
    ORDER BY timestamp DESC, row_key DESC LIMIT ? OFFSET ?`)
    .all(...pageParams, limit + 1, cursor ? 0 : offset);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const logs = pageRows.map(row => ({
    timestamp: row.timestamp,
    category: row.category,
    type: row.type,
    action: row.action,
    actorName: row.actor_name || '系统',
    actorUserId: row.actor_user_id || null,
    sessionId: row.session_id || undefined,
    ipAddress: row.ip_address || undefined,
    region: row.region || undefined,
    deviceFingerprint: row.device_fingerprint || undefined,
    deviceName: row.device_name || undefined,
    userAgent: row.user_agent || undefined,
    actorIdentityKey: row.actor_identity_key,
    sensitive: Boolean(row.sensitive),
    source: row.source,
    error: row.error || undefined,
    details: parseLogDetails(row.details_json),
    success: Boolean(row.success)
  }));
  return {
    logs,
    total,
    offset: cursor ? null : offset,
    limit,
    hasMore,
    nextCursor: hasMore && pageRows.length ? encodeLogCursor(pageRows.at(-1)) : null
  };
}

function currentRemaining(state) {
  if (!state.running || !state.deadline) {
    return Math.max(0, Number(state.remainingSeconds) || 0);
  }
  return Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
}

function normalizeSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.floor(number));
}

function applyCountdownAction(state, action) {
  const now = Date.now();
  const next = { ...state, updatedAt: now };

  if (action.type === 'set-duration') {
    const hours = normalizeSeconds(action.hours);
    const minutes = Math.min(59, normalizeSeconds(action.minutes));
    const seconds = Math.min(59, normalizeSeconds(action.seconds));
    const requestedSeconds = hours * 3600 + minutes * 60 + seconds;
    const durationSeconds = Math.min(Math.floor(Number.MAX_SAFE_INTEGER / 1000), requestedSeconds);
    next.mode = 'duration';
    next.durationSeconds = durationSeconds;
    next.targetAt = null;
    next.remainingSeconds = durationSeconds;
    next.running = durationSeconds > 0;
    next.startedAt = now;
    next.deadline = now + durationSeconds * 1000;
    return next;
  }

  if (action.type === 'set-target') {
    const targetMs = Date.parse(action.targetAt);
    if (!Number.isFinite(targetMs)) return next;
    next.mode = 'target';
    next.targetAt = new Date(targetMs).toISOString();
    next.durationSeconds = null;
    next.remainingSeconds = Math.max(0, Math.ceil((targetMs - now) / 1000));
    next.running = next.remainingSeconds > 0;
    next.startedAt = now;
    next.deadline = targetMs;
    return next;
  }

  if (action.type === 'start') {
    const remaining = next.mode === 'target' && next.targetAt
      ? Math.max(0, Math.ceil((Date.parse(next.targetAt) - now) / 1000))
      : currentRemaining(next);
    next.running = remaining > 0;
    next.remainingSeconds = remaining;
    next.startedAt = now;
    next.deadline = next.mode === 'target' && next.targetAt
      ? Date.parse(next.targetAt)
      : now + remaining * 1000;
    return next;
  }

  if (action.type === 'pause') {
    next.remainingSeconds = currentRemaining(next);
    next.running = false;
    next.startedAt = null;
    next.deadline = next.mode === 'target' && next.targetAt ? Date.parse(next.targetAt) : null;
    return next;
  }

  if (action.type === 'reset') {
    next.mode = 'duration';
    next.durationSeconds = 0;
    next.targetAt = null;
    next.running = false;
    next.startedAt = null;
    next.deadline = null;
    next.remainingSeconds = 0;
    return next;
  }

  return next;
}

// 单一入口：全部页面收敛到 /，地址栏始终只显示站点根地址；OBS 输出源地址保持不变
const OBS_PAGE_PATHS = new Set(['/overlay', '/overlay.html', '/bp-overlay', '/bp-overlay.html']);

function sendShell(res, file) {
  fs.readFile(path.resolve(ROOT, file), (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

function serveStatic(req, res, pathname) {
  if (pathname === '/') {
    sendShell(res, validateSession(getSessionToken(req)) ? 'control.html' : 'login.html');
    return;
  }
  if (OBS_PAGE_PATHS.has(pathname)) {
    sendShell(res, pathname.startsWith('/bp-overlay') ? 'bp-overlay.html' : 'overlay.html');
    return;
  }
  const looksLikePage = pathname.endsWith('.html') || !path.extname(pathname);
  if (looksLikePage && !pathname.startsWith('/api/')) {
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

function requiredPermission(req, pathname, url) {
  if (pathname === '/api/events' && req.method === 'GET') return 'operations.view';
  if (/^\/api\/events\/[^/]+\/media\/(logo|cover)$/.test(pathname)) return 'operations.view';
  if (pathname === '/api/events' || pathname.startsWith('/api/events/')) return 'events.manage';
  if (pathname.startsWith('/api/admin/characters')) return 'characterStats.manage';
  if (pathname.startsWith('/api/admin/notifications')) return 'notifications.publish';
  if (pathname.startsWith('/api/admin/permissions')) return 'permissions.manage';
  if (pathname.startsWith('/api/admin/accounts')) return 'accounts.manage';
  if (pathname.startsWith('/api/admin/laboratory-settings')) return 'system.manage';
  if (pathname.startsWith('/api/admin/system-access')) return 'system.manage';
  const operationsMatch = pathname.match(/^\/api\/operations\/([^/]+)$/);
  if (operationsMatch) {
    const view = operationsMatch[1];
    if (view === 'terminal') return 'system.status.view';
    if (MANAGEMENT_VIEWS.has(view)) return 'system.manage';
    if (view === 'resources') return 'materials.view';
    if (view === 'hud') return 'hud.view';
    if (view !== 'personal') return 'operations.view';
  }
  if (pathname === '/api/logs') {
    return url.searchParams.get('category') === 'account' ? 'logs.account.view' : 'logs.event.view';
  }
  if (pathname === '/api/character-stats') return 'characterStats.view';
  if (/^\/api\/characters\/[^/]+\/portrait$/.test(pathname)) return 'characterStats.view';
  if (/^\/api\/characters\/[^/]+\/skills\/[1-3]\/icon$/.test(pathname)) return 'characterStats.view';
  if (pathname.startsWith('/api/communications')) return 'communication.use';
  if (pathname === '/api/materials' && req.method === 'GET') return 'materials.view';
  if (pathname.startsWith('/api/materials') || pathname.startsWith('/api/material-paths')) return 'materials.manage';
  if (pathname === '/api/bracket-image') return 'bracket.publish';
  if (pathname.startsWith('/api/obs')) return req.method === 'GET' ? 'obs.view' : 'obs.manage';
  if (pathname === '/api/users/search' || pathname.startsWith('/api/friends')) return 'friends.manage';
  if (pathname === '/api/bp/timer-config') {
    return req.method === 'GET' ? 'countdown.operate' : 'bp.configure';
  }
  if (pathname === '/api/bp/presentation/settings') return 'bp.configure';
  if (pathname.startsWith('/api/bp')) {
    return req.method === 'GET' ? 'bp.view' : 'bp.operate';
  }
  if (pathname === '/api/hubs' || pathname.startsWith('/api/hubs/')) return 'countdown.operate';
  return null;
}

function timerPhaseMetadata() {
  return PHASES.map(phase => ({
    id: phase.id,
    label: phase.label,
    role: SLOT_CONFIG[phase.slots[0]]?.role || null
  }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const pathname = decodeURIComponent(url.pathname);

  // 登录态鉴权：API 默认要求有效会话；只豁免认证、系统接口与 OBS 确实需要的 SSE
  const publicObsEvents = req.method === 'GET' && (
    pathname === '/api/bp/presentation/events'
    || /^\/api\/hubs\/[^/]+\/events$/.test(pathname)
  );
  const authExempt = pathname.startsWith('/api/auth/')
    || pathname.startsWith('/api/system/')
    || publicObsEvents;
  const requestSession = validateSession(getSessionToken(req));
  applyRequestContext(requestSession, req);
  if (pathname.startsWith('/api/') && !authExempt && !requestSession) {
    sendJson(res, 401, { error: '未登录或会话已过期' });
    return;
  }
  const permission = pathname.startsWith('/api/') && !authExempt
    ? requiredPermission(req, pathname, url) : null;
  if (permission && !hasPermission(requestSession, permission)) {
    sendJson(res, 403, {
      code: 'PERMISSION_DENIED',
      permission,
      error: '当前身份没有执行此操作的权限'
    });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/system/health') {
    let version = 'unknown';
    try { version = readReleaseData().currentVersion; } catch {}
    sendJson(res, 200, {
      product: 'stella-director',
      version,
      status: 'ready',
      pid: process.pid,
      startedAt: STARTED_AT,
      dataDir: DATA_ROOT
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/auth/status') {
    sendJson(res, 200, { setupRequired: authSetupRequired() });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/setup') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      initializeCredentials(body.password);
      sendJson(res, 201, { ok: true });
    } catch (error) {
      sendJson(res, authSetupRequired() ? 400 : 409, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    try {
      if (authSetupRequired()) {
        sendJson(res, 409, { ok: false, setupRequired: true, error: '请先初始化开发者密码' });
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      let context = deviceContext(body, req, requestLocation(req));
      const portal = loginPortal(body.role);
      const attemptedRow = findUserRow(String(body.account || '').trim());
      const targetIdentityKey = attemptedRow
        ? identityKeysForUser(attemptedRow.id, attemptedRow.role)[0]
        : body.role === 'developer' ? 'administrator' : 'guest';
      const attemptedSession = {
        ...context,
        userId: attemptedRow?.id || null,
        role: attemptedRow?.role,
        permissions: attemptedRow ? JSON.parse(attemptedRow.permissions_json || '[]') : [],
        activeIdentityKey: targetIdentityKey,
        actorDisplayName: attemptedRow
          ? actorDisplayName(attemptedRow.id)
          : `未识别账号：${String(body.account || '').trim() || '空账号'}`
      };
      const user = verifyCredentials(body.account, body.password, portal);
      if (user?.disabled) {
        recordAuditLog('account', attemptedSession, '登录失败', {
          account: String(body.account || '').trim(), reason: '账号已停用', targetIdentityKey
        }, false, '账号已停用');
        sendJson(res, 403, {
          ok: false,
          code: 'ACCOUNT_DISABLED',
          error: '您的账号已被停用，请联系开发者/管理员进行账号恢复'
        });
        return;
      }
      if (!user) {
        recordAuditLog('account', attemptedSession, '登录失败', {
          account: String(body.account || '').trim(), reason: '账号或密码错误', targetIdentityKey
        }, false, '账号或密码错误');
        sendJson(res, 401, {
          ok: false,
          code: portal.invalidCode,
          error: portal.invalidMessage
        });
        return;
      }
      const rejectClosedSystemLogin = () => {
        recordAuditLog('account', attemptedSession, '登录失败', {
          account: String(body.account || '').trim(), reason: '系统暂未开放用户登录', targetIdentityKey
        }, false, '系统暂未开放用户登录');
        sendJson(res, 403, {
          ok: false,
          code: 'SYSTEM_ACCESS_CLOSED',
          error: '系统暂未开放用户登录，请联系管理员'
        });
      };
      if (!systemAccessOpen() && !hasSystemManagementEntitlement(user)) {
        rejectClosedSystemLogin();
        return;
      }
      context = deviceContext(body, req, await resolveRequestLocation(req));
      if (!systemAccessOpen() && !hasSystemManagementEntitlement(user)) {
        rejectClosedSystemLogin();
        return;
      }
      const { session, replacedSessions } = createSession(user, body.remember, context);
      recordUserLogin(user.id, context);
      connectPresence(user.id);
      recordAuditLog('account', session, '登录系统', {
        account: user.account,
        targetIdentityKey,
        replacedSessionCount: replacedSessions.length,
        replacedOtherDevice: replacedSessions.some(item => item.deviceFingerprint !== context.deviceFingerprint)
      });
      res.setHeader('Set-Cookie', sessionCookie(session.token, body.remember, secureRequest(req)));
      sendJson(res, 200, {
        ok: true,
        role: user.role,
        account: user.account,
        replacedSessionCount: replacedSessions.length
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/auth/session') {
    const session = validateSession(getSessionToken(req));
    sendJson(res, 200, session
      ? { authenticated: true, role: session.role, account: session.account,
        identityKeys: session.identityKeys || identityKeysForUser(session.userId, session.role),
        activeIdentityKey: session.activeIdentityKey }
      : { authenticated: false });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const session = validateSession(getSessionToken(req));
    if (session) {
      disconnectPresence(session.userId);
      recordAuditLog('account', session, '退出系统');
    }
    destroySession(getSessionToken(req));
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/session/events') {
    const token = getSessionToken(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const removeClient = addSessionEventClient(token, res);
    res.write(`event: session-state\ndata: ${JSON.stringify({ authenticated: true })}\n\n`);
    req.on('close', removeClient);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/presence/heartbeat') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      sendJson(res, 200, recordPresenceHeartbeat(requestSession.userId, body));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/presence/disconnect') {
    sendJson(res, 200, disconnectPresence(requestSession.userId));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/presence/preference') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!PRESENCE_PREFERENCES.has(body.preference)) throw new Error('在线状态设置无效');
      const snapshot = setManualPresence(requestSession.userId, body.preference);
      recordAuditLog('account', requestSession, '切换在线状态', { preference: snapshot.preference });
      sendJson(res, 200, snapshot);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/presence/work') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      sendJson(res, 200, setWorkingPresence(
        requestSession.userId,
        Boolean(body.active),
        body.contextId
      ));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/profile') {
    try {
      sendJson(res, 200, readUserProfile(requestSession));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const operationsMatch = pathname.match(/^\/api\/operations\/([^/]+)$/);
  if (req.method === 'GET' && operationsMatch) {
    try {
      const view = operationsMatch[1];
      const runtime = {
        pid: process.pid,
        node: process.version,
        platform: process.platform,
        uptimeSeconds: process.uptime(),
        startedAt: STARTED_AT,
        memory: process.memoryUsage(),
        activeSessions: loadSessions().filter(item => item.expiresAt > Date.now()).length,
        communicationStreams: communicationClients.size,
        notificationStreams: notificationClients.size,
        presentationStreams: bpPresentationClients.size,
        systemOpen: systemAccessOpen(),
        obs: obsController.status()
      };
      sendJson(res, 200, operationsView(db, view, {
        userId: requestSession.userId,
        today: url.searchParams.get('today') || undefined,
        query: url.searchParams.get('query') || '',
        eventId: url.searchParams.get('eventId') || '',
        division: url.searchParams.get('division') || '',
        role: url.searchParams.get('role') || '',
        teamId: url.searchParams.get('teamId') || '',
        limit: url.searchParams.get('limit') || undefined,
        offset: url.searchParams.get('offset') || undefined,
        runtime
      }));
    } catch (error) {
      sendJson(res, error.code === 'OPERATIONS_VIEW_NOT_FOUND' ? 404 : 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    try {
      sendJson(res, 200, {
        ...managedEventSnapshot(db, url.searchParams.get('filter') || 'all'),
        canManage: hasPermission(requestSession, 'events.manage')
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/events') {
    try {
      const body = JSON.parse((await readBody(req, 10 * 1024 * 1024)) || '{}');
      const event = createManagedEvent(db, body, requestSession.userId);
      recordAuditLog('account', requestSession, '创建赛事', { eventId: event.id, name: event.name });
      sendJson(res, 201, { event });
    } catch (error) {
      recordAuditLog('account', requestSession, '创建赛事', {}, false, error.message);
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const eventMediaMatch = pathname.match(/^\/api\/events\/([^/]+)\/media\/(logo|cover)$/);
  if (req.method === 'GET' && eventMediaMatch) {
    try {
      const media = readEventMedia(db, eventMediaMatch[1], eventMediaMatch[2]);
      if (!media) {
        sendJson(res, 404, { error: '赛事媒体不存在' });
        return;
      }
      const etag = `"${media.sha256}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable' });
        res.end();
        return;
      }
      const data = Buffer.from(media.data);
      res.writeHead(200, {
        'Content-Type': media.mime_type,
        'Content-Length': data.length,
        'Cache-Control': 'private, max-age=31536000, immutable',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(data);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const eventManageMatch = pathname.match(/^\/api\/events\/([^/]+)$/);
  if (req.method === 'PUT' && eventManageMatch) {
    try {
      const body = JSON.parse((await readBody(req, 10 * 1024 * 1024)) || '{}');
      const event = updateManagedEvent(db, eventManageMatch[1], body, requestSession.userId);
      recordAuditLog('account', requestSession, '修改赛事', { eventId: event.id, name: event.name });
      sendJson(res, 200, { event });
    } catch (error) {
      recordAuditLog('account', requestSession, '修改赛事', { eventId: eventManageMatch[1] }, false, error.message);
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const eventActionMatch = pathname.match(/^\/api\/events\/([^/]+)\/actions$/);
  if (req.method === 'POST' && eventActionMatch) {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const event = applyEventAction(db, eventActionMatch[1], body.action);
      const labels = { start: '手动开始赛事', end: '手动结束赛事', 'toggle-mark': '切换赛事标记' };
      recordAuditLog('account', requestSession, labels[body.action] || '操作赛事', {
        eventId: event.id, name: event.name, marked: event.marked, status: event.status
      });
      sendJson(res, 200, { event });
    } catch (error) {
      recordAuditLog('account', requestSession, '操作赛事', { eventId: eventActionMatch[1] }, false, error.message);
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const publicProfileMatch = pathname.match(/^\/api\/profiles\/([^/]+)$/);
  if (req.method === 'GET' && publicProfileMatch) {
    try {
      sendJson(res, 200, readUserProfile(requestSession, publicProfileMatch[1]));
    } catch (error) {
      sendJson(res, 404, { error: error.message });
    }
    return;
  }

  const profileMediaMatch = pathname.match(/^\/api\/profiles\/([^/]+)\/(avatar|cover)$/);
  const legacyAvatar = pathname === '/api/profile/avatar';
  if (req.method === 'GET' && (profileMediaMatch || legacyAvatar)) {
    const userId = legacyAvatar ? requestSession.userId : profileMediaMatch[1];
    const type = legacyAvatar ? 'avatar' : profileMediaMatch[2];
    const mediaOwner = db.prepare('SELECT status FROM users WHERE id = ?').get(userId);
    if (!mediaOwner || (mediaOwner.status !== 'active' && !canManageSystem(requestSession))) {
      sendJson(res, 404, { error: '用户不存在或账号不可用' });
      return;
    }
    const media = readProfileMedia(userId, type);
    if (!media) {
      sendJson(res, 404, { error: type === 'cover' ? '用户尚未设置主页顶置图' : '用户尚未设置头像' });
      return;
    }
    const etag = `"${media.sha256}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, {
        ETag: etag,
        'Cache-Control': 'private, max-age=31536000, immutable'
      });
      res.end();
      return;
    }
    const data = Buffer.from(media.data);
    res.writeHead(200, {
      'Content-Type': media.mime_type,
      'Content-Length': data.length,
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
    return;
  }

  if (req.method === 'PUT' && pathname === '/api/profile') {
    try {
      const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)) || '{}');
      const sensitiveFields = [];
      if (String(body.account || '').trim() && String(body.account).trim() !== requestSession.account) {
        sensitiveFields.push('account');
      }
      if (body.newPassword) sensitiveFields.push('password');
      const profile = saveUserProfile(requestSession, body);
      recordAuditLog('account', requestSession, '修改个人资料', {
        fields: ['displayName', 'title', 'bio', 'gender', 'birthDate', 'presencePreference', 'visibleStats'],
        sensitiveFields
      });
      sendJson(res, 200, profile);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/profile/identity') {
    let targetIdentityKey = '';
    const previousIdentityKey = requestSession.activeIdentityKey;
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      targetIdentityKey = String(body.identityKey || '');
      const profile = switchIdentity(requestSession, targetIdentityKey);
      recordAuditLog('account', requestSession, '切换账号身份', {
        actorIdentityKey: previousIdentityKey,
        previousIdentityKey,
        identityKey: profile.activeIdentityKey,
        sessionAuthenticated: true
      });
      sendJson(res, 200, profile);
    } catch (error) {
      recordAuditLog('account', requestSession, '切换账号身份失败', {
        actorIdentityKey: previousIdentityKey,
        previousIdentityKey,
        identityKey: targetIdentityKey,
        reasonCode: error.code || 'IDENTITY_SWITCH_INVALID'
      }, false, error.message);
      sendJson(res, 400, {
        code: error.code || 'IDENTITY_SWITCH_INVALID',
        error: error.message
      });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/notifications/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive'
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ connected: true })}\n\n`);
    const client = { token: getSessionToken(req), res };
    notificationClients.add(client);
    req.on('close', () => notificationClients.delete(client));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/notifications') {
    try {
      ensureVersionNotification(db, readReleaseData());
    } catch {}
    sendJson(res, 200, listNotifications(db, requestSession.userId, {
      offset: url.searchParams.get('offset'),
      limit: url.searchParams.get('limit')
    }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/notifications/read-all') {
    const result = markAllNotificationsRead(db, requestSession.userId);
    broadcastNotification({ type: 'read', targetUserIds: [requestSession.userId], ...result });
    sendJson(res, 200, result);
    return;
  }

  const notificationReadMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (notificationReadMatch && req.method === 'POST') {
    try {
      const result = markNotificationRead(db, requestSession.userId, notificationReadMatch[1]);
      broadcastNotification({ type: 'read', notificationId: notificationReadMatch[1],
        targetUserIds: [requestSession.userId], unreadCount: result.unreadCount,
        urgentUnreadCount: result.urgentUnreadCount });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 404, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/users/search') {
    sendJson(res, 200, { users: searchUsers(requestSession, url.searchParams.get('q')) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/friends') {
    sendJson(res, 200, listFriends(requestSession));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/friends/requests') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const targetUserId = String(body.userId || '');
      const result = requestFriend(requestSession, targetUserId);
      const notification = createNotification(db, {
        type: 'friend_request',
        title: `${requestSession.actorDisplayName || actorDisplayName(requestSession.userId)} 请求添加你为好友`,
        summary: '新的好友申请等待处理',
        body: '你可以前往好友列表接受或处理这条申请。',
        sourceKind: 'friend_request',
        sourceId: `${requestSession.userId}:${targetUserId}:${Date.now()}`,
        targetKind: 'account',
        targetValue: targetUserId,
        createdByUserId: requestSession.userId,
        createdByIdentityKey: requestSession.activeIdentityKey
      }, [targetUserId]);
      recordAuditLog('account', requestSession, '发送好友请求', { targetUserId });
      broadcastCommunication({
        type: 'friend-request', channelId: null, messageId: null,
        targetUserIds: [requestSession.userId, targetUserId]
      });
      if (notification) broadcastNotification({
        type: 'created', notificationId: notification.id, urgent: false, targetUserIds: [targetUserId]
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const friendActionMatch = pathname.match(/^\/api\/friends\/([^/]+)(?:\/(accept))?$/);
  if (friendActionMatch && req.method === 'POST' && friendActionMatch[2] === 'accept') {
    try {
      const result = acceptFriend(requestSession, friendActionMatch[1]);
      recordAuditLog('account', requestSession, '接受好友请求', { targetUserId: friendActionMatch[1] });
      broadcastCommunication({
        type: 'friend-updated', channelId: null, messageId: null,
        targetUserIds: [requestSession.userId, friendActionMatch[1]]
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }
  if (friendActionMatch && req.method === 'DELETE' && !friendActionMatch[2]) {
    const result = removeFriend(requestSession, friendActionMatch[1]);
    recordAuditLog('account', requestSession, '移除好友关系', { targetUserId: friendActionMatch[1] });
    broadcastCommunication({
      type: 'friend-updated', channelId: null, messageId: null,
      targetUserIds: [requestSession.userId, friendActionMatch[1]]
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/communications/bootstrap') {
    try {
      sendJson(res, 200, communicationBootstrap(db, requestSession, url.searchParams.get('channelId')));
    } catch (error) {
      sendJson(res, 400, { code: error.code, error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/communications/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive'
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ connected: true })}\n\n`);
    const client = { token: getSessionToken(req), res };
    communicationClients.add(client);
    req.on('close', () => communicationClients.delete(client));
    return;
  }

  const communicationMessagesMatch = pathname.match(/^\/api\/communications\/channels\/([^/]+)\/messages$/);
  if (communicationMessagesMatch && req.method === 'GET') {
    try {
      sendJson(res, 200, listMessages(db, requestSession, communicationMessagesMatch[1], {
        before: url.searchParams.get('before'),
        after: url.searchParams.get('after'),
        unread: url.searchParams.get('unread') === '1',
        limit: url.searchParams.get('limit'),
        markRead: url.searchParams.get('markRead') !== '0'
      }));
    } catch (error) {
      sendJson(res, error.code === 'CHANNEL_FORBIDDEN' ? 403 : 400, { code: error.code, error: error.message });
    }
    return;
  }

  if (communicationMessagesMatch && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const message = sendMessage(db, requestSession, communicationMessagesMatch[1], body.content);
      const notification = createMessageNotification(db, message, false);
      const targetUserIds = channelRecipientUserIds(db, message.channelId, requestSession.userId);
      broadcastCommunication({ type: 'message', channelId: message.channelId, messageId: message.id });
      if (notification) broadcastNotification({
        type: 'created', notificationId: notification.id, urgent: false, targetUserIds
      });
      sendJson(res, 201, { message });
    } catch (error) {
      sendJson(res, error.code === 'CHANNEL_FORBIDDEN' ? 403 : 400, { code: error.code, error: error.message });
    }
    return;
  }

  const communicationMessageActionMatch = pathname.match(
    /^\/api\/communications\/messages\/(\d+)(?:\/(recall|plus-one|urgent))?$/
  );
  if (communicationMessageActionMatch) {
    const messageId = Number(communicationMessageActionMatch[1]);
    const action = communicationMessageActionMatch[2] || '';
    try {
      if (req.method === 'PATCH' && !action) {
        const body = JSON.parse((await readBody(req)) || '{}');
        const message = editMessage(db, requestSession, messageId, body.content);
        broadcastCommunication({ type: 'message-updated', channelId: message.channelId, messageId });
        sendJson(res, 200, { message });
        return;
      }
      if (req.method === 'DELETE' && !action) {
        const result = deleteMessageForUser(db, requestSession, messageId);
        broadcastCommunication({
          type: 'message-deleted', channelId: result.channelId, messageId,
          targetUserIds: [requestSession.userId]
        });
        sendJson(res, 200, result);
        return;
      }
      if (req.method === 'POST' && action === 'recall') {
        const message = recallMessage(db, requestSession, messageId);
        broadcastCommunication({ type: 'message-recalled', channelId: message.channelId, messageId });
        sendJson(res, 200, { message });
        return;
      }
      if (req.method === 'POST' && action === 'plus-one') {
        const message = toggleMessagePlusOne(db, requestSession, messageId);
        broadcastCommunication({ type: 'message-reaction', channelId: message.channelId, messageId });
        sendJson(res, 200, { message });
        return;
      }
      if (req.method === 'POST' && action === 'urgent') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const message = setMessageUrgent(db, requestSession, messageId, Boolean(body.urgent));
        const notification = syncMessageUrgency(db, message);
        const targetUserIds = channelRecipientUserIds(db, message.channelId, requestSession.userId);
        broadcastCommunication({ type: 'message-urgent', channelId: message.channelId, messageId });
        if (notification) broadcastNotification({
          type: 'updated', notificationId: notification.id, urgent: message.urgent, targetUserIds
        });
        sendJson(res, 200, { message });
        return;
      }
    } catch (error) {
      const forbidden = error.code === 'CHANNEL_FORBIDDEN' || error.code === 'MESSAGE_FORBIDDEN';
      sendJson(res, forbidden ? 403 : 400, { code: error.code, error: error.message });
      return;
    }
  }

  const communicationReadMatch = pathname.match(/^\/api\/communications\/channels\/([^/]+)\/read$/);
  if (communicationReadMatch && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const result = markChannelRead(db, requestSession, communicationReadMatch[1], body.messageId);
      markChannelNotificationsRead(db, requestSession.userId, communicationReadMatch[1], body.messageId);
      broadcastNotification({ type: 'read', targetUserIds: [requestSession.userId] });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.code === 'CHANNEL_FORBIDDEN' ? 403 : 400, { code: error.code, error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/communications/private') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const channel = createPrivateChannel(db, requestSession, body.userId);
      broadcastCommunication({ type: 'channel-created', channelId: channel.id, messageId: null });
      sendJson(res, 201, { channel });
    } catch (error) {
      sendJson(res, 400, { code: error.code, error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/communications/channels') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const channel = createCustomChannel(db, requestSession, body);
      recordAuditLog('account', requestSession, '创建通讯频道', {
        channelId: channel.id,
        channelName: channel.name,
        memberCount: channel.memberCount
      });
      broadcastCommunication({ type: 'channel-created', channelId: channel.id, messageId: null });
      sendJson(res, 201, { channel });
    } catch (error) {
      sendJson(res, 400, { code: error.code, error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/notifications') {
    const published = listPublishedNotifications(db, {
      offset: url.searchParams.get('offset'),
      limit: url.searchParams.get('limit')
    });
    const accounts = db.prepare(`SELECT id, username, display_name, status FROM users
      ORDER BY display_name COLLATE NOCASE, username COLLATE NOCASE`).all().map(row => ({
      id: row.id,
      account: row.username,
      displayName: row.display_name || row.username,
      status: row.status
    }));
    sendJson(res, 200, {
      ...published,
      accounts,
      identities: Object.entries(IDENTITY_LABELS).map(([key, label]) => ({ key, label }))
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/notifications') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const result = publishNotification(db, requestSession, body);
      recordAuditLog('account', requestSession, '发布系统通知', {
        notificationId: result.notification?.id,
        targetKind: body.target?.kind || body.targetKind,
        targetValue: body.target?.value || body.targetValue,
        urgent: Boolean(body.urgent),
        recipientCount: result.recipientUserIds.length
      });
      if (result.notification) broadcastNotification({
        type: 'created',
        notificationId: result.notification.id,
        urgent: result.notification.urgent,
        summary: result.notification.summary,
        title: result.notification.title,
        targetUserIds: result.recipientUserIds
      });
      sendJson(res, 201, {
        notification: result.notification,
        recipientCount: result.recipientUserIds.length
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/permissions') {
    sendJson(res, 200, permissionCenterSnapshot());
    return;
  }

  const identityPermissionMatch = pathname.match(/^\/api\/admin\/permissions\/identities\/([^/]+)$/);
  if (identityPermissionMatch && req.method === 'PUT') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const result = saveIdentityPermissions(
        identityPermissionMatch[1], body.permissions, requestSession.userId
      );
      const sessions = loadSessions();
      sessions.forEach(item => { item.permissions = effectivePermissionDetails(item).effective; });
      saveSessions(sessions);
      recordAuditLog('account', requestSession, '修改身份权限', {
        identityKey: result.identityKey,
        permissionCount: result.permissions.length
      });
      sendJson(res, 200, permissionCenterSnapshot());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const accountPermissionMatch = pathname.match(/^\/api\/admin\/permissions\/accounts\/([^/]+)$/);
  if (accountPermissionMatch && req.method === 'PUT') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const result = saveAccountOverrides(
        accountPermissionMatch[1], body.grants, body.denies, requestSession.userId
      );
      const sessions = loadSessions();
      sessions.filter(item => item.userId === result.userId)
        .forEach(item => { item.permissions = effectivePermissionDetails(item).effective; });
      saveSessions(sessions);
      recordAuditLog('account', requestSession, '修改账号权限', {
        targetUserId: result.userId,
        grantCount: result.grants.length,
        denyCount: result.denies.length
      });
      sendJson(res, 200, permissionCenterSnapshot());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/system-access') {
    sendJson(res, 200, systemAccessPolicy());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/laboratory-settings') {
    sendJson(res, 200, laboratorySettings(db));
    return;
  }

  if (req.method === 'PUT' && pathname === '/api/admin/laboratory-settings') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const settings = saveLaboratorySettings(db, body);
      recordAuditLog('account', requestSession,
        settings.newBpInterface ? '启用新版 BP 界面' : '停用新版 BP 界面', settings);
      sendJson(res, 200, settings);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'PUT' && pathname === '/api/admin/system-access') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const policy = saveSystemAccessPolicy(body.open);
      const revoked = policy.open
        ? { revokedSessionCount: 0, revokedUserCount: 0 }
        : revokeNonManagementSessions();
      recordAuditLog('account', requestSession, policy.open ? '开放系统用户登录' : '关闭系统用户登录', {
        open: policy.open,
        ...revoked
      });
      sendJson(res, 200, policy);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/accounts') {
    sendJson(res, 200, { accounts: listManagedAccounts(requestSession) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/accounts') {
    try {
      const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)) || '{}');
      const account = createManagedAccount(requestSession, body);
      recordAuditLog('account', requestSession, '创建账号', { targetUserId: account.id, account: account.account });
      sendJson(res, 201, account);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/accounts/import') {
    try {
      const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)) || '{}');
      const result = importManagedAccounts(requestSession, body.accounts);
      recordAuditLog('account', requestSession, '批量导入账号', {
        imported: result.imported.length, rejected: result.rejected.length
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/accounts/bulk-status') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const result = bulkUpdateManagedAccountStatus(requestSession, body.ids, body.status);
      recordAuditLog('account', requestSession, '批量变更账号状态', {
        status: body.status, count: result.changed
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/accounts/bulk-delete') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const result = bulkDeleteManagedAccounts(requestSession, body.ids);
      recordAuditLog('account', requestSession, '批量删除账号', { count: result.deleted });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const managedAccountMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]+)$/);
  if (managedAccountMatch && req.method === 'PUT') {
    try {
      const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)) || '{}');
      const account = updateManagedAccount(requestSession, managedAccountMatch[1], body);
      recordAuditLog('account', requestSession, '修改账号', { targetUserId: managedAccountMatch[1], account: account.account });
      sendJson(res, 200, account);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }
  if (managedAccountMatch && req.method === 'DELETE') {
    try {
      deleteManagedAccount(requestSession, managedAccountMatch[1]);
      recordAuditLog('account', requestSession, '删除账号', { targetUserId: managedAccountMatch[1] });
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }
  const titleReviewMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]+)\/title-review$/);
  if (titleReviewMatch && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const account = reviewTitleRequest(requestSession, titleReviewMatch[1], body.decision);
      recordAuditLog('account', requestSession, body.decision === 'approved' ? '批准岗位申请' : '驳回岗位申请', {
        targetUserId: titleReviewMatch[1]
      });
      sendJson(res, 200, account);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/system/shutdown') {
    if (!CONTROL_TOKEN || req.headers['x-stella-token'] !== CONTROL_TOKEN) {
      sendJson(res, 403, { error: '控制令牌无效' });
      return;
    }
    sendJson(res, 202, { shuttingDown: true });
    setTimeout(() => {
      server.close(() => process.exit(0));
      shutdown();
    }, 50).unref?.();
    return;
  }

  if (req.method === 'POST' && pathname === '/api/hubs') {
    const id = COUNTDOWN_HUB_ID;
    ensureHub(id);
    sendJson(res, 201, {
      id,
      controlUrl: `/control.html?hub=${id}`,
      overlayUrl: `/hub/${id}`
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/materials') {
    sendJson(res, 200, materialLibrary.listPage({
      forceSync: url.searchParams.get('sync') === '1',
      directoryId: url.searchParams.get('directory') || null,
      query: url.searchParams.get('q') || '',
      offset: url.searchParams.get('offset'),
      limit: url.searchParams.get('limit')
    }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/material-paths/status') {
    try {
      sendJson(res, 200, await obsPathMigration.status());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/material-paths/validate') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      sendJson(res, 200, await obsPathMigration.validate(body.folderId));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/material-paths/sync') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      sendJson(res, 200, await obsPathMigration.sync(body.folderId));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/material-paths/rollback') {
    try {
      sendJson(res, 200, await obsPathMigration.rollback());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/update-log') {
    try {
      sendJson(res, 200, readReleaseData());
    } catch (error) {
      sendJson(res, 500, { error: `更新日志读取失败: ${error.message}` });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/materials/import') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const mode = body.kind === 'folder' ? 'folder' : 'files';
      const paths = await pickMaterialPaths(mode);
      if (!paths.length) {
        sendJson(res, 200, { cancelled: true, added: 0, skipped: 0 });
        return;
      }
      sendJson(res, 200, materialLibrary.addPaths(paths));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/materials/select-folder') {
    try {
      const paths = await pickMaterialPaths('folder');
      sendJson(res, 200, { path: paths[0] || null, cancelled: !paths.length });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/materials/documents') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      sendJson(res, 201, materialLibrary.createDocument(body.directoryPath, body.name));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const materialContentMatch = pathname.match(/^\/api\/materials\/([^/]+)\/content$/);
  if (req.method === 'GET' && materialContentMatch) {
    try {
      const entry = materialLibrary.entry(materialContentMatch[1]);
      const stat = fs.statSync(entry.path);
      if (!stat.isFile()) throw new Error('文件夹不能预览');
      const contentType = MATERIAL_CONTENT_TYPES.get(path.extname(entry.path).toLocaleLowerCase('en-US')) || 'application/octet-stream';
      const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      let start = 0;
      let end = stat.size - 1;
      if (range) {
        start = range[1] ? Number(range[1]) : 0;
        end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= stat.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
          res.end();
          return;
        }
      }
      const headers = {
        'Content-Type': contentType,
        'Content-Length': end - start + 1,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(entry.path))}`,
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
        'X-Content-Type-Options': 'nosniff'
      };
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      res.writeHead(range ? 206 : 200, headers);
      fs.createReadStream(entry.path, { start, end }).pipe(res);
    } catch (error) {
      sendJson(res, 404, { error: error.message });
    }
    return;
  }

  const materialActionMatch = pathname.match(/^\/api\/materials\/([^/]+)\/(rename|delete)$/);
  if (req.method === 'POST' && materialActionMatch) {
    try {
      const [, id, action] = materialActionMatch;
      const body = JSON.parse((await readBody(req)) || '{}');
      const result = action === 'rename'
        ? materialLibrary.rename(id, body.name)
        : materialLibrary.remove(id, body.mode);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const materialOpenMatch = pathname.match(/^\/api\/materials\/([^/]+)\/open$/);
  if (req.method === 'POST' && materialOpenMatch) {
    try {
      const entry = materialLibrary.entry(materialOpenMatch[1]);
      if (!fs.existsSync(entry.path)) throw new Error('文件或文件夹已经不存在');
      await openMaterialPath(entry.path);
      sendJson(res, 200, { opened: true, id: entry.id });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/materials/bulk-delete') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      sendJson(res, 200, materialLibrary.removeMany(body.ids, body.mode));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/window/maximize') {
    execFile('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WINDOW_CONTROL_SCRIPT
    ], { windowsHide: true, timeout: 3000 }, error => {
      if (error) sendJson(res, 500, { error: error.message });
      else sendJson(res, 200, { maximized: true });
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bp/bootstrap') {
    sendJson(res, 200, {
      tournament: tournamentResolver.data,
      schedules: tournamentResolver.schedules,
      characters: { escape: ESCAPE_CHARACTERS, hunter: HUNTER_CHARACTERS },
      phases: PHASES,
      slots: SLOT_CONFIG,
      ui: CONFIG.ui,
      timer: { ...CONFIG.timer, phaseDurations: phaseDurations(), animationStyle: animationStyle() },
      commentatorImages: commentatorImages().map(({ filePath, ...image }) => image),
      commentatorImage: activeCommentatorImage
        ? { id: activeCommentatorImage.id, name: activeCommentatorImage.name }
        : null,
      commentatorLogoImages: commentatorLogoImages().map(({ filePath, ...image }) => image),
      commentatorLogoImage: activeCommentatorLogoImage
        ? { id: activeCommentatorLogoImage.id, name: activeCommentatorLogoImage.name }
        : null,
      sessions: bpService.listSessionSummaries(),
      obs: obsController.status(),
      dynamicBp: presentationStatus(),
      laboratory: laboratorySettings(db)
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bp/commentator-image') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const image = commentatorImage(body.imageId);
      await obsController.syncCommentatorImage(image.filePath);
      updateCommentatorImageId(image.id);
      activeCommentatorImage = image;
      bpService.setGlobalCommentatorImage(image);
      sendJson(res, 200, { id: image.id, name: image.name });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bp/commentator-logo-image') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const image = commentatorLogoImage(body.imageId);
      await obsController.syncCommentatorLogo(image.filePath);
      updateCommentatorLogoImageId(image.id);
      activeCommentatorLogoImage = image;
      sendJson(res, 200, { id: image.id, name: image.name });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bp/presentation') {
    sendJson(res, 200, presentationStatus());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bp/presentation/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    });
    bpPresentationClients.add(res);
    res.write(`event: presentation\ndata: ${JSON.stringify(presentationStatus('connected'))}\n\n`);
    broadcastBp('bp-presentation', presentationStatus('client-connected'));
    req.on('close', () => {
      bpPresentationClients.delete(res);
      broadcastBp('bp-presentation', presentationStatus('client-disconnected'));
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bp/presentation/settings') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const enabled = Boolean(body.enabled);
      let obsError = null;
      bpPresentation.setEnabled(enabled);
      await obsController.configureBpOverlay({ url: BP_OVERLAY_URL, enabled })
        .catch(error => { obsError = error.message; });
      sendJson(res, 200, { ...presentationStatus(), obsSynced: !obsError, obsError });
    } catch (error) {
      sendJson(res, 400, { error: error.message, ...presentationStatus() });
    }
    return;
  }

  if (pathname === '/api/bp/timer-config' && req.method === 'GET') {
    sendJson(res, 200, {
      phases: timerPhaseMetadata(),
      phaseDurations: phaseDurations(),
      animationStyle: animationStyle()
    });
    return;
  }

  if (pathname === '/api/bp/timer-config' && req.method === 'POST') {
    let body = {};
    const beforeSettings = {
      phaseDurations: phaseDurations(),
      animationStyle: animationStyle()
    };
    try {
      body = JSON.parse((await readBody(req)) || '{}');
      const settings = updateBpTimerConfig(body);
      bpPresentation.commit('animation-style-updated');
      const eventLog = recordCountdownEvent(COUNTDOWN_HUB_ID, requestSession,
        { type: 'update-bp-timer-config', ...body }, beforeSettings, settings);
      broadcastCountdownLog(ensureHub(COUNTDOWN_HUB_ID), eventLog);
      sendJson(res, 200, {
        phases: timerPhaseMetadata(),
        ...settings,
        eventLog
      });
    } catch (error) {
      recordCountdownEvent(COUNTDOWN_HUB_ID, requestSession,
        { type: 'update-bp-timer-config', ...body }, beforeSettings, null, false, error.message);
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bracket-image') {
    try {
      const buffer = await readBuffer(req);
      const extension = imageExtension(req.headers['content-type']);
      const stamp = beijingTimestamp();
      const saved = writeImage(CONFIG.assets.bracketUploadRoot, `手游赛区-${stamp}`, extension, buffer);
      const obsSynced = await obsController.syncBracketImage(saved.filePath)
        .then(() => obsController.switchScene('bracket'))
        .then(() => true, () => false);
      sendJson(res, 200, { ...saved, obsSynced });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const resultImageMatch = pathname.match(/^\/api\/bp\/sessions\/([^/]+)\/result-image$/);
  if (req.method === 'POST' && resultImageMatch) {
    try {
      const id = resultImageMatch[1];
      const current = bpService.serialize(bpService.getSession(id));
      if (!current.result?.winnerRole) throw new Error('请先选择本局战果');
      const buffer = await readBuffer(req);
      const extension = imageExtension(req.headers['content-type']);
      const saved = writeImage(
        CONFIG.assets.resultUploadRoot,
        `${divisionLabel(current.matchId)}-${chineseRound(current.matchId)}-MATCH ${current.gameNumber}-${current.room}房`,
        extension,
        buffer
      );
      const session = bpService.setResultImage(id, saved);
      const obsSynced = await obsController.syncResult(session)
        .then(() => obsController.syncResultImage(saved.filePath))
        .then(() => obsController.switchScene('result'))
        .then(() => true, () => false);
      sendJson(res, 200, { session, ...saved, obsSynced });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/logs') {
    sendJson(res, 200, pagedLogs(url.searchParams.get('category') || 'all', requestSession, {
      offset: url.searchParams.get('offset'),
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
      query: url.searchParams.get('q')
    }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/character-stats') {
    const division = url.searchParams.get('division') || 'all';
    if (!['all', 'pc', 'pe'].includes(division)) {
      sendJson(res, 400, { error: '无效的排行榜范围' });
      return;
    }
    sendJson(res, 200, calculateCharacterStats(db, division));
    return;
  }

  const characterPortraitMatch = pathname.match(/^\/api\/characters\/([^/]+)\/portrait$/);
  if (req.method === 'GET' && characterPortraitMatch) {
    try {
      const portrait = readCharacterPortrait(db, decodeURIComponent(characterPortraitMatch[1]));
      if (!portrait) {
        sendJson(res, 404, { error: '角色尚未设置托管头像' });
        return;
      }
      const etag = `"${portrait.sha256}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable' });
        res.end();
        return;
      }
      const data = Buffer.from(portrait.data);
      res.writeHead(200, {
        'Content-Type': portrait.mime_type,
        'Content-Length': data.length,
        'Cache-Control': 'private, max-age=31536000, immutable',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(data);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const characterSkillIconMatch = pathname.match(/^\/api\/characters\/([^/]+)\/skills\/([1-3])\/icon$/);
  if (req.method === 'GET' && characterSkillIconMatch) {
    try {
      const icon = readCharacterSkillIcon(
        db,
        decodeURIComponent(characterSkillIconMatch[1]),
        characterSkillIconMatch[2]
      );
      if (!icon) {
        sendJson(res, 404, { error: '角色技能尚未设置托管图标' });
        return;
      }
      const etag = `"${icon.sha256}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable' });
        res.end();
        return;
      }
      const data = Buffer.from(icon.data);
      res.writeHead(200, {
        'Content-Type': icon.mime_type,
        'Content-Length': data.length,
        'Cache-Control': 'private, max-age=31536000, immutable',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(data);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/characters') {
    try {
      const body = JSON.parse((await readBody(req, 6 * 1024 * 1024)) || '{}');
      const { id, portraitUrl, ...safeBody } = body;
      const character = createCharacter(db, safeBody);
      reloadCharacterRoster();
      recordAuditLog('account', requestSession, '新增角色', { character });
      sendJson(res, 201, { character });
    } catch (error) {
      recordAuditLog('account', requestSession, '新增角色', {}, false, error.message);
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const characterAdminMatch = pathname.match(/^\/api\/admin\/characters\/([^/]+)$/);
  if (req.method === 'PUT' && characterAdminMatch) {
    try {
      const body = JSON.parse((await readBody(req, 6 * 1024 * 1024)) || '{}');
      const { id, portraitUrl, ...safeBody } = body;
      const characterId = decodeURIComponent(characterAdminMatch[1]);
      const result = updateCharacter(db, characterId, safeBody);
      reloadCharacterRoster();
      recordAuditLog('account', requestSession, '修改角色基础数据', {
        characterId: result.character.id,
        changesAdded: result.changesAdded,
        before: result.previous,
        after: result.character
      });
      sendJson(res, 200, { character: result.character });
    } catch (error) {
      recordAuditLog('account', requestSession, '修改角色基础数据', {
        characterId: characterAdminMatch[1]
      }, false, error.message);
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'DELETE' && characterAdminMatch) {
    try {
      const character = archiveCharacter(db, decodeURIComponent(characterAdminMatch[1]));
      reloadCharacterRoster();
      recordAuditLog('account', requestSession, '停用角色', { character });
      sendJson(res, 200, { character });
    } catch (error) {
      recordAuditLog('account', requestSession, '停用角色', {
        characterId: characterAdminMatch[1]
      }, false, error.message);
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bp/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    });
    res.write(`event: obs-status\ndata: ${JSON.stringify(obsController.status())}\n\n`);
    bpClients.add(res);
    req.on('close', () => bpClients.delete(res));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bp/sessions') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const auditActor = {
        userId: requestSession.userId,
        displayName: actorDisplayName(requestSession.userId),
        identityKey: requestSession.activeIdentityKey
      };
      const session = bpService.ensureSession(body.matchId, Number(body.gameNumber), String(body.room).toUpperCase(), Number(body.attempt || 1), auditActor);
      sendJson(res, 200, bpService.serialize(session));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const bpSessionMatch = pathname.match(/^\/api\/bp\/sessions\/([^/]+)(?:\/(actions|export))?$/);
  if (bpSessionMatch) {
    const id = bpSessionMatch[1];
    const endpoint = bpSessionMatch[2] || 'state';
    try {
      if (req.method === 'GET' && endpoint === 'state') {
        sendJson(res, 200, bpService.serialize(bpService.getSession(id)));
        return;
      }
      if (req.method === 'GET' && endpoint === 'export') {
        const session = bpService.serialize(bpService.getSession(id));
        const body = JSON.stringify(session, null, 2);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json"`,
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store'
        });
        res.end(body);
        return;
      }
      if (req.method === 'POST' && endpoint === 'actions') {
        const action = JSON.parse((await readBody(req)) || '{}');
        const auditActor = {
          userId: requestSession.userId,
          displayName: actorDisplayName(requestSession.userId),
          identityKey: requestSession.activeIdentityKey
        };
        activeAuditActor = auditActor;
        bpService.setAuditActor(id, auditActor);
        let session;
        if (action.type === 'start') {
          session = bpService.startSession(id);
          setWorkingPresence(requestSession.userId, true, `bp:${id}`);
          obsController.syncMatch(session).catch(() => {});
        } else if (action.type === 'complete') {
          session = bpService.completeSession(id);
        } else if (action.type === 'set-slot') {
          session = bpService.updateSlot(id, action);
        } else if (action.type === 'clear-slot') {
          session = bpService.clearSlot(id, action.slotId);
        } else if (action.type === 'restore-revision') {
          session = bpService.restoreRevision(id, Number(action.revision));
        } else if (action.type === 'create-replay') {
          session = bpService.createReplay(id);
          await syncCurrentScheduleImage().catch(() => {});
        } else if (action.type === 'sync-obs') {
          session = bpService.serialize(bpService.getSession(id));
          await obsController.syncSession(sessionForObs(session));
          if (bpPresentation.state.dynamicEnabled) bpPresentation.prepare(session, 'obs-sync-prepared');
        } else if (action.type === 'sync-match') {
          session = bpService.serialize(bpService.getSession(id));
          await obsController.syncMatch(session);
        } else if (action.type === 'sync-match-and-switch') {
          session = bpService.serialize(bpService.getSession(id));
          await obsController.syncMatch(session);
          await obsController.switchScene('matchup');
        } else if (action.type === 'switch-scene-bp') {
          session = bpService.serialize(bpService.getSession(id));
          let dynamicReady = false;
          if (bpPresentation.state.dynamicEnabled) {
            bpPresentation.prepare(session, 'scene-switch-prepared');
            dynamicReady = await obsController.configureBpOverlay({ url: BP_OVERLAY_URL, enabled: true })
              .then(() => true, () => {
                bpPresentation.hide('overlay-obs-failed');
                return false;
              });
          } else {
            bpPresentation.hide('dynamic-disabled-switch');
            await obsController.configureBpOverlay({ url: BP_OVERLAY_URL, enabled: false }).catch(() => {});
          }
          await obsController.switchScene('bp');
          if (dynamicReady) bpPresentation.armIntro(session, 2000);
        } else if (action.type === 'set-commentator-image') {
          const image = commentatorImage(action.imageId);
          await obsController.syncCommentatorImage(image.filePath);
          updateCommentatorImageId(image.id);
          activeCommentatorImage = image;
          session = bpService.setCommentatorImage(id, image);
        } else if (action.type === 'set-output-mode') {
          session = bpService.setOutputMode(id, action.mode);
        } else if (action.type === 'set-result') {
          session = bpService.setResult(id, action.winnerRole);
          setWorkingPresence(requestSession.userId, false, `bp:${id}`);
          recordUserExecution(requestSession.userId, id);
          await obsController.syncResult(session).catch(() => {});
          await syncCurrentScheduleImage().catch(() => {});
        } else if (action.type === 'declare-forfeit') {
          session = bpService.declareForfeit(id, action.forfeitingTeamId);
          setWorkingPresence(requestSession.userId, false, `bp:${id}`);
          await obsController.syncScore(session.score).catch(() => {});
          await syncCurrentScheduleImage().catch(() => {});
        } else if (action.type === 'revoke-forfeit') {
          session = bpService.revokeForfeit(id);
          setWorkingPresence(requestSession.userId, true, `bp:${id}`);
          await obsController.syncScore(session.score).catch(() => {});
          await syncCurrentScheduleImage().catch(() => {});
        } else if (action.type === 'reset-session') {
          session = bpService.resetSession(id);
          setWorkingPresence(requestSession.userId, false, `bp:${id}`);
          await syncCurrentScheduleImage().catch(() => {});
        } else {
          throw new Error(`未知BP操作: ${action.type}`);
        }
        recordAuditLog('event', requestSession, action.type, {
          sessionId: id,
          gameNumber: session?.gameNumber,
          room: session?.room
        });
        activeAuditActor = null;
        sendJson(res, 200, session);
        return;
      }
    } catch (error) {
      activeAuditActor = null;
      sendJson(res, 400, { error: error.message });
      return;
    }
  }

  if (pathname === '/api/obs/status' && req.method === 'GET') {
    sendJson(res, 200, obsController.status());
    return;
  }

  if (pathname === '/api/obs/connect' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const password = typeof body.password === 'string' && body.password.length ? body.password : obsClient.password;
      obsClient.configure({ url: body.url, password });
      runtimeConfig.obs = { url: obsClient.url, password: obsClient.password };
      persistRuntimeConfig();
      const status = await obsController.connect();
      await obsController.syncCountdownUrl(body.countdownUrl);
      await syncCurrentScheduleImage();
      if (activeCommentatorLogoImage) await obsController.syncCommentatorLogo(activeCommentatorLogoImage.filePath);
      const dynamicObs = await obsController.configureBpOverlay({
        url: BP_OVERLAY_URL,
        enabled: bpPresentation.state.dynamicEnabled
      }).then(() => ({ synced: true }), error => ({ synced: false, error: error.message }));
      sendJson(res, 200, { ...status, dynamicBp: dynamicObs });
    } catch (error) {
      sendJson(res, 400, { error: error.message, ...obsController.status() });
    }
    return;
  }

  const hubMatch = pathname.match(/^\/api\/hubs\/([^/]+)(?:\/(events|state|actions|logs))?$/);
  if (hubMatch) {
    const id = hubMatch[1];
    const endpoint = hubMatch[2] || 'state';
    const hub = ensureHub(id);

    if (req.method === 'GET' && endpoint === 'state') {
      hub.state = { ...hub.state, remainingSeconds: currentRemaining(hub.state), updatedAt: Date.now() };
      sendJson(res, 200, hub.state);
      return;
    }

    if (req.method === 'GET' && endpoint === 'logs') {
      sendJson(res, 200, pagedCountdownEvents(hub.id, {
        limit: url.searchParams.get('limit'),
        cursor: url.searchParams.get('cursor')
      }));
      return;
    }

    if (req.method === 'GET' && endpoint === 'events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive'
      });
      res.write(`event: state\ndata: ${JSON.stringify(hub.state)}\n\n`);
      hub.clients.add(res);
      if (requestSession && hasPermission(requestSession, 'countdown.operate')) {
        if (!hub.logClients) hub.logClients = new Set();
        hub.logClients.add(res);
      }
      req.on('close', () => {
        hub.clients.delete(res);
        hub.logClients?.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && endpoint === 'actions') {
      let action = {};
      const beforeState = { ...hub.state, remainingSeconds: currentRemaining(hub.state) };
      try {
        const body = await readBody(req);
        action = body ? JSON.parse(body) : {};
        hub.state = applyCountdownAction(hub.state, action);
        saveHubState(hub);
        const eventLog = recordCountdownEvent(hub.id, requestSession, action, beforeState, hub.state);
        broadcast(hub);
        broadcastCountdownLog(hub, eventLog);
        sendJson(res, 200, { ...hub.state, eventLog });
      } catch (error) {
        recordCountdownEvent(hub.id, requestSession, action, beforeState, null, false, error.message);
        sendJson(res, 400, { error: error.message });
      }
      return;
    }
  }

  const overlayMatch = pathname.match(/^\/hub\/([^/]+)$/);
  if (req.method === 'GET' && overlayMatch) {
    serveStatic(req, res, '/overlay.html');
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Stella Director running at http://127.0.0.1:${PORT}/`);
  obsController.connect()
    .then(async () => {
      await obsController.syncCountdownUrl(process.env.COUNTDOWN_URL || `http://localhost:${PORT}/hub/countdown`);
      await syncCurrentScheduleImage();
      if (activeCommentatorLogoImage) await obsController.syncCommentatorLogo(activeCommentatorLogoImage.filePath);
      await obsController.configureBpOverlay({
        url: BP_OVERLAY_URL,
        enabled: bpPresentation.state.dynamicEnabled
      }).catch(() => {});
      // 音乐联动内部钩子，暂不激活
      // const scenes = await obsController.sceneCatalog();
      // await sceneMusicController.setScene(scenes.currentScene);
    })
    .catch(() => {});
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.log(`ZFB Web HUB 已经运行：http://localhost:${PORT}/control.html`);
    process.exitCode = 0;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(bpPresentationHeartbeat);
  clearInterval(presenceSweep);
  clearInterval(communicationHeartbeat);
  bpService.close();
  obsClient.disconnect();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
