const assert = require('node:assert/strict');
const test = require('node:test');

process.env.STELLA_DB_PATH = ':memory:';
const { db } = require('./db');
const { sendMessage } = require('./communication-service');
const {
  createMessageNotification,
  createNotification,
  ensureVersionNotification,
  listNotifications,
  listPublishedNotifications,
  markAllNotificationsRead,
  markChannelNotificationsRead,
  markNotificationRead,
  publishNotification,
  resolveTargetUsers,
  syncMessageUrgency
} = require('./notification-service');

const now = Date.now();
for (const user of [
  { id: 'developer', identity: 'developer' },
  { id: 'alice', identity: 'administrator' },
  { id: 'bob', identity: 'commentator' }
]) {
  db.prepare(`INSERT INTO users
    (id, username, display_name, password_hash, salt, role, permissions_json, status, created_at, updated_at)
    VALUES (?, ?, ?, 'hash', 'salt', ?, '[]', 'active', ?, ?)`).run(
    user.id, user.id, user.id.toUpperCase(), user.identity === 'developer' ? 'developer' : 'user', now, now
  );
  db.prepare(`INSERT INTO user_profiles (user_id, identity_key, created_at, updated_at)
    VALUES (?, ?, ?, ?)`).run(user.id, user.identity, now, now);
  db.prepare(`INSERT INTO user_identity_assignments (user_id, identity_key, sort_order)
    VALUES (?, ?, 0)`).run(user.id, user.identity);
}

const developer = { userId: 'developer', activeIdentityKey: 'developer' };
const alice = { userId: 'alice', activeIdentityKey: 'administrator' };

test.after(() => db.close());

test('manual publishing expands account and identity targets into concrete recipients', () => {
  assert.deepEqual(resolveTargetUsers(db, { kind: 'identity', value: 'commentator' }), ['bob']);
  const result = publishNotification(db, developer, {
    title: '赛程调整',
    summary: '今晚赛程提前十分钟',
    body: '请相关岗位提前完成设备检查。',
    urgent: true,
    target: { kind: 'identity', value: 'commentator' }
  });
  assert.deepEqual(result.recipientUserIds, ['bob']);
  const bobFeed = listNotifications(db, 'bob');
  assert.equal(bobFeed.unreadCount, 1);
  assert.equal(bobFeed.urgentUnreadCount, 1);
  assert.equal(bobFeed.notifications[0].title, '赛程调整');
  assert.equal(listNotifications(db, 'alice').notifications.length, 0);
});

test('read state belongs to each recipient and urgent count persists until read', () => {
  const notification = createNotification(db, {
    type: 'announcement', title: '全员通知', summary: '请确认', urgent: true
  }, ['alice', 'bob']);
  const read = markNotificationRead(db, 'alice', notification.id);
  assert.equal(read.urgentUnreadCount, 0);
  assert.equal(listNotifications(db, 'bob').urgentUnreadCount, 2);
  assert.throws(() => markNotificationRead(db, 'developer', notification.id), /不属于当前账号/);
  assert.equal(markAllNotificationsRead(db, 'bob').urgentUnreadCount, 0);
});

test('message notifications follow channel recipients and urgency promotion resets unread state', () => {
  const message = sendMessage(db, alice, 'global', '请确认导播机位');
  const notification = createMessageNotification(db, message);
  assert.ok(notification);
  assert.equal(listNotifications(db, 'developer').notifications[0].sourceId, String(message.id));
  markNotificationRead(db, 'developer', notification.id);
  message.urgent = true;
  syncMessageUrgency(db, message);
  assert.equal(listNotifications(db, 'developer').urgentUnreadCount, 1);
  assert.ok(markChannelNotificationsRead(db, 'developer', 'global', message.id) >= 1);
  assert.equal(listNotifications(db, 'developer').urgentUnreadCount, 0);
});

test('version notifications are source-deduplicated while adding missing recipients', () => {
  const release = {
    currentVersion: '9.9.9',
    releases: [{ version: '9.9.9', title: '通知测试版', summary: '通知中心已上线' }]
  };
  const first = ensureVersionNotification(db, release);
  const second = ensureVersionNotification(db, release);
  assert.equal(first.id, second.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE source_kind = 'version'").get().n, 1);
});

test('published notification history reports recipient and read totals', () => {
  const history = listPublishedNotifications(db);
  assert.ok(history.notifications.length >= 1);
  assert.ok(history.notifications.every(item => item.recipientCount >= item.readCount));
});
