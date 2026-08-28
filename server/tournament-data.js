const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveAssetPath } = require('./asset-paths');

const DATA_PATH = path.resolve(
  __dirname,
  '..',
  'public',
  'assets',
  'data',
  'tournament-2026-07-25-mobile.json'
);
const DATA_PATHS = [
  DATA_PATH,
  path.resolve(__dirname, '..', 'public', 'assets', 'data', 'tournament-2026-07-26-pc.json'),
  path.resolve(__dirname, '..', 'public', 'assets', 'data', 'tournament-2026-07-27-mobile-loser.json'),
  path.resolve(__dirname, '..', 'public', 'assets', 'data', 'tournament-2026-07-27-pc-loser.json'),
  path.resolve(__dirname, '..', 'public', 'assets', 'data', 'tournament-2026-08-01-mobile-winner.json'),
  path.resolve(__dirname, '..', 'public', 'assets', 'data', 'tournament-2026-08-01-pc-winner.json'),
  path.resolve(__dirname, '..', 'public', 'assets', 'data', 'tournament-2026-08-02-mobile-loser.json'),
  path.resolve(__dirname, '..', 'public', 'assets', 'data', 'tournament-2026-08-02-pc-loser.json')
];

function readData() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function readAllData() {
  const datasets = DATA_PATHS.map(filePath => JSON.parse(fs.readFileSync(filePath, 'utf8')));
  const sharedTeams = {};
  for (const data of datasets) {
    for (const [teamId, team] of Object.entries(data.teams || {})) {
      if (sharedTeams[teamId]) {
        assert(JSON.stringify(sharedTeams[teamId]) === JSON.stringify(team), `Conflicting shared team data: ${teamId}`);
      } else {
        sharedTeams[teamId] = team;
      }
    }
  }
  return datasets.map(data => {
    if (!data.teamIds) return data;
    return {
      ...data,
      teams: Object.fromEntries(data.teamIds.map(teamId => {
        assert(sharedTeams[teamId], `Unknown shared team: ${teamId}`);
        return [teamId, sharedTeams[teamId]];
      }))
    };
  });
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function playerMap(team) {
  const players = [
    ...team.roster.escape,
    ...team.roster.hunter,
    ...team.roster.substitutes
  ].filter(player => player.playerId);
  return new Map(players.map(player => [player.playerId, player]));
}

function expectedCandidateIds(team, role) {
  return [
    ...team.roster[role],
    ...team.roster.substitutes
  ].filter(player => player.playerId).map(player => player.playerId);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateTournamentData(data, options = {}) {
  const teams = Object.values(data.teams);
  assert(data.schemaVersion === 1, 'Unsupported tournament data schema');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(data.event.date), 'Invalid tournament date');
  assert(data.event.division === 'mobile' || data.event.division === 'pc', 'Invalid tournament division');
  assert(data.event.scheduleImage === null || (typeof data.event.scheduleImage === 'string' && data.event.scheduleImage.length > 0), 'Invalid schedule image mapping');
  assert(typeof data.event.stageImage === 'string' && data.event.stageImage.length > 0, 'Missing stage image mapping');
  if (options.verifyFiles) {
    if (data.event.scheduleImage) assert(fs.existsSync(resolveAssetPath(data.event.scheduleImage)), 'Schedule image file not found');
    assert(fs.existsSync(resolveAssetPath(data.event.stageImage)), 'Stage image file not found');
  }
  assert(teams.length === data.integrity.teamCount, `Expected ${data.integrity.teamCount} teams, found ${teams.length}`);
  assert(data.matches.length === data.integrity.matchCount, `Expected ${data.integrity.matchCount} matches, found ${data.matches.length}`);

  const globalPlayerIds = new Set();
  const globalOfficialIds = new Set();

  for (const team of teams) {
    assert(team.roster.escape.length === 8, `${team.id}: escape slot count mismatch`);
    assert(team.roster.hunter.length === 2, `${team.id}: hunter slot count mismatch`);
    assert(team.roster.substitutes.length === 5, `${team.id}: substitute slot count mismatch`);

    const players = playerMap(team);
    for (const player of players.values()) {
      assert(typeof player.nickname === 'string' && player.nickname.length > 0, `${player.playerId}: missing nickname`);
      assert(/^\d+$/.test(player.officialId), `${player.playerId}: invalid official ID`);
      assert(!globalPlayerIds.has(player.playerId), `${player.playerId}: duplicate player ID`);
      assert(!globalOfficialIds.has(player.officialId), `${player.officialId}: duplicate official ID`);
      globalPlayerIds.add(player.playerId);
      globalOfficialIds.add(player.officialId);
    }

    for (const role of ['escape', 'hunter']) {
      const expected = expectedCandidateIds(team, role);
      const actual = team.candidatePools[role];
      assert(JSON.stringify(actual) === JSON.stringify(expected), `${team.id}: ${role} candidate pool mismatch`);
      assert(new Set(actual).size === actual.length, `${team.id}: duplicate ${role} candidate`);
      for (const playerId of actual) assert(players.has(playerId), `${team.id}: unknown candidate ${playerId}`);
    }

    for (const role of ['escape', 'hunter']) {
      const logo = team.logos[role];
      assert(typeof logo.obsFile === 'string' && logo.obsFile.length > 0, `${team.id}: missing OBS ${role} logo`);
      assert(typeof logo.webFile === 'string' && logo.webFile.length > 0, `${team.id}: missing web ${role} logo`);
      assert(/^[a-f0-9]{64}$/.test(logo.sha256), `${team.id}: invalid ${role} logo hash`);

      if (options.verifyFiles) {
        const webPath = path.resolve(__dirname, '..', 'public', logo.webFile.replace(/^\//, ''));
        const obsFile = resolveAssetPath(logo.obsFile);
        assert(fs.existsSync(obsFile), `${team.id}: OBS ${role} logo file not found`);
        assert(fs.existsSync(webPath), `${team.id}: web ${role} logo file not found`);
        assert(hashFile(obsFile) === logo.sha256, `${team.id}: OBS ${role} logo hash mismatch`);
        assert(hashFile(webPath) === logo.sha256, `${team.id}: web ${role} logo hash mismatch`);
      }
    }
  }

  const matchIds = new Set();
  for (const match of data.matches) {
    assert(!matchIds.has(match.id), `Duplicate match ID: ${match.id}`);
    matchIds.add(match.id);
    if (match.participantRefs) {
      assert(match.participantRefs.length === 2, `${match.id}: pending match must have two participant references`);
      for (const ref of match.participantRefs) {
        const fixed = ref.teamId && data.teams[ref.teamId];
        const feeder = ref.fromMatchId && (ref.outcome === 'winner' || ref.outcome === 'loser');
        assert(fixed || feeder, `${match.id}: invalid participant reference`);
      }
      continue;
    }
    for (const roomName of ['A', 'B']) {
      const room = match.rooms[roomName];
      assert(data.teams[room.escapeTeamId], `${match.id}: unknown ${roomName} escape team`);
      assert(data.teams[room.hunterTeamId], `${match.id}: unknown ${roomName} hunter team`);
      assert(room.escapeTeamId !== room.hunterTeamId, `${match.id}: same team on both roles in room ${roomName}`);
    }
    assert(match.rooms.A.escapeTeamId === match.rooms.B.hunterTeamId, `${match.id}: escape/hunter swap mismatch`);
    assert(match.rooms.A.hunterTeamId === match.rooms.B.escapeTeamId, `${match.id}: hunter/escape swap mismatch`);
  }

  if (options.verifySource) {
    assert(fs.existsSync(data.source.workbook), 'Source workbook not found');
    if (options.verifySourceHash) {
      assert(hashFile(data.source.workbook) === data.source.workbookSha256, 'Source workbook hash mismatch');
    }
  }

  assert(globalPlayerIds.size === data.integrity.registeredPlayerCount, 'Registered player count mismatch');
  return {
    teamCount: teams.length,
    matchCount: data.matches.length,
    registeredPlayerCount: globalPlayerIds.size,
    logoCount: teams.length * 2
  };
}

function createTournamentResolver(input = readData()) {
  const tournaments = Array.isArray(input) ? input : [input];
  tournaments.forEach(data => validateTournamentData(data));
  const teams = {};
  const allMatches = [];
  const matchTournaments = new Map();
  for (const tournament of tournaments) {
    for (const [teamId, team] of Object.entries(tournament.teams)) {
      if (teams[teamId]) {
        assert(
          JSON.stringify(teams[teamId]) === JSON.stringify(team),
          `Conflicting team data across tournaments: ${teamId}`
        );
      } else {
        teams[teamId] = team;
      }
    }
    for (const match of tournament.matches) {
      assert(!matchTournaments.has(match.id), `Duplicate match ID across tournaments: ${match.id}`);
      allMatches.push(match);
      matchTournaments.set(match.id, tournament);
    }
  }
  const matches = new Map(allMatches.map(match => [match.id, match]));
  let outcomeResolver = null;

  function getTeam(teamId) {
    const team = teams[teamId];
    if (!team) throw new Error(`Unknown team: ${teamId}`);
    return team;
  }

  function resolveParticipant(ref) {
    if (ref.teamId) return ref.teamId;
    const source = matches.get(ref.fromMatchId);
    if (!source) throw new Error(`Unknown feeder match: ${ref.fromMatchId}`);
    const winnerTeamId = outcomeResolver?.(ref.fromMatchId) || source.winnerTeamId || null;
    if (!winnerTeamId) return null;
    if (ref.outcome === 'winner') return winnerTeamId;
    const participants = [source.rooms?.A?.escapeTeamId, source.rooms?.A?.hunterTeamId].filter(Boolean);
    return participants.find(teamId => teamId !== winnerTeamId) || null;
  }

  function materializeMatch(match, allowPending = false) {
    if (!match.participantRefs) return { ...match, ready: true };
    const participantIds = match.participantRefs.map(resolveParticipant);
    const ready = participantIds.every(Boolean);
    if (!ready && !allowPending) throw new Error('该场对阵仍有待定队伍，请等待前置比赛产生赛果后刷新页面');
    const [firstTeamId, secondTeamId] = participantIds;
    return {
      ...match,
      ready,
      matchup: participantIds.map(teamId => teamId ? getTeam(teamId).displayName : '待定'),
      rooms: {
        A: { escapeTeamId: firstTeamId, hunterTeamId: secondTeamId },
        B: { escapeTeamId: secondTeamId, hunterTeamId: firstTeamId }
      }
    };
  }

  function getMatch(matchId, options = {}) {
    const match = matches.get(matchId);
    if (!match) throw new Error(`Unknown match: ${matchId}`);
    return materializeMatch(match, Boolean(options.allowPending));
  }

  function getTournamentByMatch(matchId) {
    const tournament = matchTournaments.get(matchId);
    if (!tournament) throw new Error(`Unknown tournament for match: ${matchId}`);
    return tournament;
  }

  function getCandidates(matchId, roomName, role) {
    const room = String(roomName).toUpperCase();
    assert(room === 'A' || room === 'B', `Unknown room: ${roomName}`);
    assert(role === 'escape' || role === 'hunter', `Unknown role: ${role}`);

    const match = getMatch(matchId);
    const team = getTeam(match.rooms[room][`${role}TeamId`]);
    const players = playerMap(team);
    return {
      matchId,
      room,
      role,
      team,
      candidates: team.candidatePools[role].map(playerId => {
        const player = players.get(playerId);
        return {
          ...player,
          registeredRole: player.slot.startsWith('substitute') ? 'substitute' : role,
          eligibleAs: role
        };
      })
    };
  }

  function resolveRoom(matchId, roomName) {
    return {
      escape: getCandidates(matchId, roomName, 'escape'),
      hunter: getCandidates(matchId, roomName, 'hunter')
    };
  }

  function setOutcomeResolver(resolver) {
    outcomeResolver = typeof resolver === 'function' ? resolver : null;
  }

  const resolver = { getTeam, getMatch, getTournamentByMatch, getCandidates, resolveRoom, setOutcomeResolver };
  Object.defineProperties(resolver, {
    data: {
      enumerable: true,
      get: () => ({
        event: tournaments[0].event,
        events: tournaments.map(tournament => tournament.event),
        teams,
        matches: allMatches.map(match => materializeMatch(match, true))
      })
    },
    schedules: {
      enumerable: true,
      get: () => tournaments.map(tournament => ({
        id: tournament.event.id,
        event: tournament.event,
        matches: tournament.matches.map(match => materializeMatch(match, true))
      }))
    }
  });
  return resolver;
}

module.exports = {
  DATA_PATH,
  DATA_PATHS,
  createTournamentResolver,
  readData,
  readAllData,
  validateTournamentData
};
