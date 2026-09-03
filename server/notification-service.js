const crypto = require('node:crypto');
const { db: defaultDb } = require('./db');
const { hasPermission } = require('./permissions-service');

const TYPES = new Set(['message', 'urgent', 'friend_request', 'version', 'announcement']);
const TARGET_KINDS = new Set(['all', 'identity', 'account', 'system']);
const IDENTITY_KEYS = new Set([
  'developer', 'administrator', 'director', 'commentator', 'referee', 'scorer', 'guest'
]);

function cleanText(value, label, maxLength, required = false) {
  const text = String(value || '').trim();
  if (required && !text) throw new Error(`${label}不能为空`);
  if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
  return text;
}

function activeUserIds(database = defaultDb) {
  const now = Date.now();
  return database.prepare(`SELECT id FROM users
    WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY created_at, id`).all(now).map(row => row.id);
}

function resolveTargetUsers(database = defaultDb, target = {}) {
  const kind = String(target.kind || 'all');
  if (!TARGET_KINDS.has(kind) || kind === 'system') throw new Error('通知发布目标无效');
  if (kind === 'all') return activeUserIds(database);
  if (kind === 'identity') {
    const identityKey = String(target.value || '');
    if (!IDENTITY_KEYS.has(identityKey)) throw new Error('通知目标身份不存在');
    return database.prepare(`SELECT DISTINCT users.id FROM users
      JOIN user_identity_assignments ON user_identity_assignments.user_id = users.id
      WHERE user_identity_assignments.identity_key = ? AND users.status = 'active'
        AND (users.expires_at IS NULL OR users.expires_at > ?)
      ORDER BY users.created_at, users.id`).all(identityKey, Date.now()).map(row => row.id);
  }
  const values = Array.isArray(target.value) ? target.value : [target.value];
  const ids = [...new Set(values.map(String).filter(Boolean))];
  if (!ids.length) throw new Error('请选择接收账号');
  const placeholders = ids.map(() => '?').join(', ');
  const rows = database.prepare(`SELECT id FROM users WHERE id IN (${placeholders}) AND status = 'active'`).all(...ids);
  if (!rows.length) throw new Error('未找到可接收通知的账号');
  return rows.map(row => row.id);
}

function channelRecipientUserIds(database = defaultDb, channelId, senderUserId) {
  const channel = database.prepare('SELECT * FROM communication_channels WHERE id = ?').get(channelId);
  if (!channel) return [];
  let rows = [];
  if (channel.kind === 'global') {
    rows = database.prepare("SELECT id FROM users WHERE status = 'active'").all();
  } else if (channel.kind === 'identity') {
    rows = database.prepare(`SELECT DISTINCT users.id FROM users
      JOIN user_identity_assignments ON user_identity_assignments.user_id = users.id
      WHERE users.status = 'active' AND user_identity_assignments.identity_key = ?`).all(channel.identity_key);
  } else {
    rows = database.prepare(`SELECT users.id FROM communication_channel_members
      JOIN users ON users.id = communication_channel_members.user_id
      WHERE communication_channel_members.channel_id = ? AND users.status = 'active'`).all(channelId);
  }
  return rows.map(row => row.id).filter(userId => {
    if (userId === senderUserId) return false;
    const identityRows = database.prepare(`SELECT identity_key FROM user_identity_assignments
      WHERE user_id = ? ORDER BY sort_order`).all(userId);
    const identityKeys = identityRows.length
      ? identityRows.map(item => item.identity_key)
      : [database.prepare('SELECT identity_key FROM user_profiles WHERE user_id = ?').get(userId)?.identity_key || 'guest'];
    const eligibleIdentities = channel.kind === 'identity'
      ? identityKeys.filter(identityKey => identityKey === channel.identity_key)
      : identityKeys;
    return eligibleIdentities.some(activeIdentityKey => hasPermission({ userId, activeIdentityKey }, 'communication.use', database));
  });
}

function serializeNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    summary: row.summary,
    body: row.body,
    urgent: Boolean(row.urgent),
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    targetKind: row.target_kind,
    targetValue: row.target_value,
    createdByUserId: row.created_by_user_id,
    createdByIdentityKey: row.created_by_identity_key,
    createdByDisplayName: row.created_by_display_name || null,
    createdAt: row.created_at,
    readAt: row.read_at || null,
    unread: !row.read_at
  };
}

function createNotification(database = defaultDb, input = {}, recipientUserIds = []) {
  const type = String(input.type || 'announcement');
  if (!TYPES.has(type)) throw new Error('通知类型无效');
  const sourceKind = cleanText(input.sourceKind || 'manual', '通知来源', 40, true);
  const sourceId = input.sourceId == null ? null : cleanText(input.sourceId, '来源标识', 120, true);
  const targetKind = String(input.targetKind || 'system');
  if (!TARGET_KINDS.has(targetKind)) throw new Error('通知目标类型无效');
  const recipients = [...new Set(recipientUserIds.map(String).filter(Boolean))];
  if (!recipients.length) return null;
  const existing = sourceId
    ? database.prepare('SELECT id FROM notifications WHERE source_kind = ? AND source_id = ?').get(sourceKind, sourceId)
    : null;
  const id = existing?.id || crypto.randomUUID();
  const now = Number(input.createdAt) || Date.now();
  database.exec('BEGIN');
  try {
    if (!existing) {
      database.prepare(`INSERT INTO notifications
        (id, type, title, summary, body, urgent, source_kind, source_id, target_kind, target_value,
          created_by_user_id, created_by_identity_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        type,
        cleanText(input.title, '通知标题', 80, true),
        cleanText(input.summary, '通知摘要', 160),
        cleanText(input.body, '通知正文', 2000),
        input.urgent ? 1 : 0,
        sourceKind,
        sourceId,
        targetKind,
        input.targetValue == null ? null : String(input.targetValue),
        input.createdByUserId || null,
        cleanText(input.createdByIdentityKey || 'system', '发布身份', 40, true),
        now
      );
    }
    const insertRecipient = database.prepare(`INSERT OR IGNORE INTO notification_recipients
      (notification_id, user_id, read_at) VALUES (?, ?, NULL)`);
    recipients.forEach(userId => insertRecipient.run(id, userId));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return notificationById(database, id);
}

function notificationById(database = defaultDb, id, userId = null) {
  const row = database.prepare(`SELECT notifications.*, notification_recipients.read_at,
      users.display_name AS created_by_display_name
    FROM notifications
    LEFT JOIN notification_recipients ON notification_recipients.notification_id = notifications.id
      AND notification_recipients.user_id = ?
    LEFT JOIN users ON users.id = notifications.created_by_user_id
    WHERE notifications.id = ?`).get(userId, id);
  return row ? serializeNotification(row) : null;
}

function notificationCounts(database = defaultDb, userId) {
  const row = database.prepare(`SELECT
      COUNT(*) FILTER (WHERE notification_recipients.read_at IS NULL) AS unread_count,
      COUNT(*) FILTER (WHERE notification_recipients.read_at IS NULL AND notifications.urgent = 1) AS urgent_unread_count
    FROM notification_recipients
    JOIN notifications ON notifications.id = notification_recipients.notification_id
    WHERE notification_recipients.user_id = ?`).get(userId);
  return { unreadCount: Number(row?.unread_count || 0), urgentUnreadCount: Number(row?.urgent_unread_count || 0) };
}

function listNotifications(database = defaultDb, userId, options = {}) {
  const limit = Math.max(1, Math.min(60, Number(options.limit) || 30));
  const offset = Math.max(0, Number(options.offset) || 0);
  const rows = database.prepare(`SELECT notifications.*, notification_recipients.read_at,
      users.display_name AS created_by_display_name
    FROM notification_recipients
    JOIN notifications ON notifications.id = notification_recipients.notification_id
    LEFT JOIN users ON users.id = notifications.created_by_user_id
    WHERE notification_recipients.user_id = ?
    ORDER BY notifications.created_at DESC, notifications.id DESC
    LIMIT ? OFFSET ?`).all(userId, limit + 1, offset);
  return {
    notifications: rows.slice(0, limit).map(serializeNotification),
    ...notificationCounts(database, userId),
    offset,
    nextOffset: rows.length > limit ? offset + limit : null
  };
}

function markNotificationRead(database = defaultDb, userId, notificationId) {
  const now = Date.now();
  const result = database.prepare(`UPDATE notification_recipients SET read_at = COALESCE(read_at, ?)
    WHERE notification_id = ? AND user_id = ?`).run(now, notificationId, userId);
  if (!result.changes) throw new Error('通知不存在或不属于当前账号');
  return { notification: notificationById(database, notificationId, userId), ...notificationCounts(database, userId) };
}

function markAllNotificationsRead(database = defaultDb, userId) {
  const now = Date.now();
  const result = database.prepare(`UPDATE notification_recipients SET read_at = ?
    WHERE user_id = ? AND read_at IS NULL`).run(now, userId);
  return { readCount: Number(result.changes || 0), ...notificationCounts(database, userId) };
}

function publishNotification(database = defaultDb, session, payload = {}) {
  const target = payload.target || { kind: payload.targetKind, value: payload.targetValue };
  const recipientUserIds = resolveTargetUsers(database, target);
  const notification = createNotification(database, {
    type: 'announcement',
    title: payload.title,
    summary: payload.summary,
    body: payload.body,
    urgent: Boolean(payload.urgent),
    sourceKind: 'manual',
    targetKind: target.kind,
    targetValue: Array.isArray(target.value) ? target.value.join(',') : target.value,
    createdByUserId: session.userId,
    createdByIdentityKey: session.activeIdentityKey || 'unknown'
  }, recipientUserIds);
  return { notification, recipientUserIds };
}

function listPublishedNotifications(database = defaultDb, options = {}) {
  const limit = Math.max(1, Math.min(60, Number(options.limit) || 30));
  const offset = Math.max(0, Number(options.offset) || 0);
  const rows = database.prepare(`SELECT notifications.*, users.display_name AS created_by_display_name,
      NULL AS read_at, COUNT(notification_recipients.user_id) AS recipient_count,
      COUNT(notification_recipients.user_id) FILTER (WHERE notification_recipients.read_at IS NOT NULL) AS read_count
    FROM notifications
    LEFT JOIN users ON users.id = notifications.created_by_user_id
    LEFT JOIN notification_recipients ON notification_recipients.notification_id = notifications.id
    WHERE notifications.source_kind = 'manual'
    GROUP BY notifications.id
    ORDER BY notifications.created_at DESC, notifications.id DESC
    LIMIT ? OFFSET ?`).all(limit + 1, offset);
  return {
    notifications: rows.slice(0, limit).map(row => ({
      ...serializeNotification(row),
      recipientCount: Number(row.recipient_count || 0),
      readCount: Number(row.read_count || 0)
    })),
    offset,
    nextOffset: rows.length > limit ? offset + limit : null
  };
}

function ensureVersionNotification(database = defaultDb, release = {}) {
  const version = cleanText(release.currentVersion || release.version, '版本号', 40);
  if (!version) return null;
  const latest = Array.isArray(release.releases) ? release.releases[0] : null;
  const summary = cleanText(latest?.summary || latest?.title || `系统已更新至 ${version}`, '版本摘要', 160);
  return createNotification(database, {
    type: 'version',
    title: `版本更新 ${version}`,
    summary,
    body: cleanText(latest?.description || summary, '版本说明', 2000),
    sourceKind: 'version',
    sourceId: version,
    targetKind: 'all',
    targetValue: version,
    createdByIdentityKey: 'system'
  }, activeUserIds(database));
}

function createMessageNotification(database = defaultDb, message, urgent = false) {
  const senderUserId = message.senderUserId || message.sender?.id || null;
  const senderDisplayName = message.senderDisplayName || message.sender?.displayName || '系统用户';
  const recipients = channelRecipientUserIds(database, message.channelId, senderUserId);
  return createNotification(database, {
    type: urgent ? 'urgent' : 'message',
    title: urgent ? `${senderDisplayName} 发来加急消息` : `${senderDisplayName} 发来新消息`,
    summary: String(message.content || '').slice(0, 160),
    body: message.content,
    urgent,
    sourceKind: 'message',
    sourceId: String(message.id),
    targetKind: 'system',
    targetValue: message.channelId,
    createdByUserId: senderUserId,
    createdByIdentityKey: message.senderIdentityKey || message.sender?.identityKey || 'unknown'
  }, recipients);
}

function promoteMessageNotification(database = defaultDb, message) {
  const senderUserId = message.senderUserId || message.sender?.id || null;
  const senderDisplayName = message.senderDisplayName || message.sender?.displayName || '系统用户';
  let notification = database.prepare("SELECT id FROM notifications WHERE source_kind = 'message' AND source_id = ?")
    .get(String(message.id));
  if (!notification) return createMessageNotification(database, message, true);
  database.prepare(`UPDATE notifications SET type = 'urgent', urgent = 1,
      title = ?, summary = ?, body = ? WHERE id = ?`).run(
    `${senderDisplayName} 发来加急消息`, String(message.content || '').slice(0, 160),
    String(message.content || ''), notification.id);
  const insert = database.prepare(`INSERT OR IGNORE INTO notification_recipients
    (notification_id, user_id, read_at) VALUES (?, ?, NULL)`);
  channelRecipientUserIds(database, message.channelId, senderUserId)
    .forEach(userId => {
      insert.run(notification.id, userId);
      database.prepare(`UPDATE notification_recipients SET read_at = NULL
        WHERE notification_id = ? AND user_id = ?`).run(notification.id, userId);
    });
  return notificationById(database, notification.id);
}

function syncMessageUrgency(database = defaultDb, message) {
  if (message.urgent) return promoteMessageNotification(database, message);
  const notification = database.prepare("SELECT id FROM notifications WHERE source_kind = 'message' AND source_id = ?")
    .get(String(message.id));
  if (!notification) return createMessageNotification(database, message, false);
  database.prepare("UPDATE notifications SET type = 'message', urgent = 0 WHERE id = ?").run(notification.id);
  return notificationById(database, notification.id);
}

function markChannelNotificationsRead(database = defaultDb, userId, channelId, messageId) {
  const ceiling = Number(messageId);
  if (!Number.isInteger(ceiling) || ceiling < 1) return 0;
  const result = database.prepare(`UPDATE notification_recipients SET read_at = COALESCE(read_at, ?)
    WHERE user_id = ? AND notification_id IN (
      SELECT id FROM notifications WHERE source_kind = 'message' AND target_value = ?
        AND CAST(source_id AS INTEGER) <= ?
    )`).run(Date.now(), userId, channelId, ceiling);
  return Number(result.changes || 0);
}

module.exports = {
  TYPES,
  TARGET_KINDS,
  activeUserIds,
  resolveTargetUsers,
  channelRecipientUserIds,
  createNotification,
  createMessageNotification,
  promoteMessageNotification,
  syncMessageUrgency,
  markChannelNotificationsRead,
  ensureVersionNotification,
  listNotifications,
  listPublishedNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  notificationCounts,
  notificationById,
  publishNotification
};
