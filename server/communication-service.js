const crypto = require('node:crypto');
const { db: defaultDb, runTransaction } = require('./db');
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

const transaction = runTransaction;

function identityLabel(key) {
  return IDENTITY_LABELS[key] || key || '未知身份';
}

function userCards(database, userIds) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const cards = new Map();
  if (!unique.length) return cards;
  const placeholders = unique.map(() => '?').join(',');
  const rows = database.prepare(`SELECT users.id, users.username, users.display_name,
      users.role, profiles.identity_key, profiles.title, avatars.sha256 AS avatar_sha256
    FROM users
    LEFT JOIN user_profiles profiles ON profiles.user_id = users.id
    LEFT JOIN user_avatars avatars ON avatars.user_id = users.id
    WHERE users.id IN (${placeholders})`).all(...unique);
  for (const row of rows) {
    cards.set(row.id, {
      id: row.id,
      account: row.username,
      displayName: row.display_name || row.username,
      identityKey: row.identity_key || (row.role === 'developer' ? 'developer' : row.role === 'admin' ? 'administrator' : 'guest'),
      title: row.title || '',
      avatarUrl: row.avatar_sha256 ? `/api/profiles/${row.id}/avatar?v=${row.avatar_sha256}` : null
    });
  }
  return cards;
}

function userCard(database, userId) {
  return userCards(database, [userId]).get(userId) || null;
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
  const ids = database.prepare(`SELECT user_id FROM communication_channel_members
    WHERE channel_id = ? ORDER BY joined_at, user_id`).all(channelId).map(row => row.user_id);
  const cards = userCards(database, ids);
  return ids.map(id => cards.get(id)).filter(Boolean);
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

function plusOneStats(database, messageIds, viewerId) {
  const stats = { plusOneCounts: new Map(), plusOneMine: new Set() };
  if (!messageIds.length) return stats;
  const placeholders = messageIds.map(() => '?').join(',');
  for (const row of database.prepare(`SELECT message_id, COUNT(*) AS n FROM communication_message_plus_ones
    WHERE message_id IN (${placeholders}) GROUP BY message_id`).all(...messageIds)) {
    stats.plusOneCounts.set(row.message_id, row.n);
  }
  for (const row of database.prepare(`SELECT message_id FROM communication_message_plus_ones
    WHERE message_id IN (${placeholders}) AND user_id = ?`).all(...messageIds, viewerId)) {
    stats.plusOneMine.add(row.message_id);
  }
  return stats;
}

function messageRow(database, row, session, stats = null, senders = null) {
  if (!row) return null;
  const sender = row.sender_user_id
    ? (senders ? (senders.get(row.sender_user_id) || null) : userCard(database, row.sender_user_id))
    : null;
  const viewerId = session?.userId;
  const mine = row.sender_user_id === viewerId;
  const recalled = Boolean(row.recalled_at);
  const auditVisible = recalled && canAuditMessages(session);
  const plusOneCount = stats ? (stats.plusOneCounts.get(row.id) || 0)
    : database.prepare(`SELECT COUNT(*) AS n FROM communication_message_plus_ones
      WHERE message_id = ?`).get(row.id).n;
  const plusOneByMe = stats ? stats.plusOneMine.has(row.id)
    : Boolean(database.prepare(`SELECT 1 FROM communication_message_plus_ones
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

// 批量预取一批频道的序列化上下文（tracker、偏好、各频道最后一条可见消息、加一统计），
// 把逐频道 7 到 8 条查询压缩为每频道 1 条加固定几条全局查询
function prepareChannelContext(database, session, channels) {
  if (!channels.length) {
    return { trackers: new Map(), prefs: new Map(), lastMessages: new Map(), lastMessageStats: plusOneStats(database, [], session.userId) };
  }
  const ids = channels.map(channel => channel.id);
  const placeholders = ids.map(() => '?').join(',');
  const memberRows = new Map(database.prepare(`SELECT channel_id, last_read_message_id FROM communication_channel_members
    WHERE user_id = ? AND channel_id IN (${placeholders})`).all(session.userId, ...ids)
    .map(row => [row.channel_id, Number(row.last_read_message_id) || 0]));
  const observerRows = new Map(database.prepare(`SELECT channel_id, last_read_message_id FROM communication_channel_observers
    WHERE user_id = ? AND channel_id IN (${placeholders})`).all(session.userId, ...ids)
    .map(row => [row.channel_id, Number(row.last_read_message_id) || 0]));
  const trackers = new Map();
  for (const channel of channels) {
    const isMember = memberRows.has(channel.id);
    const observerPath = developerChannelAccess(session) && !isMember && channel.kind !== 'global';
    if (observerPath) ensureObserver(database, channel.id, session.userId);
    else ensureMember(database, channel.id, session.userId);
    const kind = observerPath ? 'observer' : 'member';
    const from = observerPath ? observerRows : memberRows;
    trackers.set(channel.id, { kind, lastReadMessageId: from.get(channel.id) || 0 });
  }
  const prefs = new Map(database.prepare(`SELECT channel_id, pinned, muted FROM communication_channel_prefs
    WHERE user_id = ? AND channel_id IN (${placeholders})`).all(session.userId, ...ids)
    .map(row => [row.channel_id, row]));
  const lastMessages = new Map();
  for (const row of database.prepare(`SELECT m.* FROM communication_messages m
    JOIN (SELECT channel_id, MAX(id) AS max_id FROM communication_messages
      WHERE channel_id IN (${placeholders}) AND NOT EXISTS (
        SELECT 1 FROM communication_message_deletions deletions
        WHERE deletions.message_id = communication_messages.id AND deletions.user_id = ?
      ) GROUP BY channel_id) last
    ON last.channel_id = m.channel_id AND last.max_id = m.id`).all(...ids, session.userId)) {
    lastMessages.set(row.channel_id, row);
  }
  const lastMessageStats = plusOneStats(database, [...lastMessages.values()].map(row => row.id), session.userId);
  return { trackers, prefs, lastMessages, lastMessageStats };
}

function serializeChannel(database, session, channel, context = null) {
  const prepared = context || prepareChannelContext(database, session, [channel]);
  const tracker = prepared.trackers.get(channel.id)
    || { kind: 'member', lastReadMessageId: 0 };
  const members = channel.kind === 'private' || channel.kind === 'custom'
    ? membersForChannel(database, channel.id) : [];
  const developerObserver = tracker.kind === 'observer';
  const counterpart = channel.kind === 'private'
    ? (developerObserver ? null : members.find(member => member.id !== session.userId) || null) : null;
  const privateAuditName = channel.kind === 'private' && developerObserver
    ? members.map(member => member.displayName).join(' ↔ ') : '';
  const statsQuery = database.prepare(`SELECT COUNT(*) AS n, MIN(id) AS first_id FROM communication_messages
    WHERE channel_id = ? AND id > ? AND sender_user_id IS NOT ? AND recalled_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM communication_message_deletions deletions
        WHERE deletions.message_id = communication_messages.id AND deletions.user_id = ?
      )`).get(channel.id, tracker.lastReadMessageId, session.userId, session.userId);
  const prefs = prepared.prefs.get(channel.id) || { pinned: 0, muted: 0 };
  const ownAvatarUrl = channel.avatar
    ? `/api/communications/channels/${encodeURIComponent(channel.id)}/avatar?v=${channel.avatar_updated_at || 0}` : null;
  return {
    id: channel.id,
    kind: channel.kind,
    name: privateAuditName || counterpart?.displayName || channel.name,
    description: channel.description,
    identityKey: channel.identity_key || null,
    identityLabel: channel.identity_key ? identityLabel(channel.identity_key) : null,
    avatarUrl: channel.kind === 'private'
      ? (counterpart?.avatarUrl || ownAvatarUrl || null)
      : (ownAvatarUrl || counterpart?.avatarUrl || null),
    announcement: channel.announcement || '',
    pinned: Boolean(prefs.pinned),
    muted: Boolean(prefs.muted),
    ownerUserId: channel.owner_user_id || null,
    mine: channel.owner_user_id === session.userId,
    developerObserver,
    members,
    memberCount: members.length,
    unreadCount: statsQuery.n,
    firstUnreadMessageId: statsQuery.first_id || null,
    lastMessage: messageRow(database, prepared.lastMessages.get(channel.id) || null, session, prepared.lastMessageStats),
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
  const context = prepareChannelContext(database, session, rows);
  return rows.map(row => serializeChannel(database, session, row, context))
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
  const messageStats = plusOneStats(database, rows.map(row => row.id), session.userId);
  const senders = userCards(database, rows.map(row => row.sender_user_id));
  const messages = rows.map(row => messageRow(database, row, session, messageStats, senders));
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

function canManageChannelSettings(database, session, channel) {
  if (developerChannelAccess(session)) return true;
  return channel.kind === 'custom' && channel.owner_user_id === session.userId;
}

function updateChannelSettings(database = defaultDb, session, channelId, input = {}) {
  const channel = requireChannel(database, session, channelId);
  assert(canManageChannelSettings(database, session, channel), '只有频道创建者可以修改频道设置');
  const record = input && typeof input === 'object' ? input : {};
  const updates = {};
  if (record.name !== undefined) {
    const name = String(record.name).trim();
    assert(Array.from(name).length >= 2 && Array.from(name).length <= 30, '频道名称应为 2 至 30 个字符');
    updates.name = name;
  }
  if (record.description !== undefined) {
    const description = String(record.description).trim();
    assert(Array.from(description).length <= 100, '频道说明不能超过 100 个字符');
    updates.description = description;
  }
  if (record.announcement !== undefined) {
    const announcement = String(record.announcement).trim();
    assert(Array.from(announcement).length <= 500, '频道公告不能超过 500 个字符');
    updates.announcement = announcement;
  }
  assert(Object.keys(updates).length, '没有需要修改的内容');
  const keys = Object.keys(updates);
  transaction(database, () => {
    database.prepare(`UPDATE communication_channels SET ${keys.map(key => key + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map(key => updates[key]), Date.now(), channelId);
  });
  return serializeChannel(database, session, channelById(database, channelId));
}

function setChannelAvatar(database = defaultDb, session, channelId, dataUrl) {
  const channel = requireChannel(database, session, channelId);
  assert(canManageChannelSettings(database, session, channel), '只有频道创建者可以修改频道头像');
  const match = typeof dataUrl === 'string'
    ? dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/) : null;
  assert(match, '频道头像仅支持 PNG、JPG 或 WebP 图片');
  const data = Buffer.from(match[2], 'base64');
  assert(data.length > 0 && data.length <= 512 * 1024, '频道头像不能超过 512KB');
  const now = Date.now();
  database.prepare('UPDATE communication_channels SET avatar = ?, avatar_mime = ?, avatar_updated_at = ?, updated_at = ? WHERE id = ?')
    .run(data, match[1], now, now, channelId);
  return { avatarUrl: '/api/communications/channels/' + encodeURIComponent(channelId) + '/avatar?v=' + now };
}

function clearChannelAvatar(database = defaultDb, session, channelId) {
  const channel = requireChannel(database, session, channelId);
  assert(canManageChannelSettings(database, session, channel), '只有频道创建者可以修改频道头像');
  const now = Date.now();
  database.prepare('UPDATE communication_channels SET avatar = NULL, avatar_mime = NULL, avatar_updated_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, channelId);
  return { avatarUrl: null };
}

function readChannelAvatar(database = defaultDb, channelId) {
  const row = database.prepare('SELECT avatar, avatar_mime, avatar_updated_at FROM communication_channels WHERE id = ?')
    .get(channelId);
  if (!row || !row.avatar || !row.avatar_mime) return null;
  return { data: row.avatar, mime: row.avatar_mime, updatedAt: row.avatar_updated_at || 0 };
}

function updateChannelPreferences(database = defaultDb, session, channelId, input = {}) {
  requireChannel(database, session, channelId);
  const record = input && typeof input === 'object' ? input : {};
  const pinned = record.pinned ? 1 : 0;
  const muted = record.muted ? 1 : 0;
  database.prepare(`INSERT INTO communication_channel_prefs (channel_id, user_id, pinned, muted)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (channel_id, user_id) DO UPDATE SET pinned = excluded.pinned, muted = excluded.muted`)
    .run(channelId, session.userId, pinned, muted);
  return { pinned: Boolean(pinned), muted: Boolean(muted) };
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

function sendMessage(database = defaultDb, session, channelId, rawContent, hooks = {}) {
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
    const row = database.prepare('SELECT * FROM communication_messages WHERE id = ?').get(inserted.lastInsertRowid);
    // 通知写入与消息共用事务（runTransaction 嵌套感知）：通知失败整条发送回滚
    if (typeof hooks.afterInsert === 'function') hooks.afterInsert(messageRow(database, row, session));
    return row;
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
  transaction(database, () => {
    database.prepare(`UPDATE communication_messages
      SET recalled_at = ?, recalled_by_user_id = ? WHERE id = ?`).run(now, session.userId, row.id);
    database.prepare('UPDATE communication_channels SET updated_at = ? WHERE id = ?').run(now, row.channel_id);
  });
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
  toggleMessagePlusOne,
  setChannelAvatar,
  clearChannelAvatar,
  readChannelAvatar,
  updateChannelSettings,
  updateChannelPreferences
};
