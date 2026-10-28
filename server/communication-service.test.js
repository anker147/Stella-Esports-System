const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.STELLA_DB_PATH = ':memory:';
process.env.STELLA_COMMUNICATION_MEDIA_ROOT
  = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-comm-media-'));
const { db } = require('./db');
const {
  MEDIA_ROOT,
  MESSAGE_LIMIT,
  buildChannelTextDigest,
  clearChannelAvatar,
  clearChannelHistoryForUser,
  communicationBootstrap,
  createCustomChannel,
  createPrivateChannel,
  deleteMessageForUser,
  editMessage,
  exportChannelMessages,
  exportMediaFiles,
  listMessages,
  markChannelRead,
  readMessageMedia,
  recallMessage,
  sendMessage,
  sendMediaMessage,
  setChannelAvatar,
  setMessageUrgent,
  toggleMessagePlusOne,
  updateChannelSettings
} = require('./communication-service');
const { createMessageNotification } = require('./notification-service');

const now = Date.now();
const users = [
  ['alice', 'alice', 'Alice', 'admin'],
  ['bob', 'bob', 'Bob', 'user'],
  ['carol', 'carol', 'Carol', 'user'],
  ['developer', 'developer', 'Developer', 'developer']
];

for (const [id, username, displayName, role] of users) {
  db.prepare(`INSERT INTO users
    (id, username, display_name, password_hash, salt, role, permissions_json, status, created_at, updated_at)
    VALUES (?, ?, ?, 'hash', 'salt', ?, '[]', 'active', ?, ?)`)
    .run(id, username, displayName, role, now, now);
  db.prepare(`INSERT INTO user_profiles (user_id, identity_key, created_at, updated_at)
    VALUES (?, ?, ?, ?)`).run(id,
      id === 'developer' ? 'developer' : (id === 'bob' ? 'commentator' : 'administrator'), now, now);
}

db.prepare(`INSERT INTO user_relationships
  (user_low_id, user_high_id, requested_by, status, created_at, updated_at)
  VALUES ('alice', 'bob', 'alice', 'accepted', ?, ?)`).run(now, now);

const alice = { userId: 'alice', activeIdentityKey: 'administrator' };
const bob = { userId: 'bob', activeIdentityKey: 'commentator' };
const carol = { userId: 'carol', activeIdentityKey: 'administrator' };
const developer = { userId: 'developer', activeIdentityKey: 'developer' };

test.after(() => {
  db.close();
  fs.rmSync(process.env.STELLA_COMMUNICATION_MEDIA_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('bootstrap exposes global and only the active identity public channel', () => {
  const snapshot = communicationBootstrap(db, alice);
  assert.equal(snapshot.messageLimit, 500);
  assert.deepEqual(snapshot.channels.map(channel => channel.id), ['global', 'identity:administrator']);
  assert.deepEqual(snapshot.contacts.map(contact => contact.id), ['bob']);
});

test('private chats are restricted to accepted friends and their two members', () => {
  const channel = createPrivateChannel(db, alice, 'bob');
  assert.equal(channel.kind, 'private');
  assert.equal(channel.name, 'Bob');
  const message = sendMessage(db, alice, channel.id, '私聊测试');
  assert.equal(message.content, '私聊测试');
  assert.equal(listMessages(db, bob, channel.id).messages.length, 1);
  assert.throws(() => listMessages(db, carol, channel.id), /无权访问/);
  assert.throws(() => createPrivateChannel(db, alice, 'carol'), /只能与已添加的好友/);
});

test('identity public chat follows the active session identity', () => {
  sendMessage(db, alice, 'identity:administrator', '管理员频道');
  assert.equal(listMessages(db, carol, 'identity:administrator').messages[0].content, '管理员频道');
  assert.throws(() => listMessages(db, bob, 'identity:administrator'), /无权访问/);
});

test('custom channels include only selected friends and their owner', () => {
  const channel = createCustomChannel(db, alice, {
    name: '赛事协调组',
    description: '临场信息同步',
    memberIds: ['bob']
  });
  assert.equal(channel.kind, 'custom');
  assert.equal(channel.memberCount, 2);
  sendMessage(db, bob, channel.id, '收到');
  assert.equal(listMessages(db, alice, channel.id).messages[0].content, '收到');
  assert.throws(() => listMessages(db, carol, channel.id), /无权访问/);
});

test('developer can inspect and chat in every channel without becoming a member', () => {
  const snapshot = communicationBootstrap(db, developer);
  assert.equal(snapshot.channels.some(channel => channel.id === 'identity:commentator'), true);
  const privateChannel = snapshot.channels.find(channel => channel.kind === 'private');
  const customChannel = snapshot.channels.find(channel => channel.kind === 'custom');
  assert(privateChannel);
  assert(customChannel);
  assert.equal(privateChannel.name, 'Alice ↔ Bob');
  assert.equal(privateChannel.developerObserver, true);
  assert.equal(customChannel.developerObserver, true);
  assert.equal(privateChannel.memberCount, 2);
  assert.equal(customChannel.memberCount, 2);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM communication_channel_members
    WHERE user_id = 'developer' AND channel_id IN (?, ?)`).get(privateChannel.id, customChannel.id).n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM communication_channel_observers
    WHERE user_id = 'developer' AND channel_id IN (?, ?)`).get(privateChannel.id, customChannel.id).n, 2);

  const privateMessage = sendMessage(db, developer, privateChannel.id, '开发者加入私聊');
  const customMessage = sendMessage(db, developer, customChannel.id, '开发者加入频道');
  assert.equal(listMessages(db, alice, privateChannel.id, { markRead: false }).messages
    .some(message => message.id === privateMessage.id), true);
  assert.equal(listMessages(db, bob, customChannel.id, { markRead: false }).messages
    .some(message => message.id === customMessage.id), true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM communication_channel_members
    WHERE user_id = 'developer' AND channel_id IN (?, ?)`).get(privateChannel.id, customChannel.id).n, 0);
});

test('text messages allow 500 Unicode characters and reject longer content', () => {
  const accepted = '测'.repeat(MESSAGE_LIMIT);
  assert.equal(sendMessage(db, alice, 'global', accepted).content.length, MESSAGE_LIMIT);
  assert.throws(() => sendMessage(db, alice, 'global', '测'.repeat(MESSAGE_LIMIT + 1)), /不能超过 500 字/);
  assert.equal(Array.from(sendMessage(db, alice, 'global', '😀'.repeat(MESSAGE_LIMIT)).content).length, MESSAGE_LIMIT);
});

test('message history paginates backward without a load-more action', () => {
  for (let index = 0; index < 55; index += 1) {
    sendMessage(db, alice, 'global', `历史消息 ${index + 1}`);
  }
  const latest = listMessages(db, alice, 'global', { limit: 50, markRead: false });
  assert.equal(latest.messages.length, 50);
  assert.equal(latest.hasMore, true);
  const older = listMessages(db, alice, 'global', {
    before: latest.messages[0].id,
    limit: 50,
    markRead: false
  });
  assert.ok(older.messages.length >= 5);
  assert.equal(older.hasMore, false);
});

test('bootstrap prefetch preserves unread state and read positions cannot pass the channel latest message', () => {
  const snapshot = communicationBootstrap(db, bob, 'global');
  const global = snapshot.channels.find(channel => channel.id === 'global');
  assert.ok(global.unreadCount > 0);
  const before = db.prepare(`SELECT last_read_message_id FROM communication_channel_members
    WHERE channel_id = 'global' AND user_id = 'bob'`).get().last_read_message_id;
  assert.equal(before, 0);

  const read = markChannelRead(db, bob, 'global', Number.MAX_SAFE_INTEGER);
  const latest = db.prepare(`SELECT MAX(id) AS id FROM communication_messages
    WHERE channel_id = 'global'`).get().id;
  assert.equal(read.lastReadMessageId, latest);
});

test('edited messages expose timestamped history only to the developer identity', () => {
  const original = sendMessage(db, alice, 'global', '第一版内容');
  editMessage(db, alice, original.id, '第二版内容');
  editMessage(db, alice, original.id, '最终内容');

  const operatorView = listMessages(db, alice, 'global', { before: original.id + 1, limit: 1, markRead: false }).messages[0];
  assert.equal(operatorView.content, '最终内容');
  assert.equal(operatorView.edited, true);
  assert.deepEqual(operatorView.editHistory, []);

  const developer = { ...alice, activeIdentityKey: 'developer' };
  const developerView = listMessages(db, developer, 'global', {
    before: original.id + 1, limit: 1, markRead: false
  }).messages[0];
  assert.deepEqual(developerView.editHistory.map(item => item.content), ['第二版内容', '第一版内容']);
  assert.ok(developerView.editHistory.every(item => Number.isFinite(item.createdAt)));
});

test('recalled content is retained only in the developer audit view', () => {
  const sent = sendMessage(db, alice, 'global', '需要撤回的原文');
  recallMessage(db, alice, sent.id);

  const normalView = listMessages(db, bob, 'global', { before: sent.id + 1, limit: 1, markRead: false }).messages[0];
  assert.equal(normalView.content, '消息已撤回');
  assert.equal(normalView.developerRecallVisible, false);

  const developerView = listMessages(db, { ...alice, activeIdentityKey: 'developer' }, 'global', {
    before: sent.id + 1, limit: 1, markRead: false
  }).messages[0];
  assert.equal(developerView.content, '需要撤回的原文');
  assert.equal(developerView.developerRecallVisible, true);
  assert.ok(developerView.recalledAt);
});

test('deleting a message hides it only for the requesting account', () => {
  const sent = sendMessage(db, alice, 'global', '仅 Bob 删除');
  deleteMessageForUser(db, bob, sent.id);
  assert.equal(listMessages(db, bob, 'global', {
    before: sent.id + 1, limit: 100, markRead: false
  }).messages.some(message => message.id === sent.id), false);
  assert.equal(
    listMessages(db, alice, 'global', { before: sent.id + 1, limit: 1, markRead: false }).messages[0].content,
    '仅 Bob 删除'
  );
});

test('+1 reactions toggle per account and urgent state is controlled by the sender', () => {
  const sent = sendMessage(db, alice, 'global', '需要确认的消息');
  assert.equal(toggleMessagePlusOne(db, bob, sent.id).plusOneCount, 1);
  assert.equal(toggleMessagePlusOne(db, bob, sent.id).plusOneCount, 0);
  assert.equal(setMessageUrgent(db, alice, sent.id, true).urgent, true);
  assert.throws(() => setMessageUrgent(db, bob, sent.id, false), /只能为自己发送/);
});

test('unread message windows anchor the first unread and paginate forward', () => {
  markChannelRead(db, carol, 'global');
  const firstUnread = sendMessage(db, alice, 'global', '未读起点');
  for (let index = 0; index < 30; index += 1) {
    sendMessage(db, alice, 'global', `未读后续 ${index + 1}`);
  }

  const window = listMessages(db, carol, 'global', { unread: true, limit: 20, markRead: false });
  assert.equal(window.firstUnreadMessageId, firstUnread.id);
  assert.ok(window.messages.some(message => message.id === firstUnread.id));
  assert.equal(window.hasNewer, true);

  const forward = listMessages(db, carol, 'global', {
    after: window.messages.at(-1).id, limit: 20, markRead: false
  });
  assert.ok(forward.messages.length > 0);
  assert.ok(forward.messages.every(message => message.id > window.messages.at(-1).id));
});

test('markChannelRead drives the batched unread watermark surfaced by bootstrap', () => {
  markChannelRead(db, alice, 'global', null);
  const first = sendMessage(db, bob, 'global', 'watermark one');
  const second = sendMessage(db, bob, 'global', 'watermark two');
  let snapshot = communicationBootstrap(db, alice, null);
  const before = snapshot.channels.find(channel => channel.id === 'global');
  assert.equal(before.unreadCount, 2);
  assert.equal(before.firstUnreadMessageId, first.id);

  markChannelRead(db, alice, 'global', first.id);
  snapshot = communicationBootstrap(db, alice, null);
  const after = snapshot.channels.find(channel => channel.id === 'global');
  assert.equal(after.unreadCount, 1);
  assert.equal(after.firstUnreadMessageId, second.id);
  assert.equal(after.lastMessage.sender.displayName, 'Bob');
});

test('a failing post-send hook rolls the message and its notification back together', () => {
  const messagesBefore = db.prepare('SELECT COUNT(*) AS n FROM communication_messages').get().n;
  const notificationsBefore = db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n;
  assert.throws(() => sendMessage(db, bob, 'global', 'rollback probe', {
    afterInsert: (serialized) => {
      createMessageNotification(db, serialized, false);
      throw new Error('post-notification failure');
    }
  }), /post-notification failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM communication_messages').get().n, messagesBefore);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, notificationsBefore);

  const message = sendMessage(db, bob, 'global', 'notification probe', {
    afterInsert: (serialized) => { createMessageNotification(db, serialized, false); }
  });
  const notification = db.prepare("SELECT id FROM notifications WHERE source_kind = 'message' AND source_id = ?")
    .get(String(message.id));
  assert.ok(notification, 'notification should be committed together with the message');
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const webpThumb = Buffer.from([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9]);

function mediaSha(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

test('media messages validate kind, mime, size and duration before touching storage', async () => {
  const filesBefore = new Set(fs.readdirSync(MEDIA_ROOT));
  await assert.rejects(() => sendMediaMessage(db, alice, 'global', { kind: 'sticker', mainBuffer: png }), /不支持的消息类型/);
  await assert.rejects(() => sendMediaMessage(db, alice, 'global', {
    kind: 'voice', mainBuffer: Buffer.from([1]), mime: 'audio/mpeg', durationMs: 800
  }), /不支持的文件格式/);
  await assert.rejects(() => sendMediaMessage(db, alice, 'global', {
    kind: 'voice', mainBuffer: Buffer.from([1]), mime: 'audio/webm'
  }), /语音时长/);
  await assert.rejects(() => sendMediaMessage(db, alice, 'global', {
    kind: 'voice', mainBuffer: Buffer.from([1]), mime: 'audio/webm', durationMs: 61_000
  }), /语音时长/);
  await assert.rejects(() => sendMediaMessage(db, alice, 'global', {
    kind: 'voice', mainBuffer: Buffer.alloc(3 * 1024 * 1024 + 1, 1), mime: 'audio/webm', durationMs: 1000
  }), /媒体文件不能超过 20MB/);
  await assert.rejects(() => sendMediaMessage(db, alice, 'global', {
    kind: 'image', mainBuffer: png, mime: 'image/png'
  }), /图片消息必须携带缩略图/);
  await assert.rejects(() => sendMediaMessage(db, alice, 'global', {
    kind: 'image', mainBuffer: Buffer.alloc(5 * 1024 * 1024, 3), mime: 'image/png', thumbBuffer: webpThumb, thumbMime: 'image/webp'
  }), /4MB/);
  await assert.rejects(() => sendMediaMessage(db, alice, 'global', {
    kind: 'image', mainBuffer: png, mime: 'image/png', thumbBuffer: webpThumb, thumbMime: 'audio/webm'
  }), /缩略图仅支持/);
  assert.deepEqual(new Set(fs.readdirSync(MEDIA_ROOT)), filesBefore, 'rejected media must not leave files behind');
});

test('voice messages persist bytes to disk and read back through readMessageMedia', async () => {
  const voice = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 5, 6, 7, 8, 9]);
  const message = await sendMediaMessage(db, bob, 'global', {
    kind: 'voice', mainBuffer: voice, mime: 'audio/webm', durationMs: 5200
  });
  assert.equal(message.kind, 'voice');
  assert.equal(message.content, '[语音]');
  assert.equal(message.canEdit, false);
  assert.equal(message.canRecall, true);
  assert.match(message.media.url, new RegExp(`^/api/communications/messages/${message.id}/media\\?v=`));
  assert.equal(message.media.thumbUrl, null);
  assert.equal(message.media.durationMs, 5200);
  assert.equal(message.media.byteSize, voice.length);

  const media = readMessageMedia(db, alice, message.id, 'main');
  assert.equal(media.mime, 'audio/webm');
  assert.equal(media.byteSize, voice.length);
  assert.equal(media.sha256, mediaSha(voice));
  assert.deepEqual(fs.readFileSync(media.filePath), voice);

  // 频道列表 lastMessage 走批量预取路径，媒体标记保持服务端权威
  const channel = listMessages(db, bob, 'global', { limit: 1, markRead: false }).channel;
  assert.equal(channel.lastMessage.kind, 'voice');
  assert.equal(channel.lastMessage.content, '[语音]');

  // 撤回后媒体对普通成员屏蔽、开发者审计仍可读
  recallMessage(db, bob, message.id);
  assert.throws(() => readMessageMedia(db, alice, message.id, 'main'), /消息已撤回/);
  const auditMedia = readMessageMedia(db, developer, message.id, 'main');
  assert.equal(auditMedia.sha256, mediaSha(voice));
});

test('image messages store main plus thumbnail variants and honour the original flag', async () => {
  const main = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const compressed = await sendMediaMessage(db, alice, 'global', {
    kind: 'image', mainBuffer: main, mime: 'image/png',
    thumbBuffer: webpThumb, thumbMime: 'image/webp', width: 1600, height: 900,
    thumbWidth: 320, thumbHeight: 180
  });
  assert.equal(compressed.kind, 'image');
  assert.equal(compressed.media.original, false);
  assert.match(compressed.media.url, new RegExp(`^/api/communications/messages/${compressed.id}/media\\?v=`));
  assert.match(compressed.media.thumbUrl, /variant=thumb&v=/);
  assert.deepEqual(fs.readFileSync(readMessageMedia(db, bob, compressed.id, 'thumb').filePath), webpThumb);
  assert.equal(readMessageMedia(db, bob, compressed.id, 'thumb').sha256, mediaSha(webpThumb));

  const original = await sendMediaMessage(db, alice, 'global', {
    kind: 'image', mainBuffer: Buffer.alloc(5 * 1024 * 1024, 7), mime: 'image/png',
    thumbBuffer: webpThumb, thumbMime: 'image/webp', isOriginal: true
  });
  assert.equal(original.media.original, true);
  assert.equal(readMessageMedia(db, bob, original.id, 'main').byteSize, 5 * 1024 * 1024);
});

test('quoted messages snapshot sender and preview, refusing cross-channel or deleted targets', () => {
  const target = sendMessage(db, alice, 'global', '这是被引用的原始消息内容');
  const reply = sendMessage(db, bob, 'global', '引用回复', {}, { quotedMessageId: target.id });
  assert.deepEqual(
    { id: reply.quoted.id, senderName: reply.quoted.senderName, kind: reply.quoted.kind,
      preview: reply.quoted.preview, recalled: reply.quoted.recalled },
    { id: target.id, senderName: 'Alice', kind: 'text', preview: '这是被引用的原始消息内容', recalled: false }
  );
  // 批量列表路径同样带出引用快照（loadMessageExtras 预取）
  const listed = listMessages(db, alice, 'global', { limit: 1, markRead: false }).messages[0];
  assert.equal(listed.id, reply.id);
  assert.equal(listed.quoted.senderName, 'Alice');

  const privateChannel = createPrivateChannel(db, alice, 'bob');
  assert.throws(() => sendMessage(db, bob, privateChannel.id, '跨频道引用', {}, { quotedMessageId: target.id }),
    /只能引用本频道的消息/);
  assert.throws(() => sendMessage(db, bob, 'global', '引用不存在', {}, { quotedMessageId: 999999999 }),
    /引用的消息不存在/);

  deleteMessageForUser(db, bob, target.id);
  assert.throws(() => sendMessage(db, bob, 'global', '引用已删', {}, { quotedMessageId: target.id }),
    /引用的消息已删除/);
  // 引用者自己没删就能继续引用
  const aliceReply = sendMessage(db, alice, 'global', '自己仍可引用', {}, { quotedMessageId: target.id });
  assert.equal(aliceReply.quoted.id, target.id);

  const recalledTarget = sendMessage(db, alice, 'global', '将被撤回的引用目标');
  recallMessage(db, alice, recalledTarget.id);
  const replyToRecalled = sendMessage(db, bob, 'global', '引用撤回消息', {}, { quotedMessageId: recalledTarget.id });
  assert.equal(replyToRecalled.quoted.recalled, true);
  assert.equal(replyToRecalled.quoted.preview, '');
});

test('a failing media post-insert hook rolls the message back and cleans staged files', async () => {
  const filesBefore = new Set(fs.readdirSync(MEDIA_ROOT));
  await assert.rejects(() => sendMediaMessage(db, bob, 'global', {
    kind: 'voice', mainBuffer: Buffer.from([1, 2, 3]), mime: 'audio/webm', durationMs: 1500
  }, {
    afterInsert: () => { throw new Error('post-media failure'); }
  }), /post-media failure/);
  const rows = db.prepare(`SELECT COUNT(*) AS n FROM communication_message_media m
    JOIN communication_messages msg ON msg.id = m.message_id
    WHERE msg.content = '[语音]' AND m.duration_ms = 1500`).get().n;
  assert.equal(rows, 0);
  assert.deepEqual(new Set(fs.readdirSync(MEDIA_ROOT)), filesBefore);
});

test('export snapshots the full channel history with a media manifest', () => {
  // bob 已删除的消息仍在频道级导出中（审计全量），且导出不改动任何人的已读水位
  const watermarkBefore = db.prepare(`SELECT last_read_message_id FROM communication_channel_members
    WHERE channel_id = 'global' AND user_id = 'carol'`).get().last_read_message_id;
  const snapshot = exportChannelMessages(db, developer, 'global');
  assert.equal(snapshot.channel.id, 'global');
  assert.equal(snapshot.messages.some(message => message.content === '仅 Bob 删除'), true);
  assert.equal(snapshot.messages.some(message => message.kind === 'voice'), true);
  assert.equal(snapshot.messages.some(message => message.quoted && message.quoted.senderName === 'Alice'), true);
  const watermarkAfter = db.prepare(`SELECT last_read_message_id FROM communication_channel_members
    WHERE channel_id = 'global' AND user_id = 'carol'`).get().last_read_message_id;
  assert.equal(watermarkAfter, watermarkBefore);

  const { files, missingMessageIds } = exportMediaFiles(db, snapshot.messages);
  assert.ok(files.length >= 2, 'voice and image messages should be listed');
  for (const file of files) {
    assert.match(file.fileName, /^media\/\d+\.(webm|png|jpg|webp|mov|m4a|ogg)$/);
    assert.equal(fs.existsSync(file.absolutePath), true);
    assert.equal(file.byteSize, fs.statSync(file.absolutePath).size);
  }
  assert.deepEqual(missingMessageIds, []);

  // 文件丢失不炸导出：缺失的消息被标记进 missingMessageIds
  const victim = files[0];
  fs.rmSync(victim.absolutePath);
  const afterLoss = exportMediaFiles(db, snapshot.messages);
  assert.deepEqual(afterLoss.missingMessageIds, [victim.messageId]);
  assert.equal(afterLoss.files.some(file => file.messageId === victim.messageId), false);
});

test('text digest renders header, read positions, edits, plus-ones, quotes and media annotations', async () => {
  const channel = createCustomChannel(db, alice, {
    name: '导出演练频道',
    description: '整理版导出演练',
    memberIds: ['bob']
  });
  const edited = sendMessage(db, alice, channel.id, '原始措辞');
  editMessage(db, alice, edited.id, '最终措辞');
  const quotedTarget = sendMessage(db, bob, channel.id, '被引用的原始消息');
  sendMessage(db, alice, channel.id, '整理版引用回复', {}, { quotedMessageId: quotedTarget.id });
  const plusTarget = sendMessage(db, bob, channel.id, '求加一');
  toggleMessagePlusOne(db, alice, plusTarget.id);
  toggleMessagePlusOne(db, bob, plusTarget.id);
  sendMessage(db, alice, channel.id, '加急内容');
  const urgent = sendMessage(db, alice, channel.id, '真的加急');
  setMessageUrgent(db, alice, urgent.id, true);
  const recalled = sendMessage(db, alice, channel.id, '将被撤回的原文');
  recallMessage(db, alice, recalled.id);
  await sendMediaMessage(db, alice, channel.id, {
    kind: 'voice', mainBuffer: Buffer.from([1, 2, 3, 4]), mime: 'audio/webm', durationMs: 5200
  });
  markChannelRead(db, bob, channel.id);

  const digest = buildChannelTextDigest(db, developer, channel.id);
  assert.equal(digest.messageCount, 8);
  assert.equal(digest.fileName.startsWith('聊天记录-导出演练频道-'), true);
  assert.match(digest.body, /星澜赛事导播系统 · 导出演练频道 聊天记录/);
  assert.match(digest.body, /导出时间: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(北京时间\)/);
  assert.match(digest.body, /类型: 自定义频道    频道ID: custom:/);
  assert.match(digest.body, /频道说明: 整理版导出演练/);
  assert.match(digest.body, /成员: Alice\(alice\)\(已读至#\d+\)、Bob\(bob\)\(已读至#\d+\)/);
  assert.match(digest.body, /最终措辞/);
  assert.match(digest.body, /编辑记录: 当前为最终版，历史版本依次: "原始措辞"\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} 由 Alice\(alice\) 修改\)/);
  assert.match(digest.body, /└ \+1: Alice\(alice\)、Bob\(bob\)/);
  assert.match(digest.body, new RegExp(`└ 引用 #${quotedTarget.id} Bob: 被引用的原始消息`));
  assert.match(digest.body, /真的加急 【急】/);
  assert.match(digest.body, /将被撤回的原文 【已撤回】/);
  assert.match(digest.body, /\[语音 0:05/);
  assert.equal(digest.body.includes('\r\n'), true);

  // 管理员视角：编辑历史与撤回原文按界面可见性隐藏，撤回只留占位标记
  const adminDigest = buildChannelTextDigest(db, alice, channel.id);
  assert.equal(adminDigest.body.includes('编辑记录'), false);
  assert.equal(adminDigest.body.includes('将被撤回的原文'), false);
  assert.match(adminDigest.body, /【已撤回】/);
});

test('clearing channel history hides existing messages only for the requesting account', () => {
  const channel = createCustomChannel(db, alice, {
    name: '清空演练频道',
    description: '',
    memberIds: ['bob']
  });
  sendMessage(db, alice, channel.id, '将被清空的一条');
  sendMessage(db, bob, channel.id, '将被清空的另一条');
  const channelBefore = listMessages(db, alice, channel.id, { limit: 10, markRead: false }).channel;
  const watermark = db.prepare(`SELECT last_read_message_id FROM communication_channel_members
    WHERE channel_id = ? AND user_id = 'alice'`).get(channel.id).last_read_message_id;

  const result = clearChannelHistoryForUser(db, alice, channel.id);
  assert.equal(result.cleared, 2);

  // alice 视角：全部隐藏；新消息照常显示；其他成员不受影响
  assert.equal(listMessages(db, alice, channel.id, { limit: 10, markRead: false }).messages.length, 0);
  sendMessage(db, bob, channel.id, '清空之后的新消息');
  const after = listMessages(db, alice, channel.id, { limit: 10, markRead: false }).messages;
  assert.deepEqual(after.map(message => message.content), ['清空之后的新消息']);
  assert.equal(listMessages(db, bob, channel.id, { limit: 10, markRead: false }).messages.length, 3);

  // 已读水位不动（清空不制造未读/已读扰动）
  const watermarkAfter = db.prepare(`SELECT last_read_message_id FROM communication_channel_members
    WHERE channel_id = ? AND user_id = 'alice'`).get(channel.id).last_read_message_id;
  assert.equal(watermarkAfter, watermark);
  void channelBefore;
});

test('private channels reject settings edits and avatar changes', () => {
  const channel = createPrivateChannel(db, alice, 'bob');
  assert.throws(() => updateChannelSettings(db, alice, channel.id, { name: '改名尝试' }), /私聊频道不支持修改/);
  assert.throws(() => setChannelAvatar(db, alice, channel.id, 'data:image/png;base64,aGVsbG8='), /私聊频道不支持自定义头像/);
  assert.throws(() => clearChannelAvatar(db, alice, channel.id), /私聊频道不支持自定义头像/);
});
