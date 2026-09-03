const assert = require('node:assert/strict');
const test = require('node:test');
process.env.STELLA_DB_PATH = ':memory:';
const {
  buildCharacterStats,
  calculateCharacterStats,
  createCharacter,
  updateCharacter,
  archiveCharacter,
  readCharacterPortrait,
  readCharacterSkillIcon
} = require('./character-stats');
const { db } = require('./db');

test.after(() => db.close());

const characters = [
  { id: '逃生甲', role: 'escape', sort_order: 0 },
  { id: '逃生乙', role: 'escape', sort_order: 1 },
  { id: '追捕甲', role: 'hunter', sort_order: 0 },
  { id: '追捕乙', role: 'hunter', sort_order: 1 }
];

function slot(sessionId, winnerRole, characterId, kind, role, decidedAt = 100) {
  return { session_id: sessionId, winner_role: winnerRole, character_id: characterId, kind, role, decided_at: decidedAt };
}

test('character stats retain every enabled character when there are no results', () => {
  const stats = buildCharacterStats(characters, [], 200);
  assert.equal(stats.sample.effectiveGames, 0);
  assert.equal(stats.roles.escape.characters.length, 2);
  assert.deepEqual(stats.roles.escape.characters.map(item => [item.uses, item.bans, item.winRate]), [
    [0, 0, 0], [0, 0, 0]
  ]);
  assert.equal(stats.roles.escape.characters[0].skills.length, 3);
  assert.equal(stats.roles.escape.characters[0].usage.latestTeam, null);
});

test('character profiles are read from normalized database tables', () => {
  db.exec(`
    INSERT INTO characters
      (id, role, sort_order, display_name, release_date_text, portrait_url)
      VALUES ('资料角色', 'escape', 99, '洛杰', '2017年11月8日', '/profile.png');
    INSERT INTO character_skills (character_id, slot, name, description)
      VALUES ('资料角色', 1, '机关大师', '技能描述');
    INSERT INTO character_change_history (character_id, changed_on, title, content, source_order)
      VALUES ('资料角色', '2025-06-26', '天赋增强', '新增保底机制', 0);
  `);
  const character = calculateCharacterStats(db).roles.escape.characters
    .find(item => item.id === '资料角色');
  assert.equal(character.name, '洛杰');
  assert.equal(character.releaseDate, '2017年11月8日');
  assert.equal(character.skills[0].name, '机关大师');
  assert.equal(character.skills.length, 3);
  assert.deepEqual(character.changes, [{
    date: '2025-06-26',
    title: '天赋增强',
    content: '新增保底机制'
  }]);
  assert.equal(character.imageUrl, '/profile.png');
});

test('character stats calculate pick, ban, usage, ban and win rates', () => {
  const rows = [
    slot('g1', 'escape', '逃生甲', 'pick', 'escape'),
    slot('g1', 'escape', '逃生乙', 'pick', 'escape'),
    slot('g1', 'escape', '追捕甲', 'pick', 'hunter'),
    slot('g1', 'escape', '追捕乙', 'ban', 'hunter')
  ];
  const stats = buildCharacterStats(characters, rows);
  const escapeA = stats.roles.escape.characters.find(item => item.id === '逃生甲');
  const hunterA = stats.roles.hunter.characters.find(item => item.id === '追捕甲');
  assert.equal(stats.sample.effectiveGames, 1);
  assert.equal(escapeA.usageRate, 0.5);
  assert.equal(escapeA.winRate, 1);
  assert.equal(hunterA.winRate, 0);
  assert.equal(stats.roles.hunter.totalBans, 1);
});

test('win rate uses distinct selected games instead of raw pick slot count', () => {
  const rows = [
    slot('same-game', 'escape', '逃生甲', 'pick', 'escape'),
    slot('same-game', 'escape', '逃生甲', 'pick', 'escape'),
    slot('lost-game', 'hunter', '逃生甲', 'pick', 'escape')
  ];
  const character = buildCharacterStats(characters, rows).roles.escape.characters
    .find(item => item.id === '逃生甲');
  assert.equal(character.uses, 3);
  assert.equal(character.selectedGames, 2);
  assert.equal(character.wonGames, 1);
  assert.equal(character.winRate, 0.5);
});

test('smoothed win rate prevents a single win from overwhelming established usage', () => {
  const rows = [slot('single', 'escape', '逃生乙', 'pick', 'escape')];
  for (let index = 0; index < 8; index += 1) {
    rows.push(slot(`regular-${index}`, index < 5 ? 'escape' : 'hunter', '逃生甲', 'pick', 'escape'));
  }
  const stats = buildCharacterStats(characters, rows);
  const escapeA = stats.roles.escape.characters.find(item => item.id === '逃生甲');
  const escapeB = stats.roles.escape.characters.find(item => item.id === '逃生乙');
  assert.equal(escapeA.uses, 8);
  assert.equal(escapeB.uses, 1);
  assert.ok(escapeA.rank < escapeB.rank);
  assert.ok(escapeB.adjustedWinRate < escapeB.winRate);
});

test('effective game sample counts sessions once even when each game has many slots', () => {
  const rows = [
    slot('g1', 'hunter', '逃生甲', 'pick', 'escape'),
    slot('g1', 'hunter', '追捕甲', 'pick', 'hunter'),
    slot('g2', 'escape', '逃生乙', 'pick', 'escape', 200)
  ];
  const stats = buildCharacterStats(characters, rows);
  assert.equal(stats.sample.effectiveGames, 2);
  assert.equal(stats.sample.decidedAt, 200);
});

test('database calculation keeps only the highest attempt for one match game and room', () => {
  db.exec(`
    INSERT INTO events (id, name, division, stage) VALUES ('event', '测试赛事', 'mobile', 'group');
    INSERT INTO teams (id, display_name) VALUES ('escape-team', '逃生队'), ('hunter-team', '追捕队');
    INSERT INTO team_logos (team_id, kind, web_file) VALUES ('escape-team', 'escape', '/escape.png');
    INSERT INTO matches (id, event_id, matchup_home, matchup_away) VALUES ('match', 'event', '逃生队', '追捕队');
    INSERT INTO match_rooms (match_id, room, escape_team_id, hunter_team_id)
      VALUES ('match', 'A', 'escape-team', 'hunter-team');
    INSERT INTO players (player_id, team_id, role, slot, nickname, official_id) VALUES
      ('escape-player-1', 'escape-team', 'escape', 'escape1', '旧选手', '10001'),
      ('escape-player-2', 'escape-team', 'escape', 'escape2', '重赛选手', '10002');
    INSERT INTO characters (id, role, sort_order) VALUES
      ('逃生甲', 'escape', 0), ('逃生乙', 'escape', 1), ('追捕甲', 'hunter', 0);
    INSERT INTO bp_slots (id, label, kind, role, sort_order) VALUES
      ('escape-pick', '逃生选择', 'pick', 'escape', 0),
      ('hunter-pick', '追捕选择', 'pick', 'hunter', 1);
    INSERT INTO bp_sessions (id, match_id, game_number, room, attempt, created_at, updated_at) VALUES
      ('attempt-1', 'match', 1, 'A', 1, 10, 10),
      ('attempt-2', 'match', 1, 'A', 2, 20, 20);
    INSERT INTO bp_session_slots (session_id, slot_id, character_id, player_id) VALUES
      ('attempt-1', 'escape-pick', '逃生甲', 'escape-player-1'),
      ('attempt-1', 'hunter-pick', '追捕甲', NULL),
      ('attempt-2', 'escape-pick', '逃生乙', 'escape-player-2'),
      ('attempt-2', 'hunter-pick', '追捕甲', NULL);
    INSERT INTO bp_session_results (session_id, winner_role, winner_team_id, decided_at) VALUES
      ('attempt-1', 'escape', 'escape-team', 100),
      ('attempt-2', 'hunter', 'hunter-team', 200);
  `);
  const stats = calculateCharacterStats(db);
  assert.equal(stats.sample.effectiveGames, 1);
  assert.equal(stats.roles.escape.characters.find(item => item.id === '逃生甲').uses, 0);
  const replayCharacter = stats.roles.escape.characters.find(item => item.id === '逃生乙');
  assert.equal(replayCharacter.uses, 1);
  assert.equal(replayCharacter.usage.latestPlayer.nickname, '重赛选手');
  assert.equal(replayCharacter.usage.latestTeam.name, '逃生队');
  assert.equal(replayCharacter.usage.latestTeam.logoUrl, '/escape.png');
  assert.equal(replayCharacter.usage.latestMatch.attempt, 2);
  assert.equal(replayCharacter.usage.commonPlayers[0].count, 1);
  assert.equal(replayCharacter.usage.recentResults.length, 1);
  assert.equal(stats.roles.escape.characters.find(item => item.id === '逃生甲').usage.latestPlayer, null);
  assert.equal(stats.roles.hunter.characters.find(item => item.id === '追捕甲').wins, 1);
});

test('latest usage falls back to the selected player team when room mapping is unavailable', () => {
  db.exec(`
    INSERT INTO matches (id, event_id, matchup_home, matchup_away)
      VALUES ('match-without-room', 'event', '逃生队', '待定队伍');
    INSERT INTO bp_sessions (id, match_id, game_number, room, attempt, created_at, updated_at)
      VALUES ('no-room-attempt', 'match-without-room', 1, 'A', 1, 30, 30);
    INSERT INTO bp_session_slots (session_id, slot_id, character_id, player_id)
      VALUES ('no-room-attempt', 'escape-pick', '逃生乙', 'escape-player-2');
    INSERT INTO bp_session_results (session_id, winner_role, winner_team_id, decided_at)
      VALUES ('no-room-attempt', 'escape', 'escape-team', 300);
  `);
  const character = calculateCharacterStats(db).roles.escape.characters.find(item => item.id === '逃生乙');
  assert.equal(character.usage.latestTeam.name, '逃生队');
  assert.equal(character.usage.latestTeam.logoUrl, '/escape.png');
});

test('latest usage resolves bracket participants when a later match has no materialized rooms', () => {
  db.exec(`
    INSERT INTO teams (id, display_name) VALUES ('third-team', '第三队');
    INSERT INTO team_logos (team_id, kind, web_file) VALUES
      ('third-team', 'escape', '/third.png'), ('escape-team', 'hunter', '/escape-hunter.png');
    INSERT INTO matches (id, event_id, matchup_home, matchup_away)
      VALUES ('feeder-match', 'event', '第三队', '待定');
    INSERT INTO match_participants (match_id, slot, ref_type, team_id, from_match_id, outcome) VALUES
      ('feeder-match', 0, 'team', 'third-team', NULL, NULL),
      ('feeder-match', 1, 'loser_of', NULL, 'match', 'loser');
    INSERT INTO bp_sessions (id, match_id, game_number, room, attempt, created_at, updated_at)
      VALUES ('feeder-attempt', 'feeder-match', 1, 'A', 1, 40, 40);
    INSERT INTO bp_session_slots (session_id, slot_id, character_id, player_text)
      VALUES ('feeder-attempt', 'hunter-pick', '追捕甲', '临时追捕选手');
    INSERT INTO bp_session_results (session_id, winner_role, winner_team_id, decided_at)
      VALUES ('feeder-attempt', 'escape', 'third-team', 400);
  `);
  const character = calculateCharacterStats(db).roles.hunter.characters.find(item => item.id === '追捕甲');
  assert.equal(character.usage.latestTeam.name, '逃生队');
  assert.equal(character.usage.latestTeam.logoUrl, '/escape-hunter.png');
  assert.equal(character.usage.latestPlayer.nickname, '临时追捕选手');
  assert.equal(character.usage.latestMatch.matchupLabel, '第三队 vs 逃生队');
});

test('database calculation separates PC, PE and all-server rankings', () => {
  db.exec(`
    INSERT INTO events (id, name, division, stage) VALUES ('pc-event', 'PC 测试赛事', 'pc', 'group');
    INSERT INTO matches (id, event_id, matchup_home, matchup_away)
      VALUES ('pc-match', 'pc-event', '逃生队', '追捕队');
    INSERT INTO bp_sessions (id, match_id, game_number, room, attempt, created_at, updated_at)
      VALUES ('pc-session', 'pc-match', 1, 'A', 1, 40, 40);
    INSERT INTO bp_session_slots (session_id, slot_id, character_id, player_id)
      VALUES ('pc-session', 'escape-pick', '逃生甲', 'escape-player-1');
    INSERT INTO bp_session_results (session_id, winner_role, winner_team_id, decided_at)
      VALUES ('pc-session', 'escape', 'escape-team', 400);
  `);
  const allStats = calculateCharacterStats(db, 'all');
  const pcStats = calculateCharacterStats(db, 'pc');
  const peStats = calculateCharacterStats(db, 'pe');
  assert.equal(pcStats.sample.effectiveGames, 1);
  assert.equal(pcStats.roles.escape.characters.find(item => item.id === '逃生甲').uses, 1);
  assert.equal(peStats.roles.escape.characters.find(item => item.id === '逃生甲').uses, 0);
  assert.equal(allStats.sample.effectiveGames, pcStats.sample.effectiveGames + peStats.sample.effectiveGames);
  assert.equal(pcStats.division, 'pc');
  assert.equal(peStats.division, 'pe');
});

test('database calculation excludes BP test matches from every character ranking', () => {
  const before = calculateCharacterStats(db, 'all');
  const beforeUses = before.roles.escape.characters.find(item => item.id === '逃生甲').uses;
  db.exec(`
    INSERT INTO matches
      (id, event_id, matchup_home, matchup_away, exclude_from_character_stats)
      VALUES ('excluded-test-match', 'event', '逃生队', '追捕队', 1);
    INSERT INTO bp_sessions (id, match_id, game_number, room, attempt, created_at, updated_at)
      VALUES ('excluded-test-session', 'excluded-test-match', 1, 'A', 1, 50, 50);
    INSERT INTO bp_session_slots (session_id, slot_id, character_id, player_id)
      VALUES ('excluded-test-session', 'escape-pick', '逃生甲', 'escape-player-1');
    INSERT INTO bp_session_results (session_id, winner_role, winner_team_id, decided_at)
      VALUES ('excluded-test-session', 'escape', 'escape-team', 500);
  `);
  const after = calculateCharacterStats(db, 'all');
  assert.equal(after.sample.effectiveGames, before.sample.effectiveGames);
  assert.equal(after.roles.escape.characters.find(item => item.id === '逃生甲').uses, beforeUses);
});

test('recent character results retain up to ten effective games', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    ...slot(`recent-${index}`, 'escape', '逃生甲', 'pick', 'escape', index + 1),
    match_id: `match-${index}`,
    game_number: index + 1,
    room: 'A',
    attempt: 1
  }));
  const recentResults = buildCharacterStats(characters, rows).roles.escape.characters
    .find(item => item.id === '逃生甲').usage.recentResults;
  assert.equal(recentResults.length, 10);
  assert.equal(recentResults[0].sessionId, 'recent-11');
});

test('character base data management creates and updates only editable profile fields', () => {
  const created = createCharacter(db, {
    id: '管理测试角色',
    role: 'escape',
    nickname: '测试昵称',
    displayName: '初始姓名',
    releaseDate: '2026年9月2日',
    portraitUrl: '/managed.png',
    winRate: 0.99,
    usage: { latestTeam: '不能写入' },
    skills: [
      { name: '技能一', description: '描述一', iconUrl: '/skill-1.png' },
      { name: '技能二', description: '描述二' }
    ]
  });
  assert.equal(created.enabled, true);
  assert.equal(created.skills.length, 2);

  const result = updateCharacter(db, '管理测试角色', {
    id: '尝试修改 ID',
    role: 'hunter',
    nickname: '更新昵称',
    displayName: '更新姓名',
    releaseDate: '',
    portraitUrl: '/managed-new.png',
    selectedGames: 999,
    skills: [{ name: '新技能', description: '新描述', iconUrl: '' }],
    changesToAdd: [{ date: '2026-09-02', title: '测试调整', content: '调整了基础能力。' }]
  });
  assert.equal(result.character.id, '管理测试角色');
  assert.equal(result.character.role, 'hunter');
  assert.equal(result.character.nickname, '更新昵称');
  assert.equal(result.character.displayName, '更新姓名');
  assert.equal(result.character.portraitUrl, '/managed.png');
  assert.equal(result.character.skills.length, 1);
  assert.equal(result.changesAdded, 1);
  assert.deepEqual({ ...db.prepare(`SELECT changed_on, title, content FROM character_change_history
    WHERE character_id = '管理测试角色'`).get() }, {
    changed_on: '2026-09-02',
    title: '测试调整',
    content: '调整了基础能力。'
  });
  assert.equal(Object.hasOwn(result.character, 'winRate'), false);
  assert.equal(Object.hasOwn(result.character, 'selectedGames'), false);
});

test('character management generates stable IDs and stores validated portrait data separately', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const created = createCharacter(db, {
    role: 'escape',
    displayName: '自动编号角色',
    portraitChanged: true,
    portrait: png
  });
  assert.match(created.id, /^character-[0-9a-f-]{36}$/);
  assert.equal(created.hasCustomPortrait, true);
  assert.match(created.imageUrl, new RegExp(`^/api/characters/${created.id}/portrait\\?v=`));
  assert.equal(readCharacterPortrait(db, created.id).mime_type, 'image/png');

  const retained = updateCharacter(db, created.id, {
    role: 'hunter', displayName: '自动编号角色', releaseDate: '', skills: []
  }).character;
  assert.equal(retained.hasCustomPortrait, true);

  const removed = updateCharacter(db, created.id, {
    role: 'hunter', displayName: '自动编号角色', releaseDate: '', skills: [],
    portraitChanged: true, portrait: null
  }).character;
  assert.equal(removed.hasCustomPortrait, false);
  assert.equal(readCharacterPortrait(db, created.id), null);
});

test('character management stores uploaded skill icons separately from editable metadata', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const created = createCharacter(db, {
    role: 'escape',
    nickname: '图标角色',
    displayName: '图标姓名',
    skills: [{
      name: '图标技能',
      description: '技能描述',
      iconChanged: true,
      icon: png
    }]
  });
  assert.equal(created.skills[0].hasCustomIcon, true);
  assert.match(created.skills[0].iconUrl, /\/skills\/1\/icon\?v=/);
  assert.equal(readCharacterSkillIcon(db, created.id, 1).mime_type, 'image/png');

  const retained = updateCharacter(db, created.id, {
    role: 'escape',
    nickname: '图标角色',
    displayName: '图标姓名',
    skills: [{ name: '更新技能', description: '更新描述' }]
  }).character;
  assert.equal(retained.skills[0].hasCustomIcon, true);

  const removed = updateCharacter(db, created.id, {
    role: 'escape',
    nickname: '图标角色',
    displayName: '图标姓名',
    skills: [{ name: '更新技能', description: '更新描述', iconChanged: true, icon: null }]
  }).character;
  assert.equal(removed.skills[0].hasCustomIcon, false);
  assert.equal(readCharacterSkillIcon(db, created.id, 1), null);
});

test('character management rejects mismatched and oversized portrait data', () => {
  assert.throws(() => createCharacter(db, {
    role: 'escape', displayName: '伪装头像', portraitChanged: true,
    portrait: 'data:image/png;base64,aGVsbG8='
  }), /图片类型不匹配/);
  assert.throws(() => createCharacter(db, {
    role: 'escape', displayName: '超大头像', portraitChanged: true,
    portrait: `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`
  }), /不能超过 2MB/);
});

test('character base data management validates role, duplicate IDs and skill count', () => {
  assert.throws(() => createCharacter(db, {
    id: '管理测试角色', role: 'escape', displayName: '重复角色'
  }), /角色 ID 已存在/);
  assert.throws(() => createCharacter(db, {
    id: '非法阵营角色', role: 'other', displayName: '非法阵营'
  }), /角色阵营无效/);
  assert.throws(() => createCharacter(db, {
    id: '技能过多角色', role: 'escape', displayName: '技能过多',
    skills: [{}, {}, {}, {}]
  }), /最多只能设置三个/);
  assert.throws(() => updateCharacter(db, '管理测试角色', {
    role: 'hunter', nickname: '更新昵称', displayName: '更新姓名', skills: [],
    changesToAdd: [{ date: '2026/09/02', title: '错误日期', content: '详情' }]
  }), /日期格式无效/);
  assert.throws(() => updateCharacter(db, '管理测试角色', {
    role: 'hunter', nickname: '更新昵称', displayName: '更新姓名', skills: [],
    changesToAdd: [{ date: '2026-09-02', title: '测试调整', content: '重复详情' }]
  }), /已存在/);
});

test('archiving a character preserves its skills and historical BP references', () => {
  db.exec(`
    INSERT INTO bp_slots (id, label, kind, role, sort_order)
      VALUES ('managed-character-slot', '管理角色选择', 'pick', 'hunter', 99);
    INSERT INTO bp_session_slots (session_id, slot_id, character_id)
      VALUES ('attempt-2', 'managed-character-slot', '管理测试角色');
  `);
  const beforeSlots = db.prepare(`SELECT COUNT(*) AS count FROM bp_session_slots
    WHERE character_id = '管理测试角色'`).get().count;
  assert.equal(beforeSlots, 1);
  const archived = archiveCharacter(db, '管理测试角色');
  assert.equal(archived.enabled, false);
  assert.equal(db.prepare("SELECT enabled FROM characters WHERE id = '管理测试角色'").get().enabled, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM character_skills WHERE character_id = '管理测试角色'").get().count, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM bp_session_slots
    WHERE character_id = '管理测试角色'`).get().count, beforeSlots);
  assert.equal(calculateCharacterStats(db).roles.hunter.characters.some(item => item.id === '管理测试角色'), false);
});
