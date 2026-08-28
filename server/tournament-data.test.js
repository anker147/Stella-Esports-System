const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createTournamentResolver,
  readData,
  readAllData,
  validateTournamentData
} = require('./tournament-data');

test('generated tournament data passes all source and asset checks', () => {
  const result = validateTournamentData(readData(), { verifyFiles: true, verifySource: true });
  assert.deepEqual(result, {
    teamCount: 8,
    matchCount: 4,
    registeredPlayerCount: 119,
    logoCount: 16
  });
});

test('14:00 A room maps escape to Juyi and hunter to Feitongfanxiang', () => {
  const resolver = createTournamentResolver();
  const room = resolver.resolveRoom('mobile-2026-07-25-qf-1', 'A');

  assert.equal(room.escape.team.displayName, '聚义');
  assert.equal(room.hunter.team.displayName, '非同凡想');
  assert.equal(room.escape.candidates.length, 13);
  assert.equal(room.hunter.candidates.length, 7);
  assert(room.escape.candidates.some(player => player.nickname === 'JY丶脾气'));
  assert.equal(room.escape.candidates.filter(player => player.registeredRole === 'substitute').length, 5);
  assert.equal(room.hunter.candidates.filter(player => player.registeredRole === 'substitute').length, 5);
});

test('14:00 B room is the exact inverse of A room', () => {
  const resolver = createTournamentResolver();
  const roomA = resolver.resolveRoom('mobile-2026-07-25-qf-1', 'A');
  const roomB = resolver.resolveRoom('mobile-2026-07-25-qf-1', 'B');

  assert.equal(roomA.escape.team.id, roomB.hunter.team.id);
  assert.equal(roomA.hunter.team.id, roomB.escape.team.id);
});

test('every substitute is available in both role candidate pools', () => {
  const resolver = createTournamentResolver();

  for (const team of Object.values(resolver.data.teams)) {
    const substitutes = team.roster.substitutes.filter(player => player.playerId).map(player => player.playerId);
    for (const playerId of substitutes) {
      assert(team.candidatePools.escape.includes(playerId), `${playerId} missing from escape pool`);
      assert(team.candidatePools.hunter.includes(playerId), `${playerId} missing from hunter pool`);
    }
  }
});

test('explicit aliases resolve known workbook and logo naming differences', () => {
  const resolver = createTournamentResolver();
  assert.equal(resolver.getTeam('feitongfanxiang').aliases.logo, '非同凡响');
  assert.equal(resolver.getTeam('jingchengxiaoxue').aliases.logo, '京城小雪');
  assert.equal(resolver.getTeam('jimegame').aliases.roster, '吉美2026');
});

test('July 26 PC quarterfinal data passes source and asset checks', () => {
  const datasets = readAllData();
  assert.equal(datasets.length, 8);
  const pc = datasets.find(data => data.event.division === 'pc');
  assert.deepEqual(validateTournamentData(pc, { verifyFiles: true, verifySource: true }), {
    teamCount: 8,
    matchCount: 4,
    registeredPlayerCount: 119,
    logoCount: 16
  });
});

test('all eight schedules pass source, roster, mapping and asset validation', () => {
  const expected = {
    '2026-zhuifeng-cup-mobile-2026-07-25': [8, 4, 119, 16],
    '2026-zhuifeng-cup-pc-2026-07-26': [8, 4, 119, 16],
    '2026-zhuifeng-cup-mobile-2026-07-27-qf-loser': [4, 2, 60, 8],
    '2026-zhuifeng-cup-pc-2026-07-27-qf-loser': [4, 2, 60, 8],
    '2026-zhuifeng-cup-mobile-2026-08-01-sf-winner': [4, 2, 59, 8],
    '2026-zhuifeng-cup-pc-2026-08-01-sf-winner': [4, 2, 59, 8],
    '2026-zhuifeng-cup-mobile-2026-08-02-sf-loser': [6, 2, 89, 12],
    '2026-zhuifeng-cup-pc-2026-08-02-sf-loser': [6, 2, 89, 12]
  };

  const datasets = readAllData();
  assert.deepEqual(datasets.map(data => data.event.id), Object.keys(expected));
  for (const data of datasets) {
    const [teamCount, matchCount, registeredPlayerCount, logoCount] = expected[data.event.id];
    assert.deepEqual(validateTournamentData(data, { verifyFiles: true, verifySource: true }), {
      teamCount,
      matchCount,
      registeredPlayerCount,
      logoCount
    });
  }
});

test('new schedules preserve exact matchup order, times and A/B role reversal', () => {
  const resolver = createTournamentResolver(readAllData());
  const expected = [
    ['pc-2026-07-27-qf-loser-1', '2026-07-27', '16:00', 'pc-365days', 'pc-qinghejie'],
    ['pc-2026-07-27-qf-loser-2', '2026-07-27', '17:00', 'pc-youfeng', 'pc-youshiyinianxia'],
    ['mobile-2026-08-01-sf-winner-1', '2026-08-01', '15:10', 'feitongfanxiang', 'jingchengxiaoxue'],
    ['mobile-2026-08-01-sf-winner-2', '2026-08-01', '16:10', 'hualai2026', 'jimegame'],
    ['pc-2026-08-01-sf-winner-1', '2026-08-01', '19:00', 'pc-xiaojiejiedeyangfang', 'pc-jimegame'],
    ['pc-2026-08-01-sf-winner-2', '2026-08-01', '20:00', 'pc-chunxin', 'pc-shuihuaxiaopu']
  ];

  for (const [matchId, date, startTime, escapeTeamId, hunterTeamId] of expected) {
    const match = resolver.getMatch(matchId);
    assert.equal(match.date, date);
    assert.equal(match.startTime, startTime);
    assert.deepEqual(match.rooms.A, { escapeTeamId, hunterTeamId });
    assert.deepEqual(match.rooms.B, {
      escapeTeamId: hunterTeamId,
      hunterTeamId: escapeTeamId
    });
    assert.equal(resolver.getTournamentByMatch(matchId).event.date, date);
  }
});

test('revalidated competition nicknames and IDs match the latest workbook', () => {
  const resolver = createTournamentResolver(readAllData());
  const expected = [
    ['sishijiaxing', 'escape3', '从地狱归来', '23626112'],
    ['sishijiaxing', 'escape5', '四时佳兴nb', '48637549'],
    ['pc-xiaojiejiedeyangfang', 'escape1', 'ಎ心无所感', '1250880'],
    ['pc-xiaojiejiedeyangfang', 'hunter2', 'ಎ白凤', '1250857'],
    ['pc-chunxin', 'escape1', '可爱大王幸识', '1250913'],
    ['pc-chunxin', 'escape6', 'ঞ偏偏不见雨', '1250922'],
    ['pc-shuihuaxiaopu', 'escape4', '为家福而战و', '1241206'],
    ['pc-shuihuaxiaopu', 'escape6', '小小小竹子و', '1241073'],
    ['pc-shuihuaxiaopu', 'escape7', '玉玉排骨汤و', '1241207'],
    ['pc-shuihuaxiaopu', 'hunter1', '为绿水而战و', '1240923'],
    ['pc-shuihuaxiaopu', 'hunter2', '为通俗而战وv', '1239948']
  ];

  for (const [teamId, slot, nickname, officialId] of expected) {
    const team = resolver.getTeam(teamId);
    const player = [...team.roster.escape, ...team.roster.hunter, ...team.roster.substitutes]
      .find(candidate => candidate.slot === slot);
    assert.equal(player.nickname, nickname);
    assert.equal(player.officialId, officialId);
  }
});

test('multi-schedule resolver maps July 26 PC rooms and match-server nicknames', () => {
  const resolver = createTournamentResolver(readAllData());
  const roomA = resolver.resolveRoom('pc-2026-07-26-qf-1', 'A');
  const roomB = resolver.resolveRoom('pc-2026-07-26-qf-1', 'B');
  assert.equal(roomA.escape.team.displayName, '365Days');
  assert.equal(roomA.hunter.team.displayName, '小姐姐的洋房');
  assert.equal(roomB.escape.team.id, roomA.hunter.team.id);
  assert.equal(roomB.hunter.team.id, roomA.escape.team.id);
  assert(roomA.escape.candidates.some(player => player.nickname === '杨风瑾'));
  assert.equal(roomA.escape.candidates.length, 13);
  assert.equal(roomA.hunter.candidates.length, 6);
  assert.equal(resolver.getTournamentByMatch('pc-2026-07-26-qf-1').event.date, '2026-07-26');
});

test('July 27 mobile lower-bracket data passes source and asset checks', () => {
  const datasets = readAllData();
  const lowerBracket = datasets.find(data => data.event.id === '2026-zhuifeng-cup-mobile-2026-07-27-qf-loser');
  assert.deepEqual(validateTournamentData(lowerBracket, { verifyFiles: true, verifySource: true }), {
    teamCount: 4,
    matchCount: 2,
    registeredPlayerCount: 60,
    logoCount: 8
  });
});

test('July 27 mobile lower-bracket rooms preserve both source mappings', () => {
  const resolver = createTournamentResolver(readAllData());
  const firstA = resolver.resolveRoom('mobile-2026-07-27-qf-loser-1', 'A');
  const firstB = resolver.resolveRoom('mobile-2026-07-27-qf-loser-1', 'B');
  const secondA = resolver.resolveRoom('mobile-2026-07-27-qf-loser-2', 'A');

  assert.equal(firstA.escape.team.displayName, '聚义');
  assert.equal(firstA.hunter.team.displayName, '四时佳兴');
  assert.equal(firstB.escape.team.id, firstA.hunter.team.id);
  assert.equal(firstB.hunter.team.id, firstA.escape.team.id);
  assert.equal(secondA.escape.team.displayName, '人间叹');
  assert.equal(secondA.hunter.team.displayName, '冬月子时');
  assert(firstA.escape.candidates.some(player => player.registeredRole === 'substitute'));
  assert(secondA.hunter.candidates.some(player => player.registeredRole === 'substitute'));
  assert.equal(resolver.getTournamentByMatch('mobile-2026-07-27-qf-loser-2').event.date, '2026-07-27');
  assert.equal(resolver.getTournamentByMatch('mobile-2026-07-27-qf-loser-2').event.division, 'mobile');
});

test('August 2 pending teams resolve from the corresponding August 1 loser', () => {
  const resolver = createTournamentResolver(readAllData());
  const pending = resolver.schedules.find(schedule => schedule.event.id === '2026-zhuifeng-cup-mobile-2026-08-02-sf-loser');
  assert.deepEqual(pending.matches.map(match => [match.startTime, match.matchup, match.ready]), [
    ['15:10', ['聚义', '待定'], false],
    ['16:10', ['冬月子时', '待定'], false]
  ]);
  assert.throws(() => resolver.getMatch('mobile-2026-08-02-sf-loser-1'), /待定队伍/);

  resolver.setOutcomeResolver(matchId => ({
    'mobile-2026-08-01-sf-winner-1': 'feitongfanxiang',
    'mobile-2026-08-01-sf-winner-2': 'jimegame',
    'pc-2026-08-01-sf-winner-1': 'pc-jimegame',
    'pc-2026-08-01-sf-winner-2': 'pc-chunxin'
  })[matchId] || null);

  assert.deepEqual(resolver.getMatch('mobile-2026-08-02-sf-loser-1').rooms, {
    A: { escapeTeamId: 'juyi', hunterTeamId: 'jingchengxiaoxue' },
    B: { escapeTeamId: 'jingchengxiaoxue', hunterTeamId: 'juyi' }
  });
  assert.deepEqual(resolver.getMatch('pc-2026-08-02-sf-loser-2').rooms, {
    A: { escapeTeamId: 'pc-youshiyinianxia', hunterTeamId: 'pc-shuihuaxiaopu' },
    B: { escapeTeamId: 'pc-shuihuaxiaopu', hunterTeamId: 'pc-youshiyinianxia' }
  });
});
