const crypto = require('node:crypto');
const { db: defaultDb } = require('./db');
const { IDENTITY_LABELS } = require('./permissions-service');

const MESSAGE_LIMIT = 500;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const REVOKED_MESSAGE_TEXT = '消息已撤回';

function assert(condition, message, code = 'COMMUNICATION_INVALID') {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}

function transaction(database, fn) {
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function identityLabel(key) {
  return IDENTITY_LABELS[key] || key || '未知身份';
}

function userCard(database, userId) {
  const row = database.prepare(`SELECT users.id, users.username, users.display_name,
      users.role, profiles.identity_key, profiles.title, avatars.sha256 AS avatar_sha256
    FROM users
    LEFT JOIN user_profiles profiles ON profiles.user_id = users.id
    LEFT JOIN user_avatars avatars ON avatars.user_id = users.id
    WHERE users.id = ?`).get(userId);
  if (!row) return null;
  return {
    id: row.id,
    account: row.username,
    displayName: row.display_name || row.username,
    identityKey: row.identity_key || (row.role === 'developer' ? 'developer' : row.role === 'admin' ? 'administrator' : 'guest'),
    title: row.title || '',
    avatarUrl: row.avatar_sha256 ? `/api/profiles/${row.id}/avatar?v=${row.avatar_sha256}` : null
  };
}

function channelById(database, channelId) {
  return database.prepare('SELECT * FROM communication_channels WHERE id = ?').get(channelId) || null;
}

function developerChannelAccess(session) {
  return session?.activeIdentityKey === 'developer';
}

function isChannelMember(database, channelId, userId) {
  return Boolean(database.prepare(`SELECT 1 FROM communication_channel_members
    WHERE channel_id = ? AND user_id = ?`).get(channelId, userId));
}

function canAccessChannel(database, session, channelOrId) {
  if (!session?.userId) return false;
  const channel = typeof channelOrId === 'string' ? channelById(database, channelOrId) : channelOrId;
  if (!channel) return false;
  if (developerChannelAccess(session)) return true;
  if (channel.kind === 'global') return true;
  if (channel.kind === 'identity') return channel.identity_key === session.activeIdentityKey;
  return isChannelMember(database, channel.id, session.userId);
}

function requireChannel(database, session, channelId) {
  const channel = channelById(database, channelId);
  assert(channel, '频道不存在', 'CHANNEL_NOT_FOUND');
  assert(canAccessChannel(database, session, channel), '无权访问该频道', 'CHANNEL_FORBIDDEN');
  return channel;
}

function ensureMember(database, channelId, userId) {
  database.prepare(`INSERT OR IGNORE INTO communication_channel_members
    (channel_id, user_id, joined_at, last_read_message_id) VALUES (?, ?, ?, 0)`)
    .run(channelId, userId, Date.now());
}

function ensureObserver(database, channelId, userId) {
  database.prepare(`INSERT OR IGNORE INTO communication_channel_observers
    (channel_id, user_id, observed_at, last_read_message_id) VALUES (?, ?, ?, 0)`)
    .run(channelId, userId, Date.now());
}

function readTracker(database, session, channel) {
  const member = isChannelMember(database, channel.id, session.userId);
  if (developerChannelAccess(session) && !member && channel.kind !== 'global') {
    ensureObserver(database, channel.id, session.userId);
    const tracker = database.prepare(`SELECT last_read_message_id FROM communication_channel_observers
      WHERE channel_id = ? AND user_id = ?`).get(channel.id, session.userId);
    return { kind: 'observer', lastReadMessageId: Number(tracker?.last_read_message_id) || 0 };
  }
  ensureMember(database, channel.id, session.userId);
  const tracker = database.prepare(`SELECT last_read_message_id FROM communication_channel_members
    WHERE channel_id = ? AND user_id = ?`).get(channel.id, session.userId);
  return { kind: 'member', lastReadMessageId: Number(tracker?.last_read_message_id) || 0 };
}

function updateReadTracker(database, session, channel, messageId) {
  const tracker = readTracker(database, session, channel);
  const table = tracker.kind === 'observer'
    ? 'communication_channel_observers' : 'communication_channel_members';
  database.prepare(`UPDATE ${table} SET last_read_message_id = MAX(last_read_message_id, ?)
    WHERE channel_id = ? AND user_id = ?`).run(messageId, channel.id, session.userId);
  return tracker.kind;
}

function membersForChannel(database, channelId) {
  return database.prepare(`SELECT user_id FROM communication_channel_members
    WHERE channel_id = ? ORDER BY joined_at, user_id`).all(channelId)
    .map(row => userCard(database, row.user_id)).filter(Boolean);
}

function canAuditMessages(session) {
  return session?.activeIdentityKey === 'developer';
}

function messageEditHistory(database, messageId) {
  return database.prepare(`SELECT content, created_at FROM communication_message_edits
    WHERE message_id = ? ORDER BY id DESC`).all(messageId).map(item => ({
    content: item.content,
    createdAt: item.created_at
  }));
}

function messageRow(database, row, session) {
  if (!row) return null;
  const sender = row.sender_user_id ? userCard(database, row.sender_user_id) : null;
  const viewerId = session?.userId;
  const mine = row.sender_user_id === viewerId;
  const recalled = Boolean(row.recalled_at);
  const auditVisible = recalled && canAuditMessages(session);
  const plusOneCount = database.prepare(`SELECT COUNT(*) AS n FROM communication_message_plus_ones
    WHERE message_id = ?`).get(row.id).n;
  const plusOneByMe = Boolean(database.prepare(`SELECT 1 FROM communication_message_plus_ones
    WHERE message_id = ? AND user_id = ?`).get(row.id, viewerId));
  return {
    id: row.id,
    channelId: row.channel_id,
    content: recalled && !auditVisible ? REVOKED_MESSAGE_TEXT : row.content,
    createdAt: row.created_at,
    edited: Boolean(row.edited_at),
    editedAt: row.edited_at || null,
    editHistory: canAuditMessages(session) && row.edited_at ? messageEditHistory(database, row.id) : [],
    recalled,
    recalledAt: row.recalled_at || null,
    recalledByUserId: auditVisible ? row.recalled_by_user_id || null : null,
    developerRecallVisible: auditVisible,
    urgent: Boolean(row.urgent),
    plusOneCount,
    plusOneByMe,
    sender: sender || {
      id: null,
      account: '',
      displayName: row.sender_display_name,
      identityKey: row.sender_identity_key,
      title: '',
      avatarUrl: null
    },
    senderIdentityKey: row.sender_identity_key,
    senderIdentityLabel: identityLabel(row.sender_identity_key),
    mine,
    canEdit: mine && !recalled,
    canRecall: mine && !recalled,
    canSetUrgent: mine && !recalled,
    canDelete: true
  };
}

function serializeChannel(database, session, channel) {
  const tracker = readTracker(database, session, channel);
  const members = channel.kind === 'private' || channel.kind === 'custom'
    ? membersForChannel(database, channel.id) : [];
  const developerObserver = tracker.kind === 'observer';
  const counterpart = channel.kind === 'private'
    ? (developerObserver ? null : members.find(member => member.id !== session.userId) || null) : null;
  const privateAuditName = channel.kind === 'private' && developerObserver
    ? members.map(member => member.displayName).join(' ↔ ') : '';
  const last = database.prepare(`SELECT * FROM communication_messages
    WHERE channel_id = ? AND NOT EXISTS (
      SELECT 1 FROM communication_message_deletions deletions
      WHERE deletions.message_id = communication_messages.id AND deletions.user_id = ?
    ) ORDER BY id DESC LIMIT 1`).get(channel.id, session.userId);
  const unread = database.prepare(`SELECT COUNT(*) AS n FROM communication_messages
    WHERE channel_id = ? AND id > ? AND sender_user_id IS NOT ? AND recalled_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM communication_message_deletions deletions
        WHERE deletions.message_id = communication_messages.id AND deletions.user_id = ?
      )`).get(channel.id, tracker.lastReadMessageId, session.userId, session.userId).n;
  const firstUnread = database.prepare(`SELECT id FROM communication_messages
    WHERE channel_id = ? AND id > ? AND sender_user_id IS NOT ? AND recalled_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM communication_message_deletions deletions
        WHERE deletions.message_id = communication_messages.id AND deletions.user_id = ?
      ) ORDER BY id LIMIT 1`).get(
    channel.id, tracker.lastReadMessageId, session.userId, session.userId
  );
  return {
    id: channel.id,
    kind: channel.kind,
    name: privateAuditName || counterpart?.displayName || channel.name,
    description: channel.description,
    identityKey: channel.identity_key || null,
    identityLabel: channel.identity_key ? identityLabel(channel.identity_key) : null,
    avatarUrl: counterpart?.avatarUrl || null,
    ownerUserId: channel.owner_user_id || null,
    mine: channel.owner_user_id === session.userId,
    developerObserver,
    members,
    memberCount: members.length,
    unreadCount: unread,
    firstUnreadMessageId: firstUnread?.id || null,
    lastMessage: messageRow(database, last, session),
    updatedAt: channel.updated_at
  };
}

function visibleChannels(database, session) {
  const rows = developerChannelAccess(session)
    ? database.prepare('SELECT * FROM communication_channels').all()
    : database.prepare(`SELECT DISTINCT channels.*
      FROM communication_channels channels
      LEFT JOIN communication_channel_members members
        ON members.channel_id = channels.id AND members.user_id = ?
      WHERE channels.kind = 'global'
        OR (channels.kind = 'identity' AND channels.identity_key = ?)
        OR members.user_id IS NOT NULL`).all(session.userId, session.activeIdentityKey);
  const priority = { global: 0, identity: 1, private: 2, custom: 3 };
  return rows.map(row => serializeChannel(database, session, row))
    .sort((left, right) => priority[left.kind] - priority[right.kind]
      || right.updatedAt - left.updatedAt || left.name.localeCompare(right.name, 'zh-CN'));
}

function acceptedFriendIds(database, userId) {
  return new Set(database.prepare(`SELECT CASE
      WHEN user_low_id = ? THEN user_high_id ELSE user_low_id END AS friend_id
    FROM user_relationships
    WHERE status = 'accepted' AND (user_low_id = ? OR user_high_id = ?)`)
    .all(userId, userId, userId).map(row => row.friend_id));
}

function communicationContacts(database, session) {
  return [...acceptedFriendIds(database, session.userId)]
    .map(userId => userCard(database, userId)).filter(Boolean)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'));
}

function markChannelRead(database, session, channelId, messageId = null) {
  const channel = requireChannel(database, session, channelId);
  const channelLatest = database.prepare(`SELECT COALESCE(MAX(id), 0) AS id
    FROM communication_messages WHERE channel_id = ?`).get(channelId).id;
  const requested = messageId == null ? channelLatest : Number(messageId);
  assert(Number.isInteger(requested) && requested >= 0, '已读位置无效');
  const latest = Math.min(requested, channelLatest);
  updateReadTracker(database, session, channel, latest);
  return { channelId, lastReadMessageId: latest, channel: serializeChannel(database, session, channel) };
}

function listMessages(database, session, channelId, options = {}) {
  const channel = requireChannel(database, session, channelId);
  const limit = Math.min(MAX_MESSAGE_LIMIT, Math.max(1, Number(options.limit) || DEFAULT_MESSAGE_LIMIT));
  const before = Number(options.before);
  const after = Number(options.after);
  const tracker = readTracker(database, session, channel);
  const lastReadMessageId = tracker.lastReadMessageId;
  const firstUnread = database.prepare(`SELECT id FROM communication_messages
    WHERE channel_id = ? AND id > ? AND sender_user_id IS NOT ? AND recalled_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM communication_message_deletions deletions
        WHERE deletions.message_id = communication_messages.id AND deletions.user_id = ?
      ) ORDER BY id LIMIT 1`).get(channel.id, lastReadMessageId, session.userId, session.userId);
  const visibleWhere = `channel_id = ? AND NOT EXISTS (
    SELECT 1 FROM communication_message_deletions deletions
    WHERE deletions.message_id = communication_messages.id AND deletions.user_id = ?
  )`;
  let rows;
  if (options.unread && firstUnread?.id) {
    const contextLimit = Math.min(10, Math.max(1, Math.floor(limit / 4)));
    const contextRows = database.prepare(`SELECT * FROM communication_messages
      WHERE ${visibleWhere} AND id <= ? ORDER BY id DESC LIMIT ?`)
      .all(channel.id, session.userId, firstUnread.id, contextLimit).reverse();
    const remaining = Math.max(0, limit - contextRows.length);
    const newerRows = database.prepare(`SELECT * FROM communication_messages
      WHERE ${visibleWhere} AND id > ? ORDER BY id LIMIT ?`)
      .all(channel.id, session.userId, firstUnread.id, remaining);
    rows = [...contextRows, ...newerRows];
  } else if (Number.isInteger(after) && after > 0) {
    rows = database.prepare(`SELECT * FROM communication_messages
      WHERE ${visibleWhere} AND id > ? ORDER BY id LIMIT ?`)
      .all(channel.id, session.userId, after, limit);
  } else if (Number.isInteger(before) && before > 0) {
    rows = database.prepare(`SELECT * FROM communication_messages
      WHERE ${visibleWhere} AND id < ? ORDER BY id DESC LIMIT ?`)
      .all(channel.id, session.userId, before, limit).reverse();
  } else {
    rows = database.prepare(`SELECT * FROM communication_messages
      WHERE ${visibleWhere} ORDER BY id DESC LIMIT ?`)
      .all(channel.id, session.userId, limit).reverse();
  }
  const firstId = rows[0]?.id || 0;
  const lastId = rows.at(-1)?.id || 0;
  const hasOlder = Boolean(firstId && database.prepare(`SELECT 1 FROM communication_messages
    WHERE ${visibleWhere} AND id < ? LIMIT 1`).get(channel.id, session.userId, firstId));
  const hasNewer = Boolean(lastId && database.prepare(`SELECT 1 FROM communication_messages
    WHERE ${visibleWhere} AND id > ? LIMIT 1`).get(channel.id, session.userId, lastId));
  const messages = rows.map(row => messageRow(database, row, session));
  if (options.markRead !== false && messages.length) {
    markChannelRead(database, session, channel.id, messages.at(-1).id);
  }
  return {
    channel: serializeChannel(database, session, channel),
    messages,
    hasMore: hasOlder,
    hasOlder,
    hasNewer,
    firstUnreadMessageId: firstUnread?.id || null
  };
}

function communicationBootstrap(database = defaultDb, session, selectedChannelId = null) {
  const initialChannels = visibleChannels(database, session);
  const selected = initialChannels.find(channel => channel.id === selectedChannelId)
    || initialChannels.find(channel => channel.kind === 'global') || initialChannels[0] || null;
  const conversation = selected
    ? listMessages(database, session, selected.id, {
        limit: DEFAULT_MESSAGE_LIMIT,
        unread: true,
        markRead: false
      })
    : { channel: null, messages: [], hasMore: false };
  return {
    currentUser: userCard(database, session.userId),
    activeIdentityKey: session.activeIdentityKey,
    activeIdentityLabel: identityLabel(session.activeIdentityKey),
    messageLimit: MESSAGE_LIMIT,
    channels: initialChannels,
    notifications: {
      friend: initialChannels.filter(channel => channel.kind === 'private')
        .reduce((total, channel) => total + channel.unreadCount, 0)
        + database.prepare(`SELECT COUNT(*) AS n FROM user_relationships
          WHERE status = 'pending' AND requested_by <> ? AND (user_low_id = ? OR user_high_id = ?)`)
          .get(session.userId, session.userId, session.userId).n,
      channels: initialChannels.reduce((total, channel) => total + channel.unreadCount, 0)
    },
    contacts: communicationContacts(database, session),
    selectedChannelId: selected?.id || null,
    conversation
  };
}

function requireAcceptedFriend(database, userId, targetUserId) {
  assert(targetUserId && targetUserId !== userId, '请选择其他好友');
  assert(acceptedFriendIds(database, userId).has(targetUserId), '只能与已添加的好友建立聊天');
  assert(userCard(database, targetUserId), '好友账号不可用');
}

function createPrivateChannel(database = defaultDb, session, targetUserId) {
  targetUserId = String(targetUserId || '');
  requireAcceptedFriend(database, session.userId, targetUserId);
  const pair = [session.userId, targetUserId].sort();
  const privateKey = pair.join(':');
  return transaction(database, () => {
    let channel = database.prepare('SELECT * FROM communication_channels WHERE private_key = ?').get(privateKey);
    if (!channel) {
      const now = Date.now();
      const id = `private:${crypto.randomUUID()}`;
      database.prepare(`INSERT INTO communication_channels
        (id, kind, name, description, identity_key, owner_user_id, private_key, created_at, updated_at)
        VALUES (?, 'private', '私聊', '', NULL, ?, ?, ?, ?)`)
        .run(id, session.userId, privateKey, now, now);
      for (const userId of pair) ensureMember(database, id, userId);
      channel = channelById(database, id);
    }
    return serializeChannel(database, session, channel);
  });
}

function createCustomChannel(database = defaultDb, session, input = {}) {
  const name = String(input.name || '').trim();
  const description = String(input.description || '').trim();
  assert(Array.from(name).length >= 2 && Array.from(name).length <= 30, '频道名称应为 2 至 30 个字符');
  assert(Array.from(description).length <= 100, '频道说明不能超过 100 个字符');
  const memberIds = [...new Set((Array.isArray(input.memberIds) ? input.memberIds : [])
    .map(String).filter(id => id && id !== session.userId))];
  assert(memberIds.length >= 1 && memberIds.length <= 20, '请选择 1 至 20 名好友加入频道');
  const friends = acceptedFriendIds(database, session.userId);
  assert(memberIds.every(id => friends.has(id) && userCard(database, id)), '频道成员必须是当前好友');
  return transaction(database, () => {
    const now = Date.now();
    const id = `custom:${crypto.randomUUID()}`;
    database.prepare(`INSERT INTO communication_channels
      (id, kind, name, description, identity_key, owner_user_id, private_key, created_at, updated_at)
      VALUES (?, 'custom', ?, ?, NULL, ?, NULL, ?, ?)`)
      .run(id, name, description, session.userId, now, now);
    for (const userId of [session.userId, ...memberIds]) ensureMember(database, id, userId);
    return serializeChannel(database, session, channelById(database, id));
  });
}

function sendMessage(database = defaultDb, session, channelId, rawContent) {
  const channel = requireChannel(database, session, channelId);
  const content = normalizedMessageContent(rawContent);
  const sender = userCard(database, session.userId);
  assert(sender, '发送账号不可用');
  const now = Date.now();
  const result = transaction(database, () => {
    const inserted = database.prepare(`INSERT INTO communication_messages
      (channel_id, sender_user_id, sender_display_name, sender_identity_key, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(channel.id, session.userId, sender.displayName, session.activeIdentityKey, content, now);
    database.prepare('UPDATE communication_channels SET updated_at = ? WHERE id = ?').run(now, channel.id);
    updateReadTracker(database, session, channel, Number(inserted.lastInsertRowid));
    return database.prepare('SELECT * FROM communication_messages WHERE id = ?').get(inserted.lastInsertRowid);
  });
  return messageRow(database, result, session);
}

function requireMessage(database, session, messageId) {
  const id = Number(messageId);
  assert(Number.isInteger(id) && id > 0, '消息标识无效');
  const row = database.prepare('SELECT * FROM communication_messages WHERE id = ?').get(id);
  assert(row, '消息不存在', 'MESSAGE_NOT_FOUND');
  requireChannel(database, session, row.channel_id);
  return row;
}

function normalizedMessageContent(rawContent) {
  const content = String(rawContent || '').replaceAll('\r\n', '\n').trim();
  const length = Array.from(content).length;
  assert(length > 0, '消息内容不能为空');
  assert(length <= MESSAGE_LIMIT, `单条消息不能超过 ${MESSAGE_LIMIT} 字`);
  return content;
}

function editMessage(database = defaultDb, session, messageId, rawContent) {
  const row = requireMessage(database, session, messageId);
  assert(row.sender_user_id === session.userId, '只能修改自己发送的消息', 'MESSAGE_FORBIDDEN');
  assert(!row.recalled_at, '已撤回的消息不能修改');
  const content = normalizedMessageContent(rawContent);
  assert(content !== row.content, '消息内容没有变化');
  const now = Date.now();
  return transaction(database, () => {
    database.prepare(`INSERT INTO communication_message_edits
      (message_id, editor_user_id, content, created_at) VALUES (?, ?, ?, ?)`)
      .run(row.id, session.userId, row.content, row.edited_at || row.created_at);
    database.prepare(`UPDATE communication_messages SET content = ?, edited_at = ? WHERE id = ?`)
      .run(content, now, row.id);
    database.prepare('UPDATE communication_channels SET updated_at = ? WHERE id = ?').run(now, row.channel_id);
    return messageRow(database,
      database.prepare('SELECT * FROM communication_messages WHERE id = ?').get(row.id), session);
  });
}

function recallMessage(database = defaultDb, session, messageId) {
  const row = requireMessage(database, session, messageId);
  assert(row.sender_user_id === session.userId, '只能撤回自己发送的消息', 'MESSAGE_FORBIDDEN');
  assert(!row.recalled_at, '消息已经撤回');
  const now = Date.now();
  database.prepare(`UPDATE communication_messages
    SET recalled_at = ?, recalled_by_user_id = ? WHERE id = ?`).run(now, session.userId, row.id);
  database.prepare('UPDATE communication_channels SET updated_at = ? WHERE id = ?').run(now, row.channel_id);
  return messageRow(database,
    database.prepare('SELECT * FROM communication_messages WHERE id = ?').get(row.id), session);
}

function deleteMessageForUser(database = defaultDb, session, messageId) {
  const row = requireMessage(database, session, messageId);
  database.prepare(`INSERT OR REPLACE INTO communication_message_deletions
    (message_id, user_id, deleted_at) VALUES (?, ?, ?)`).run(row.id, session.userId, Date.now());
  return { messageId: row.id, channelId: row.channel_id, deleted: true };
}

function toggleMessagePlusOne(database = defaultDb, session, messageId) {
  const row = requireMessage(database, session, messageId);
  assert(!row.recalled_at, '已撤回的消息不能回应');
  const existing = database.prepare(`SELECT 1 FROM communication_message_plus_ones
    WHERE message_id = ? AND user_id = ?`).get(row.id, session.userId);
  if (existing) {
    database.prepare(`DELETE FROM communication_message_plus_ones
      WHERE message_id = ? AND user_id = ?`).run(row.id, session.userId);
  } else {
    database.prepare(`INSERT INTO communication_message_plus_ones
      (message_id, user_id, created_at) VALUES (?, ?, ?)`).run(row.id, session.userId, Date.now());
  }
  return messageRow(database, row, session);
}

function setMessageUrgent(database = defaultDb, session, messageId, urgent) {
  const row = requireMessage(database, session, messageId);
  assert(row.sender_user_id === session.userId, '只能为自己发送的消息设置加急', 'MESSAGE_FORBIDDEN');
  assert(!row.recalled_at, '已撤回的消息不能设置加急');
  database.prepare('UPDATE communication_messages SET urgent = ? WHERE id = ?')
    .run(urgent ? 1 : 0, row.id);
  return messageRow(database,
    database.prepare('SELECT * FROM communication_messages WHERE id = ?').get(row.id), session);
}

module.exports = {
  MESSAGE_LIMIT,
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
};
