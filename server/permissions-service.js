const { db: defaultDb } = require('./db');

const PERMISSION_CATALOG = Object.freeze([
  { key: 'countdown.operate', group: 'competition', label: '倒计时操作', description: '启动、暂停、重置并调整赛事倒计时。', risk: 'normal' },
  { key: 'operations.view', group: 'competition', label: '查看赛事数据', description: '读取赛事、赛程、战队、选手和比赛记录。', risk: 'normal' },
  { key: 'events.manage', group: 'competition', label: '管理赛事', description: '创建、编辑、开始、结束与标记赛事。', risk: 'high', dependsOn: ['operations.view'] },
  { key: 'bp.view', group: 'competition', label: '查看 BP', description: '读取 BP 场次、阵容和实时状态。', risk: 'normal' },
  { key: 'bp.operate', group: 'competition', label: '操作 BP', description: '创建场次、选择角色并推进 BP 流程。', risk: 'high', dependsOn: ['bp.view'] },
  { key: 'bp.configure', group: 'competition', label: '配置 BP', description: '修改计时、展示和 BP 流程配置。', risk: 'high', dependsOn: ['bp.view'] },
  { key: 'bracket.publish', group: 'competition', label: '发布赛程', description: '上传并发布赛事对阵图。', risk: 'high' },
  { key: 'hud.view', group: 'competition', label: '查看 HUD', description: '读取 HUD 与 Web HUB 输出信息。', risk: 'normal' },
  { key: 'characterStats.view', group: 'data', label: '查看角色数据', description: '读取角色使用率、禁用率、胜率和排名。', risk: 'normal' },
  { key: 'characterStats.manage', group: 'data', label: '管理角色基础数据', description: '新增、修改或停用角色及其技能基础资料。', risk: 'high', dependsOn: ['characterStats.view'] },
  { key: 'materials.view', group: 'content', label: '查看素材', description: '浏览赛事素材和受监控目录。', risk: 'normal' },
  { key: 'materials.manage', group: 'content', label: '管理素材', description: '导入、重命名、删除素材并配置目录。', risk: 'high', dependsOn: ['materials.view'] },
  { key: 'communication.use', group: 'collaboration', label: '使用通讯', description: '使用好友与赛事通讯能力。', risk: 'normal' },
  { key: 'friends.manage', group: 'collaboration', label: '管理好友', description: '搜索用户并发送、接受或移除好友关系。', risk: 'normal', dependsOn: ['communication.use'] },
  { key: 'notifications.publish', group: 'collaboration', label: '发布通知', description: '向全部账号、指定账号或指定身份发布系统通知。', risk: 'high' },
  { key: 'logs.event.view', group: 'audit', label: '查看赛事日志', description: '读取 BP、OBS 与赛事执行日志。', risk: 'normal' },
  { key: 'logs.account.view', group: 'audit', label: '查看账号日志', description: '读取登录、身份切换和账号操作日志。', risk: 'high' },
  { key: 'obs.view', group: 'broadcast', label: '查看 OBS 状态', description: '读取 OBS 连接、场景和输出状态。', risk: 'normal' },
  { key: 'obs.manage', group: 'broadcast', label: '管理 OBS', description: '连接 OBS 并修改导播输出设置。', risk: 'high', dependsOn: ['obs.view'] },
  { key: 'system.status.view', group: 'administration', label: '查看终端状态', description: '读取服务、数据库和本机终端运行状态。', risk: 'normal' },
  { key: 'system.manage', group: 'administration', label: '系统管理', description: '修改系统开放状态和系统级运行策略。', risk: 'high' },
  { key: 'accounts.manage', group: 'administration', label: '账号管理', description: '创建、编辑、停用或删除账号。', risk: 'high' },
  { key: 'permissions.manage', group: 'administration', label: '权限管理', description: '修改身份基线与账号权限例外。', risk: 'high' }
]);

const PERMISSION_KEYS = new Set(PERMISSION_CATALOG.map(item => item.key));
const IDENTITY_LABELS = Object.freeze({
  developer: '系统开发者',
  administrator: '管理员',
  director: '赛事导演',
  commentator: '赛事解说',
  referee: '裁判',
  scorer: '记分员',
  guest: '访客'
});

const DEFAULT_IDENTITY_PERMISSIONS = Object.freeze({
  developer: PERMISSION_CATALOG.map(item => item.key),
  administrator: PERMISSION_CATALOG.map(item => item.key),
  director: ['countdown.operate', 'operations.view', 'events.manage', 'bp.view', 'bp.operate', 'bracket.publish', 'hud.view', 'materials.view', 'characterStats.view', 'logs.event.view', 'obs.view', 'obs.manage'],
  commentator: ['materials.view', 'characterStats.view', 'communication.use', 'friends.manage'],
  referee: ['operations.view', 'bp.view', 'bp.operate', 'hud.view', 'characterStats.view', 'logs.event.view'],
  scorer: [],
  guest: ['characterStats.view', 'communication.use']
});

const PERMISSION_POLICY_VERSION = 5;
const POLICY_ADDITIONS = Object.freeze({
  2: Object.freeze({
    administrator: ['operations.view', 'hud.view', 'friends.manage', 'obs.view'],
    director: ['operations.view', 'hud.view', 'obs.view'],
    commentator: ['friends.manage'],
    referee: ['operations.view', 'hud.view']
  }),
  3: Object.freeze({
    administrator: PERMISSION_CATALOG.map(item => item.key)
  }),
  4: Object.freeze({
    administrator: ['characterStats.manage']
  }),
  5: Object.freeze({
    administrator: ['events.manage'],
    director: ['events.manage']
  })
});

const SAFEGUARDS = Object.freeze([
  { key: 'developer-immutable', label: '开发者固有权限', description: '开发者身份始终拥有全部权限，账号例外不能撤销。' },
  { key: 'developer-required', label: '开发者账号保护', description: '系统必须保留至少一个启用的开发者账号。' },
  { key: 'deny-first', label: '明确拒绝优先', description: '账号明确拒绝优先于单独允许和身份继承。' },
  { key: 'identity-refresh', label: '身份切换即时生效', description: '身份切换后立即重新计算当前会话的最终权限。' },
  { key: 'server-enforced', label: '服务端最终校验', description: '隐藏入口只改善体验，所有受保护操作仍由服务端鉴权。' },
  { key: 'dependency-enforced', label: '前置权限闭包', description: '操作或管理权限缺少对应查看权限时自动失效。' },
  { key: 'unknown-fail-closed', label: '未知权限默认拒绝', description: '未登记在权限目录中的权限键一律不参与授权。' },
  { key: 'session-refresh', label: '在线会话同步', description: '保存权限后立即刷新相关在线会话的最终权限。' },
  { key: 'navigation-convergence', label: '入口权限收敛', description: '前端入口随当前身份的最终权限即时显示或隐藏。' },
  { key: 'audit', label: '高风险变更留痕', description: '身份策略与账号例外的修改写入账号日志。' }
]);

function ensureDefaultPolicies(database = defaultDb) {
  const seeded = database.prepare("SELECT value_json FROM app_settings WHERE key = 'permissions.defaults.seeded'").get();
  const versionRow = database.prepare("SELECT value_json FROM app_settings WHERE key = 'permissions.catalog.version'").get();
  let storedVersion = 1;
  try {
    storedVersion = versionRow ? Number(JSON.parse(versionRow.value_json)) || 1 : 1;
  } catch {}
  if (seeded && storedVersion >= PERMISSION_POLICY_VERSION) return;
  const now = Date.now();
  const insert = database.prepare(`INSERT OR IGNORE INTO identity_permission_policies
    (identity_key, permission_key, enabled, updated_at, updated_by) VALUES (?, ?, 1, ?, NULL)`);
  database.exec('BEGIN');
  try {
    if (!seeded) {
      for (const [identityKey, permissions] of Object.entries(DEFAULT_IDENTITY_PERMISSIONS)) {
        for (const permissionKey of permissions) insert.run(identityKey, permissionKey, now);
      }
    } else {
      for (let version = storedVersion + 1; version <= PERMISSION_POLICY_VERSION; version += 1) {
        for (const [identityKey, permissions] of Object.entries(POLICY_ADDITIONS[version] || {})) {
          for (const permissionKey of permissions) insert.run(identityKey, permissionKey, now);
        }
      }
    }
    database.prepare(`INSERT INTO app_settings (key, value_json) VALUES ('permissions.defaults.seeded', 'true')
      ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`).run();
    database.prepare(`INSERT INTO app_settings (key, value_json) VALUES ('permissions.catalog.version', ?)
      ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`).run(JSON.stringify(PERMISSION_POLICY_VERSION));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function validatePermissionList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}必须为数组`);
  const list = [...new Set(value.map(String))];
  const invalid = list.find(key => !PERMISSION_KEYS.has(key));
  if (invalid) throw new Error(`未知权限：${invalid}`);
  return list;
}

function identityPermissions(identityKey, database = defaultDb) {
  ensureDefaultPolicies(database);
  return database.prepare(`SELECT permission_key FROM identity_permission_policies
    WHERE identity_key = ? AND enabled = 1 ORDER BY permission_key`).all(identityKey)
    .map(row => row.permission_key).filter(key => PERMISSION_KEYS.has(key));
}

function accountOverrides(userId, database = defaultDb) {
  if (!userId) return { grants: [], denies: [] };
  const rows = database.prepare(`SELECT permission_key, effect FROM user_permission_overrides
    WHERE user_id = ? ORDER BY permission_key`).all(userId);
  return {
    grants: rows.filter(row => row.effect === 'grant' && PERMISSION_KEYS.has(row.permission_key)).map(row => row.permission_key),
    denies: rows.filter(row => row.effect === 'deny' && PERMISSION_KEYS.has(row.permission_key)).map(row => row.permission_key)
  };
}

function effectivePermissionDetails(subject, database = defaultDb) {
  const identityKey = subject?.activeIdentityKey || subject?.identityKey || 'guest';
  const immutable = identityKey === 'developer';
  const inherited = immutable ? PERMISSION_CATALOG.map(item => item.key) : identityPermissions(identityKey, database);
  const overrides = accountOverrides(subject?.userId || subject?.id, database);
  const denies = new Set(overrides.denies);
  const grants = new Set(overrides.grants);
  const effectiveSet = new Set(immutable
    ? PERMISSION_KEYS
    : [...PERMISSION_KEYS].filter(key => !denies.has(key) && (grants.has(key) || inherited.includes(key))));
  if (!immutable) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const permission of PERMISSION_CATALOG) {
        if (!effectiveSet.has(permission.key)) continue;
        if ((permission.dependsOn || []).some(required => !effectiveSet.has(required))) {
          effectiveSet.delete(permission.key);
          changed = true;
        }
      }
    }
  }
  const effective = PERMISSION_CATALOG.filter(item => effectiveSet.has(item.key)).map(item => item.key);
  const sources = Object.fromEntries([...PERMISSION_KEYS].map(key => {
    let source = 'none';
    if (immutable) source = 'developer';
    else if (denies.has(key)) source = 'deny';
    else if (grants.has(key)) source = 'grant';
    else if (inherited.includes(key)) source = 'identity';
    if (!effectiveSet.has(key) && source !== 'deny' && source !== 'none') source = 'dependency';
    return [key, source];
  }));
  return { identityKey, immutable, inherited, grants: overrides.grants, denies: overrides.denies, effective, sources };
}

function hasPermission(subject, permissionKey, database = defaultDb) {
  if (!PERMISSION_KEYS.has(permissionKey)) return false;
  return effectivePermissionDetails(subject, database).effective.includes(permissionKey);
}

function accountRows(database = defaultDb) {
  return database.prepare(`SELECT users.id, users.username, users.display_name, users.role, users.status,
      GROUP_CONCAT(user_identity_assignments.identity_key, ',') AS identity_keys
    FROM users
    LEFT JOIN user_identity_assignments ON user_identity_assignments.user_id = users.id
    GROUP BY users.id ORDER BY users.created_at, users.username`).all();
}

function permissionCenterSnapshot(database = defaultDb) {
  ensureDefaultPolicies(database);
  const identities = Object.entries(IDENTITY_LABELS).map(([key, label]) => ({
    key,
    label,
    immutable: key === 'developer',
    permissions: key === 'developer' ? [...PERMISSION_KEYS] : identityPermissions(key, database),
    accountCount: database.prepare(`SELECT COUNT(*) AS count FROM user_identity_assignments
      WHERE identity_key = ?`).get(key).count
  }));
  const accounts = accountRows(database).map(row => {
    const identityKeys = String(row.identity_keys || (row.role === 'developer' ? 'developer' : row.role === 'admin' ? 'administrator' : 'guest')).split(',').filter(Boolean);
    const overrides = accountOverrides(row.id, database);
    return {
      id: row.id,
      account: row.username,
      displayName: row.display_name || row.username,
      role: row.role,
      status: row.status,
      identityKeys,
      grants: overrides.grants,
      denies: overrides.denies,
      effectiveByIdentity: Object.fromEntries(identityKeys.map(identityKey => [
        identityKey,
        effectivePermissionDetails({ userId: row.id, activeIdentityKey: identityKey }, database).effective
      ]))
    };
  });
  return {
    catalog: PERMISSION_CATALOG,
    groups: [
      { key: 'competition', label: '赛事执行' },
      { key: 'data', label: '数据分析' },
      { key: 'content', label: '内容资源' },
      { key: 'collaboration', label: '协作通讯' },
      { key: 'broadcast', label: '导播输出' },
      { key: 'audit', label: '审计日志' },
      { key: 'administration', label: '系统治理' }
    ],
    identities,
    accounts,
    safeguards: SAFEGUARDS,
    precedence: ['developer', 'deny', 'grant', 'identity', 'none']
  };
}

function saveIdentityPermissions(identityKey, permissions, actorUserId, database = defaultDb) {
  if (!Object.prototype.hasOwnProperty.call(IDENTITY_LABELS, identityKey)) throw new Error('身份不存在');
  if (identityKey === 'developer') throw new Error('开发者身份权限不可修改');
  const values = validatePermissionList(permissions, '身份权限');
  const now = Date.now();
  database.exec('BEGIN');
  try {
    database.prepare('DELETE FROM identity_permission_policies WHERE identity_key = ?').run(identityKey);
    const insert = database.prepare(`INSERT INTO identity_permission_policies
      (identity_key, permission_key, enabled, updated_at, updated_by) VALUES (?, ?, 1, ?, ?)`);
    values.forEach(key => insert.run(identityKey, key, now, actorUserId || null));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { identityKey, permissions: identityPermissions(identityKey, database) };
}

function saveAccountOverrides(userId, grants, denies, actorUserId, database = defaultDb) {
  const user = database.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('账号不存在');
  const grantList = validatePermissionList(grants, '单独允许权限');
  const denyList = validatePermissionList(denies, '明确拒绝权限');
  const overlap = grantList.find(key => denyList.includes(key));
  if (overlap) throw new Error(`权限不能同时允许和拒绝：${overlap}`);
  const now = Date.now();
  database.exec('BEGIN');
  try {
    database.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?').run(userId);
    const insert = database.prepare(`INSERT INTO user_permission_overrides
      (user_id, permission_key, effect, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)`);
    grantList.forEach(key => insert.run(userId, key, 'grant', now, actorUserId || null));
    denyList.forEach(key => insert.run(userId, key, 'deny', now, actorUserId || null));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { userId, ...accountOverrides(userId, database) };
}

ensureDefaultPolicies();

module.exports = {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  IDENTITY_LABELS,
  DEFAULT_IDENTITY_PERMISSIONS,
  SAFEGUARDS,
  ensureDefaultPolicies,
  identityPermissions,
  accountOverrides,
  effectivePermissionDetails,
  hasPermission,
  permissionCenterSnapshot,
  saveIdentityPermissions,
  saveAccountOverrides
};
