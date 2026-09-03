const assert = require('node:assert/strict');
const test = require('node:test');

process.env.STELLA_DB_PATH = ':memory:';
const { db } = require('./db');
const {
  MESSAGE_LIMIT,
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

test.after(() => db.close());

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
