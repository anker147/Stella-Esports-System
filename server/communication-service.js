const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { db: defaultDb, runTransaction } = require('./db');
const { DATA_ROOT } = require('./data-paths');
const { IDENTITY_LABELS } = require('./permissions-service');

const MESSAGE_LIMIT = 500;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const REVOKED_MESSAGE_TEXT = '消息已撤回';
// 媒体字节落盘目录（v33 赛事媒体先例：库内只留元数据，数据库体积不随上传线性增长）。
// 测试通过 STELLA_COMMUNICATION_MEDIA_ROOT 指向临时目录，绝不写真实 data/。
const MEDIA_ROOT = path.resolve(
  process.env.STELLA_COMMUNICATION_MEDIA_ROOT || path.join(DATA_ROOT, 'media', 'communications'));
const MEDIA_CONTENT_MARKERS = { voice: '[语音]', image: '[图片]', video: '[视频]' };
const THUMB_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const THUMB_MAX_BYTES = 2 * 1024 * 1024;
const VOICE_MAX_DURATION_MS = 60 * 1000;
const MEDIA_MAX_DURATION_MS = 10 * 60 * 1000;
// 每类消息的格式与限额：图片区分压缩版（4MB）与原图（20MB），语音必带时长，视频缩略图为可选封面帧。
const MEDIA_KIND_RULES = {
  voice: {
    mimes: new Set(['audio/webm', 'audio/mp4', 'audio/ogg']),
    maxBytes: 3 * 1024 * 1024,
    durationRequired: true
  },
  image: {
    mimes: new Set(['image/png', 'image/jpeg', 'image/webp']),
    maxBytes: 20 * 1024 * 1024,
    compressedMaxBytes: 4 * 1024 * 1024
  },
  video: {
    mimes: new Set(['video/mp4', 'video/webm', 'video/quicktime']),
    maxBytes: 20 * 1024 * 1024
  }
};
const MEDIA_EXTENSIONS = {
  'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/png': '.png',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg'
};

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

function messagePreviewText(row) {
  const kind = row.kind || 'text';
  if (kind !== 'text') return MEDIA_CONTENT_MARKERS[kind] || '';
  return String(row.content || '').slice(0, 80);
}

// 一批消息的附属数据批量预取（媒体行 + 被引用消息快照），避免逐条 N+1。
// viewerId 用于排除"仅为我删除"的被引用消息（对引用者而言视为不可用）。
function loadMessageExtras(database, rows, viewerId = null) {
  const mediaByMessage = new Map();
  const quotedByMessage = new Map();
  const ids = rows.map(row => row.id).filter(Boolean);
  if (!ids.length) return { mediaByMessage, quotedByMessage };
  const placeholders = ids.map(() => '?').join(',');
  for (const media of database.prepare(`SELECT * FROM communication_message_media
    WHERE message_id IN (${placeholders})`).all(...ids)) {
    mediaByMessage.set(media.message_id, media);
  }
  const quotedIds = [...new Set(rows
    .map(row => Number(row.quoted_message_id))
    .filter(id => Number.isInteger(id) && id > 0))];
  if (!quotedIds.length) return { mediaByMessage, quotedByMessage };
  const quotedPlaceholders = quotedIds.map(() => '?').join(',');
  const quotedParams = viewerId ? [...quotedIds, viewerId] : quotedIds;
  const quotedRows = database.prepare(`SELECT id, sender_display_name, kind, content, recalled_at
    FROM communication_messages
    WHERE id IN (${quotedPlaceholders})
    ${viewerId ? `AND NOT EXISTS (
      SELECT 1 FROM communication_message_deletions deletions
      WHERE deletions.message_id = communication_messages.id AND deletions.user_id = ?
    )` : ''}`).all(...quotedParams);
  for (const quoted of quotedRows) {
    quotedByMessage.set(quoted.id, {
      id: quoted.id,
      senderName: quoted.sender_display_name || '',
      kind: quoted.kind || 'text',
      preview: quoted.recalled_at ? '' : messagePreviewText(quoted),
      recalled: Boolean(quoted.recalled_at)
    });
  }
  return { mediaByMessage, quotedByMessage };
}

function serializeMedia(media) {
  return {
    kind: media.kind,
    mime: media.mime,
    byteSize: media.byte_size,
    durationMs: media.duration_ms || null,
    width: media.width || null,
    height: media.height || null,
    original: Boolean(media.is_original),
    url: `/api/communications/messages/${media.message_id}/media?v=${media.sha256.slice(0, 12)}`,
    thumbUrl: media.thumb_file_path
      ? `/api/communications/messages/${media.message_id}/media?variant=thumb&v=${media.thumb_sha256.slice(0, 12)}`
      : null
  };
}

function messageRow(database, row, session, stats = null, senders = null, extras = null) {
  if (!row) return null;
  const sender = row.sender_user_id
    ? (senders ? (senders.get(row.sender_user_id) || null) : userCard(database, row.sender_user_id))
    : null;
  const viewerId = session?.userId;
  const mine = row.sender_user_id === viewerId;
  const recalled = Boolean(row.recalled_at);
  const auditVisible = recalled && canAuditMessages(session);
  const kind = row.kind || 'text';
  const resolvedExtras = extras || loadMessageExtras(database, [row], viewerId);
  const media = resolvedExtras.mediaByMessage.get(row.id) || null;
  const quotedId = Number(row.quoted_message_id);
  let quoted = null;
  if (Number.isInteger(quotedId) && quotedId > 0) {
    quoted = resolvedExtras.quotedByMessage.get(quotedId) || { id: quotedId, unavailable: true };
  }
  const plusOneCount = stats ? (stats.plusOneCounts.get(row.id) || 0)
    : database.prepare(`SELECT COUNT(*) AS n FROM communication_message_plus_ones
      WHERE message_id = ?`).get(row.id).n;
  const plusOneByMe = stats ? stats.plusOneMine.has(row.id)
    : Boolean(database.prepare(`SELECT 1 FROM communication_message_plus_ones
      WHERE message_id = ? AND user_id = ?`).get(row.id, viewerId));
  return {
    id: row.id,
    channelId: row.channel_id,
    kind,
    quoted,
    media: media ? serializeMedia(media) : null,
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
    canEdit: mine && !recalled && kind === 'text',
    canRecall: mine && !recalled,
    canSetUrgent: mine && !recalled,
    canDelete: true
  };
}

// 批量预取一批频道的序列化上下文（tracker、偏好、各频道最后一条可见消息、加一统计），
// 把逐频道 7 到 8 条查询压缩为每频道 1 条加固定几条全局查询
function prepareChannelContext(database, session, channels) {
  if (!channels.length) {
    return {
      trackers: new Map(), prefs: new Map(), lastMessages: new Map(),
      lastMessageStats: plusOneStats(database, [], session.userId),
      lastMessageExtras: { mediaByMessage: new Map(), quotedByMessage: new Map() }
    };
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
  const lastMessageExtras = loadMessageExtras(database, [...lastMessages.values()], session.userId);
  return { trackers, prefs, lastMessages, lastMessageStats, lastMessageExtras };
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
    lastMessage: messageRow(database, prepared.lastMessages.get(channel.id) || null, session,
      prepared.lastMessageStats, null, prepared.lastMessageExtras),
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
  const messageExtras = loadMessageExtras(database, rows, session.userId);
  const messages = rows.map(row => messageRow(database, row, session, messageStats, senders, messageExtras));
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

function resolveQuotedMessage(database, session, channelId, quotedMessageId) {
  const id = Number(quotedMessageId);
  assert(Number.isInteger(id) && id > 0, '引用的消息标识无效');
  const row = database.prepare('SELECT * FROM communication_messages WHERE id = ?').get(id);
  assert(row, '引用的消息不存在', 'MESSAGE_NOT_FOUND');
  assert(row.channel_id === channelId, '只能引用本频道的消息');
  const deletedForViewer = database.prepare(`SELECT 1 FROM communication_message_deletions
    WHERE message_id = ? AND user_id = ?`).get(id, session.userId);
  assert(!deletedForViewer, '引用的消息已删除');
  return row;
}

function sendMessage(database = defaultDb, session, channelId, rawContent, hooks = {}, options = {}) {
  const channel = requireChannel(database, session, channelId);
  const content = normalizedMessageContent(rawContent);
  const quoted = options.quotedMessageId != null
    ? resolveQuotedMessage(database, session, channel.id, options.quotedMessageId) : null;
  const sender = userCard(database, session.userId);
  assert(sender, '发送账号不可用');
  const now = Date.now();
  const result = transaction(database, () => {
    const inserted = database.prepare(`INSERT INTO communication_messages
      (channel_id, sender_user_id, sender_display_name, sender_identity_key, content, kind, quoted_message_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'text', ?, ?)`)
      .run(channel.id, session.userId, sender.displayName, session.activeIdentityKey, content,
        quoted ? quoted.id : null, now);
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
  assert((row.kind || 'text') === 'text', '仅文字消息可以修改');
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

function mediaExtension(mime) {
  return MEDIA_EXTENSIONS[mime] || '.bin';
}

function dimensionOrNull(value) {
  const dimension = Number(value);
  return Number.isInteger(dimension) && dimension >= 1 && dimension <= 10000 ? dimension : null;
}

function stageMediaFile(buffer, variant) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const tempPath = path.join(MEDIA_ROOT, `.tmp-${variant}-${crypto.randomUUID()}`);
  return fs.promises.writeFile(tempPath, buffer).then(() => ({ buffer, variant, sha256, tempPath }));
}

// 媒体消息：主文件与可选缩略图先异步写临时文件（事务外不阻塞事件循环），
// 再在事务内插入消息行、rename 成最终名（瞬时）并登记元数据；任何失败回滚数据库并清理文件。
async function sendMediaMessage(database = defaultDb, session, channelId, input = {}, hooks = {}) {
  const channel = requireChannel(database, session, channelId);
  const kind = String(input.kind || '');
  const rule = MEDIA_KIND_RULES[kind];
  assert(rule, '不支持的消息类型');
  const mime = String(input.mime || '').toLowerCase();
  assert(rule.mimes.has(mime), '不支持的文件格式');
  const mainBuffer = Buffer.isBuffer(input.mainBuffer) ? input.mainBuffer : null;
  assert(mainBuffer && mainBuffer.length > 0, '媒体内容不能为空');
  const isOriginal = Boolean(input.isOriginal) && kind === 'image';
  const maxBytes = kind === 'image' && !isOriginal ? rule.compressedMaxBytes : rule.maxBytes;
  assert(mainBuffer.length <= maxBytes, kind === 'image' && !isOriginal
    ? '图片压缩版不能超过 4MB，可勾选原图（上限 20MB）' : '媒体文件不能超过 20MB');
  let durationMs = null;
  if (rule.durationRequired) {
    durationMs = Number(input.durationMs);
    assert(Number.isInteger(durationMs) && durationMs >= 1 && durationMs <= VOICE_MAX_DURATION_MS,
      '语音时长应在 1 秒至 60 秒之间');
  } else if (input.durationMs != null) {
    durationMs = Number(input.durationMs);
    assert(Number.isInteger(durationMs) && durationMs >= 1 && durationMs <= MEDIA_MAX_DURATION_MS,
      '时长数据无效');
  }
  let thumbBuffer = null;
  let thumbMime = null;
  if (Buffer.isBuffer(input.thumbBuffer) && input.thumbBuffer.length > 0) {
    thumbMime = String(input.thumbMime || '').toLowerCase();
    assert(THUMB_MIMES.has(thumbMime), '缩略图仅支持 PNG、JPG 或 WebP');
    assert(input.thumbBuffer.length <= THUMB_MAX_BYTES, '缩略图不能超过 2MB');
    thumbBuffer = input.thumbBuffer;
  } else if (kind === 'image') {
    assert(false, '图片消息必须携带缩略图');
  }
  const quoted = input.quotedMessageId != null
    ? resolveQuotedMessage(database, session, channel.id, input.quotedMessageId) : null;
  const sender = userCard(database, session.userId);
  assert(sender, '发送账号不可用');
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
  const staging = [await stageMediaFile(mainBuffer, 'main')];
  if (thumbBuffer) staging.push(await stageMediaFile(thumbBuffer, 'thumb'));
  const width = dimensionOrNull(input.width);
  const height = dimensionOrNull(input.height);
  const now = Date.now();
  try {
    const result = transaction(database, () => {
      const inserted = database.prepare(`INSERT INTO communication_messages
        (channel_id, sender_user_id, sender_display_name, sender_identity_key, content, kind, quoted_message_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(channel.id, session.userId, sender.displayName, session.activeIdentityKey,
          MEDIA_CONTENT_MARKERS[kind], kind, quoted ? quoted.id : null, now);
      const messageId = Number(inserted.lastInsertRowid);
      for (const item of staging) {
        item.finalPath = path.join(MEDIA_ROOT,
          `${messageId}-${item.variant}-${item.sha256.slice(0, 12)}${mediaExtension(item.variant === 'main' ? mime : thumbMime)}`);
        fs.renameSync(item.tempPath, item.finalPath);
      }
      const main = staging.find(item => item.variant === 'main');
      const thumb = staging.find(item => item.variant === 'thumb');
      database.prepare(`INSERT INTO communication_message_media
        (message_id, kind, mime, byte_size, sha256, width, height, duration_ms, is_original, file_path,
         thumb_mime, thumb_byte_size, thumb_sha256, thumb_width, thumb_height, thumb_file_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(messageId, kind, mime, mainBuffer.length, main.sha256, width, height, durationMs,
          isOriginal ? 1 : 0, path.relative(MEDIA_ROOT, main.finalPath),
          thumb ? thumbMime : null, thumb ? thumbBuffer.length : null, thumb ? thumb.sha256 : null,
          thumb ? dimensionOrNull(input.thumbWidth) : null, thumb ? dimensionOrNull(input.thumbHeight) : null,
          thumb ? path.relative(MEDIA_ROOT, thumb.finalPath) : null, now);
      database.prepare('UPDATE communication_channels SET updated_at = ? WHERE id = ?').run(now, channel.id);
      updateReadTracker(database, session, channel, messageId);
      const row = database.prepare('SELECT * FROM communication_messages WHERE id = ?').get(messageId);
      if (typeof hooks.afterInsert === 'function') hooks.afterInsert(messageRow(database, row, session));
      return row;
    });
    return messageRow(database, result, session);
  } catch (error) {
    for (const item of staging) {
      for (const filePath of [item.tempPath, item.finalPath]) {
        if (!filePath) continue;
        try { fs.unlinkSync(filePath); } catch { /* 回滚清理尽力而为 */ }
      }
    }
    throw error;
  }
}

function readMessageMedia(database = defaultDb, session, messageId, variant = 'main') {
  const row = requireMessage(database, session, messageId);
  assert(!row.recalled_at || canAuditMessages(session), '消息已撤回', 'MEDIA_UNAVAILABLE');
  const media = database.prepare('SELECT * FROM communication_message_media WHERE message_id = ?').get(row.id);
  assert(media, '该消息没有媒体内容', 'MEDIA_NOT_FOUND');
  if (variant === 'thumb') {
    assert(media.thumb_file_path, '该消息没有缩略图', 'MEDIA_NOT_FOUND');
    return {
      filePath: path.join(MEDIA_ROOT, media.thumb_file_path),
      mime: media.thumb_mime,
      byteSize: media.thumb_byte_size,
      sha256: media.thumb_sha256
    };
  }
  return {
    filePath: path.join(MEDIA_ROOT, media.file_path),
    mime: media.mime,
    byteSize: media.byte_size,
    sha256: media.sha256
  };
}

// 管理员导出：全量拉取频道消息（不触发已读副作用、不按用户删除过滤），
// 分批 200 条并批量预取附属数据；导出者身份决定编辑历史等审计字段可见性（messageRow 内控）。
function exportChannelMessages(database = defaultDb, session, channelId) {
  const channel = requireChannel(database, session, channelId);
  const members = channel.kind === 'private' || channel.kind === 'custom'
    ? membersForChannel(database, channel.id) : [];
  const messages = [];
  const BATCH = 200;
  let cursor = 0;
  for (;;) {
    const rows = database.prepare(`SELECT * FROM communication_messages
      WHERE channel_id = ? AND id > ? ORDER BY id LIMIT ?`).all(channel.id, cursor, BATCH);
    if (!rows.length) break;
    cursor = rows.at(-1).id;
    const extras = loadMessageExtras(database, rows, session.userId);
    const stats = plusOneStats(database, rows.map(row => row.id), session.userId);
    const senders = userCards(database, rows.map(row => row.sender_user_id));
    for (const row of rows) {
      messages.push(messageRow(database, row, session, stats, senders, extras));
    }
  }
  return {
    channel: {
      id: channel.id,
      kind: channel.kind,
      name: channel.name,
      description: channel.description,
      announcement: channel.announcement || '',
      members
    },
    messages
  };
}

// 导出 ZIP 只收主文件（缩略图可再生成）：返回可流式写入的文件清单与缺失标记。
function exportMediaFiles(database = defaultDb, messages) {
  const files = [];
  const missingMessageIds = [];
  for (const message of messages) {
    if (!message.media) continue;
    const media = database.prepare('SELECT * FROM communication_message_media WHERE message_id = ?')
      .get(message.id);
    if (!media) { missingMessageIds.push(message.id); continue; }
    const absolutePath = path.join(MEDIA_ROOT, media.file_path);
    if (!fs.existsSync(absolutePath)) { missingMessageIds.push(message.id); continue; }
    files.push({
      messageId: message.id,
      fileName: `media/${message.id}${mediaExtension(media.mime)}`,
      absolutePath,
      byteSize: media.byte_size
    });
  }
  return { files, missingMessageIds };
}

// ===== 整理版聊天记录（人类可读文本） =====
const DIGEST_LINE_WIDTH = 72;

function beijingTime(timestamp) {
  const shifted = new Date(Number(timestamp) + 8 * 3600 * 1000);
  if (!Number.isFinite(shifted.getTime())) return '未知时间';
  const pad = value => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} `
    + `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
}

function formatByteSize(bytes) {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)}MB`;
  if (size >= 1024) return `${Math.round(size / 1024)}KB`;
  return `${size}B`;
}

function digestDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function digestChannelKindLabel(channel) {
  return {
    global: '全局公聊',
    identity: `身份公聊（${identityLabel(channel.identity_key)}）`,
    private: '私聊',
    custom: '自定义频道'
  }[channel.kind] || channel.kind;
}

function plusOneDetails(database, messageIds) {
  const map = new Map();
  if (!messageIds.length) return map;
  const placeholders = messageIds.map(() => '?').join(',');
  for (const row of database.prepare(`SELECT po.message_id, users.username, users.display_name
    FROM communication_message_plus_ones po
    JOIN users ON users.id = po.user_id
    WHERE po.message_id IN (${placeholders})
    ORDER BY po.created_at, po.user_id`).all(...messageIds)) {
    if (!map.has(row.message_id)) map.set(row.message_id, []);
    map.get(row.message_id).push(`${row.display_name || row.username}(${row.username})`);
  }
  return map;
}

// 编辑历史明细含修改人；与界面一致仅开发者身份可见
function editHistoryDetails(database, messageIds) {
  const map = new Map();
  if (!messageIds.length) return map;
  const placeholders = messageIds.map(() => '?').join(',');
  for (const row of database.prepare(`SELECT e.message_id, e.content, e.created_at,
      users.username AS editor_username, users.display_name AS editor_display_name
    FROM communication_message_edits e
    LEFT JOIN users ON users.id = e.editor_user_id
    WHERE e.message_id IN (${placeholders})
    ORDER BY e.id DESC`).all(...messageIds)) {
    if (!map.has(row.message_id)) map.set(row.message_id, []);
    const editor = row.editor_display_name || row.editor_username || '未知';
    const editorAccount = row.editor_username ? `(${row.editor_username})` : '';
    map.get(row.message_id).push({ content: row.content, createdAt: row.created_at, editor: `${editor}${editorAccount}` });
  }
  return map;
}

function memberReadPositions(database, channelId) {
  return database.prepare(`SELECT members.user_id, members.last_read_message_id,
      users.username, users.display_name
    FROM communication_channel_members members
    JOIN users ON users.id = members.user_id
    WHERE members.channel_id = ?
    ORDER BY members.joined_at, members.user_id`).all(channelId)
    .map(row => ({
      label: `${row.display_name || row.username}(${row.username})`,
      lastReadMessageId: Number(row.last_read_message_id) || 0
    }));
}

function digestMediaBody(message) {
  const media = message.media;
  if (!media) return message.content;
  const size = ` ${formatByteSize(media.byteSize)}`;
  if (message.kind === 'voice') return `[语音 ${digestDuration(media.durationMs || 0)}${size}]`;
  if (message.kind === 'image') {
    const dimensions = media.width && media.height ? ` ${media.width}×${media.height}` : '';
    return `[图片${dimensions}${media.original ? ' 原图' : ''}${size}]`;
  }
  return `[视频 ${media.durationMs ? `${digestDuration(media.durationMs)} ` : ''}${size.trim()}]`;
}

// 整理版正文：头部队列信息 + 每频道档案 + 按行消息（含编辑/+1/引用/撤回/加急标注）。
// 时间一律北京时间（UTC+8 固定偏移）；行尾 CRLF 便于 Windows 记事本直接阅读。
function buildChannelTextDigest(database = defaultDb, session, channelId) {
  const snapshot = exportChannelMessages(database, session, channelId);
  const channel = snapshot.channel;
  const messages = snapshot.messages;
  const exporter = userCard(database, session.userId);
  const isDeveloper = canAuditMessages(session);
  const plusOnes = plusOneDetails(database, messages.map(message => message.id));
  const edits = isDeveloper
    ? editHistoryDetails(database, messages.filter(message => message.edited).map(message => message.id))
    : new Map();
  const dash = '─'.repeat(DIGEST_LINE_WIDTH);
  const doubleRule = '═'.repeat(DIGEST_LINE_WIDTH);
  const lines = [];
  lines.push(`╔${doubleRule}╗`);
  lines.push(`  星澜赛事导播系统 · ${channel.name} 聊天记录`);
  lines.push(`  导出者: ${exporter?.displayName || ''}(${exporter?.account || ''})  用户ID: ${session.userId}`);
  lines.push(`  导出时间: ${beijingTime(Date.now())} (北京时间)`);
  lines.push(`  频道: ${channel.name}（${digestChannelKindLabel(channel)}）    消息总数: ${messages.length}`);
  lines.push(`╚${doubleRule}╝`);
  lines.push(doubleRule);
  lines.push(`频道: ${channel.name}`);
  lines.push(`类型: ${digestChannelKindLabel(channel)}    频道ID: ${channel.id}`);
  lines.push(`频道说明: ${channel.description || '（无）'}`);
  if (channel.kind === 'private' && channel.members.length === 2) {
    lines.push(`私聊双方: ${channel.members.map(member => `${member.displayName}(${member.account})`).join(' ↔ ')}`);
  }
  if (channel.kind === 'private' || channel.kind === 'custom') {
    const readPositions = new Map(memberReadPositions(database, channel.id).map(item => [item.label, item.lastReadMessageId]));
    const memberTexts = channel.members.map(member => {
      const label = `${member.displayName}(${member.account})`;
      const position = readPositions.get(label);
      return position ? `${label}(已读至#${position})` : label;
    });
    lines.push(`成员: ${memberTexts.join('、')}`);
  }
  lines.push(`消息数: ${messages.length}`);
  lines.push(dash);
  for (const message of messages) {
    const sender = `${message.sender?.displayName || '未知用户'}(${message.sender?.account || 'unknown'})`;
    let body = message.kind === 'text' ? message.content : digestMediaBody(message);
    if (message.recalled) {
      body = (isDeveloper && message.content !== REVOKED_MESSAGE_TEXT)
        ? `${body} 【已撤回】` : '【已撤回】';
    }
    if (message.urgent) body += ' 【急】';
    lines.push(`[${beijingTime(message.createdAt)}] #${message.id} ${sender}: ${body}`);
    const history = edits.get(message.id);
    if (history?.length) {
      const versions = history
        .map(item => `"${item.content}"(${beijingTime(item.createdAt)} 由 ${item.editor} 修改)`)
        .join('、');
      lines.push(`    └ 编辑记录: 当前为最终版，历史版本依次: ${versions}`);
    }
    const plusOneNames = plusOnes.get(message.id);
    if (plusOneNames?.length) lines.push(`    └ +1: ${plusOneNames.join('、')}`);
    const quoted = message.quoted;
    if (quoted && (!message.recalled || isDeveloper)) {
      const quotedPreview = quoted.recalled
        ? '原消息已撤回'
        : (quoted.unavailable ? '原消息不可见' : `${quoted.senderName || '未知用户'}: ${quoted.preview || ''}`);
      lines.push(`    └ 引用 #${quoted.id} ${quotedPreview}`);
    }
  }
  return {
    fileName: `聊天记录-${channel.name.replace(/[\\/:*?"<>|\s]+/g, '-')}-${new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)}.txt`,
    messageCount: messages.length,
    body: lines.join('\r\n') + '\r\n'
  };
}

module.exports = {
  MESSAGE_LIMIT,
  MEDIA_ROOT,
  buildChannelTextDigest,
  canAccessChannel,
  communicationBootstrap,
  createCustomChannel,
  createPrivateChannel,
  deleteMessageForUser,
  editMessage,
  exportChannelMessages,
  exportMediaFiles,
  listMessages,
  markChannelRead,
  recallMessage,
  readMessageMedia,
  sendMessage,
  sendMediaMessage,
  setMessageUrgent,
  toggleMessagePlusOne,
  setChannelAvatar,
  clearChannelAvatar,
  readChannelAvatar,
  updateChannelSettings,
  updateChannelPreferences
};
