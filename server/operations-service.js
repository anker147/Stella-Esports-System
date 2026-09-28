const path = require('node:path');
const { db: defaultDb } = require('./db');
const { laboratorySettings } = require('./laboratory-settings');
const { resolveScheduleEvent } = require('./event-management-service');

const PUBLIC_VIEWS = new Set([
  'personal', 'events', 'schedule', 'teams', 'players', 'resources', 'matches', 'hud'
]);
const MANAGEMENT_VIEWS = new Set(['dataConfig', 'terminal', 'settings', 'alerts']);
const ALL_VIEWS = new Set([...PUBLIC_VIEWS, ...MANAGEMENT_VIEWS]);

const EFFECTIVE_SESSIONS_CTE = `WITH ranked_sessions AS (
  SELECT s.*,
    ROW_NUMBER() OVER (
      PARTITION BY s.match_id, s.game_number, s.room
      ORDER BY s.attempt DESC, s.updated_at DESC, s.id DESC
    ) AS effective_rank
  FROM bp_sessions s
), effective_sessions AS (
  SELECT * FROM ranked_sessions WHERE effective_rank = 1
)`;

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function pageOptions(options = {}) {
  return {
    limit: clampInteger(options.limit, 60, 20, 100),
    offset: clampInteger(options.offset, 0, 0, 100000),
    query: String(options.query || '').trim().slice(0, 80),
    eventId: String(options.eventId || '').trim().slice(0, 100),
    managedEventId: String(options.managedEventId || '').trim().slice(0, 100),
    division: ['pc', 'mobile'].includes(options.division) ? options.division : '',
    role: ['escape', 'hunter'].includes(options.role) ? options.role : '',
    teamId: String(options.teamId || '').trim().slice(0, 100)
  };
}

function tableCount(database, table) {
  return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0);
}

function databaseVersion(database) {
  return Number(database.prepare('PRAGMA user_version').get()?.user_version || 0);
}

function eventStatus(date, completedMatches, totalMatches, today) {
  if (totalMatches > 0 && completedMatches >= totalMatches) return 'completed';
  if (!date) return 'planned';
  if (date > today) return 'upcoming';
  if (date === today) return 'live';
  return 'incomplete';
}

function listEvents(database, options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const rows = database.prepare(`SELECT e.id, e.name, e.division, e.stage, e.stage_label,
      e.date, e.mode, e.format, e.schedule_image, e.stage_image, e.source_workbook,
      COUNT(DISTINCT m.id) AS match_count,
      COUNT(DISTINCT CASE WHEN m.winner_team_id IS NOT NULL THEN m.id END) AS completed_match_count,
      COUNT(DISTINCT et.team_id) AS team_count,
      COUNT(DISTINCT p.player_id) AS player_count
    FROM events e
    LEFT JOIN matches m ON m.event_id = e.id
    LEFT JOIN event_teams et ON et.event_id = e.id
    LEFT JOIN players p ON p.team_id = et.team_id
    GROUP BY e.id
    ORDER BY COALESCE(e.date, '9999-12-31'), e.sort_order, e.name`).all();
  return {
    metrics: {
      events: rows.length,
      upcoming: rows.filter(row => row.date && row.date >= today).length,
      matches: rows.reduce((sum, row) => sum + Number(row.match_count || 0), 0),
      teams: tableCount(database, 'teams')
    },
    items: rows.map(row => ({
      id: row.id,
      name: row.name,
      division: row.division,
      stage: row.stage_label || row.stage,
      date: row.date,
      mode: row.mode,
      format: row.format,
      scheduleImage: row.schedule_image,
      stageImage: row.stage_image,
      sourceName: row.source_workbook ? path.basename(row.source_workbook) : null,
      matchCount: Number(row.match_count || 0),
      completedMatchCount: Number(row.completed_match_count || 0),
      teamCount: Number(row.team_count || 0),
      playerCount: Number(row.player_count || 0),
      status: eventStatus(row.date, Number(row.completed_match_count || 0), Number(row.match_count || 0), today)
    }))
  };
}

function scheduleFilters(options) {
  const clauses = [];
  const params = [];
  if (options.query) {
    const pattern = `%${options.query}%`;
    clauses.push(`(te.name LIKE ? OR m.matchup_home LIKE ? OR m.matchup_away LIKE ? OR m.id LIKE ?)`);
    params.push(pattern, pattern, pattern, pattern);
  }
  if (options.division) {
    clauses.push('te.division = ?');
    params.push(options.division);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function listSchedule(database, rawOptions = {}) {
  const options = pageOptions(rawOptions);
  const context = resolveScheduleEvent(database, options.managedEventId);
  const filters = scheduleFilters(options);
  const total = Number(database.prepare(`SELECT COUNT(*) AS count
    FROM tournament_schedule_links link
    JOIN tournament_events te ON te.id = link.tournament_event_id
    JOIN matches m ON m.id = link.match_id
    WHERE link.tournament_event_id = ?${filters.sql ? ` AND ${filters.sql.slice(6)}` : ''}`)
    .get(context.id, ...filters.params)?.count || 0);
  const items = database.prepare(`${EFFECTIVE_SESSIONS_CTE}
    SELECT m.id, m.event_id AS source_event_id, te.id AS tournament_event_id,
      te.name AS event_name, te.division, te.stage,
      m.date, m.start_time, m.end_time, m.mode, m.format,
      COALESCE(home.display_name, m.matchup_home) AS home_name,
      COALESCE(away.display_name, m.matchup_away) AS away_name,
      m.matchup_home AS home_id, m.matchup_away AS away_id,
      m.winner_team_id, winner.display_name AS winner_name,
      COUNT(DISTINCT room.room) AS room_count,
      COUNT(DISTINCT es.id) AS game_count,
      COUNT(DISTINCT result.session_id) AS completed_game_count,
      MAX(es.updated_at) AS latest_activity_at
    FROM tournament_schedule_links link
    JOIN tournament_events te ON te.id = link.tournament_event_id
    JOIN matches m ON m.id = link.match_id
    LEFT JOIN teams home ON home.id = m.matchup_home
    LEFT JOIN teams away ON away.id = m.matchup_away
    LEFT JOIN teams winner ON winner.id = m.winner_team_id
    LEFT JOIN match_rooms room ON room.match_id = m.id
    LEFT JOIN effective_sessions es ON es.match_id = m.id
    LEFT JOIN bp_session_results result ON result.session_id = es.id
    WHERE link.tournament_event_id = ?${filters.sql ? ` AND ${filters.sql.slice(6)}` : ''}
    GROUP BY m.id
    ORDER BY COALESCE(m.date, te.start_date, '9999-12-31'), COALESCE(m.start_time, '99:99'), m.sort_order
    LIMIT ? OFFSET ?`).all(context.id, ...filters.params, options.limit, options.offset).map(row => ({
      id: row.id,
      eventId: row.tournament_event_id,
      sourceEventId: row.source_event_id,
      eventName: row.event_name,
      division: row.division,
      stage: row.stage_label || row.stage,
      date: row.date,
      startTime: row.start_time,
      endTime: row.end_time,
      mode: row.mode,
      format: row.format,
      home: { id: row.home_id, name: row.home_name },
      away: { id: row.away_id, name: row.away_name },
      winner: row.winner_team_id ? { id: row.winner_team_id, name: row.winner_name || row.winner_team_id } : null,
      roomCount: Number(row.room_count || 0),
      gameCount: Number(row.game_count || 0),
      completedGameCount: Number(row.completed_game_count || 0),
      latestActivityAt: row.latest_activity_at
    }));
  return {
    context: {
      managedEventId: context.id,
      eventName: context.name,
      status: context.status,
      priority: context.priority
    },
    total,
    limit: options.limit,
    offset: options.offset,
    hasMore: options.offset + items.length < total,
    items
  };
}

function listTeams(database, rawOptions = {}) {
  const options = pageOptions(rawOptions);
  const clauses = [];
  const params = [];
  if (options.query) {
    clauses.push('(t.display_name LIKE ? OR t.id LIKE ?)');
    const pattern = `%${options.query}%`;
    params.push(pattern, pattern);
  }
  if (options.eventId) {
    clauses.push('EXISTS (SELECT 1 FROM event_teams selected_event WHERE selected_event.team_id = t.id AND selected_event.event_id = ?)');
    params.push(options.eventId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = Number(database.prepare(`SELECT COUNT(*) AS count FROM teams t ${where}`).get(...params)?.count || 0);
  const items = database.prepare(`SELECT t.id, t.display_name,
      COUNT(DISTINCT p.player_id) AS player_count,
      COUNT(DISTINCT CASE WHEN p.role = 'escape' THEN p.player_id END) AS escape_count,
      COUNT(DISTINCT CASE WHEN p.role = 'hunter' THEN p.player_id END) AS hunter_count,
      COUNT(DISTINCT et.event_id) AS event_count,
      COUNT(DISTINCT CASE WHEN m.winner_team_id = t.id THEN m.id END) AS match_wins,
      escape_logo.web_file AS escape_logo, hunter_logo.web_file AS hunter_logo
    FROM teams t
    LEFT JOIN players p ON p.team_id = t.id
    LEFT JOIN event_teams et ON et.team_id = t.id
    LEFT JOIN matches m ON m.winner_team_id = t.id AND m.id != 'bp-interface-test-match'
    LEFT JOIN team_logos escape_logo ON escape_logo.team_id = t.id AND escape_logo.kind = 'escape'
    LEFT JOIN team_logos hunter_logo ON hunter_logo.team_id = t.id AND hunter_logo.kind = 'hunter'
    ${where}
    GROUP BY t.id
    ORDER BY t.display_name
    LIMIT ? OFFSET ?`).all(...params, options.limit, options.offset).map(row => ({
      id: row.id,
      name: row.display_name,
      playerCount: Number(row.player_count || 0),
      escapeCount: Number(row.escape_count || 0),
      hunterCount: Number(row.hunter_count || 0),
      eventCount: Number(row.event_count || 0),
      matchWins: Number(row.match_wins || 0),
      logos: { escape: row.escape_logo || null, hunter: row.hunter_logo || null }
    }));
  return { total, limit: options.limit, offset: options.offset, hasMore: options.offset + items.length < total, items };
}

function listPlayers(database, rawOptions = {}) {
  const options = pageOptions(rawOptions);
  const clauses = [];
  const params = [];
  if (options.query) {
    const pattern = `%${options.query}%`;
    clauses.push('(p.nickname LIKE ? OR p.official_id LIKE ? OR p.registered_nickname LIKE ? OR t.display_name LIKE ?)');
    params.push(pattern, pattern, pattern, pattern);
  }
  if (options.teamId) {
    clauses.push('p.team_id = ?');
    params.push(options.teamId);
  }
  if (options.role) {
    clauses.push('p.role = ?');
    params.push(options.role);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = Number(database.prepare(`SELECT COUNT(*) AS count FROM players p
    JOIN teams t ON t.id = p.team_id ${where}`).get(...params)?.count || 0);
  const items = database.prepare(`SELECT p.player_id, p.nickname, p.official_id,
      p.registered_nickname, p.registered_official_id, p.role, p.slot, p.is_substitute,
      t.id AS team_id, t.display_name AS team_name, logo.web_file AS team_logo
    FROM players p
    JOIN teams t ON t.id = p.team_id
    LEFT JOIN team_logos logo ON logo.team_id = p.team_id AND logo.kind = p.role
    ${where}
    ORDER BY t.display_name, p.role, p.is_substitute, p.slot, p.nickname
    LIMIT ? OFFSET ?`).all(...params, options.limit, options.offset).map(row => ({
      id: row.player_id,
      nickname: row.nickname,
      officialId: row.official_id,
      registeredNickname: row.registered_nickname,
      registeredOfficialId: row.registered_official_id,
      role: row.role,
      slot: row.slot,
      substitute: Boolean(row.is_substitute),
      team: { id: row.team_id, name: row.team_name, logo: row.team_logo || null }
    }));
  return { total, limit: options.limit, offset: options.offset, hasMore: options.offset + items.length < total, items };
}

function resourceSnapshot(database) {
  const kinds = database.prepare(`SELECT kind, COUNT(*) AS count, MAX(added_at) AS latest_at
    FROM material_entries GROUP BY kind ORDER BY count DESC, kind`).all();
  const recent = database.prepare(`SELECT id, path, kind, added_at FROM material_entries
    ORDER BY added_at DESC, path LIMIT 30`).all().map(row => ({
      id: row.id,
      name: path.basename(row.path),
      extension: row.kind === 'file' ? path.extname(row.path).slice(1).toLowerCase() || 'file' : 'folder',
      kind: row.kind,
      addedAt: row.added_at
    }));
  const validation = database.prepare(`SELECT valid, reference_count, object_count, missing_count, checked_at
    FROM asset_path_validation ORDER BY checked_at DESC LIMIT 1`).get();
  return {
    metrics: {
      materials: tableCount(database, 'material_entries'),
      files: Number(kinds.find(item => item.kind === 'file')?.count || 0),
      folders: Number(kinds.find(item => item.kind === 'folder')?.count || 0),
      watchedFolders: tableCount(database, 'material_watched_folders')
    },
    kinds: kinds.map(item => ({ kind: item.kind, count: Number(item.count), latestAt: item.latest_at })),
    validation: validation ? {
      valid: Boolean(validation.valid),
      referenceCount: Number(validation.reference_count || 0),
      objectCount: Number(validation.object_count || 0),
      missingCount: Number(validation.missing_count || 0),
      checkedAt: validation.checked_at
    } : null,
    recent
  };
}

function listMatchRecords(database, rawOptions = {}) {
  const options = pageOptions(rawOptions);
  const filters = scheduleFilters(options);
  const total = Number(database.prepare(`SELECT COUNT(*) AS count FROM matches m
    JOIN events e ON e.id = m.event_id ${filters.sql}`).get(...filters.params)?.count || 0);
  const items = database.prepare(`${EFFECTIVE_SESSIONS_CTE}
    SELECT m.id, m.event_id, e.name AS event_name, e.division, m.date, m.start_time,
      COALESCE(home.display_name, m.matchup_home) AS home_name,
      COALESCE(away.display_name, m.matchup_away) AS away_name,
      m.winner_team_id, winner.display_name AS winner_name,
      COUNT(DISTINCT es.id) AS effective_game_count,
      COUNT(DISTINCT result.session_id) AS completed_game_count,
      SUM(CASE WHEN result.winner_team_id = m.matchup_home THEN 1 ELSE 0 END) AS home_game_wins,
      SUM(CASE WHEN result.winner_team_id = m.matchup_away THEN 1 ELSE 0 END) AS away_game_wins,
      MAX(result.decided_at) AS decided_at,
      MAX(es.attempt) AS highest_attempt,
      COUNT(DISTINCT CASE WHEN es.replay_of IS NOT NULL OR es.attempt > 1 THEN es.id END) AS replay_count
    FROM matches m
    JOIN events e ON e.id = m.event_id
    LEFT JOIN teams home ON home.id = m.matchup_home
    LEFT JOIN teams away ON away.id = m.matchup_away
    LEFT JOIN teams winner ON winner.id = m.winner_team_id
    LEFT JOIN effective_sessions es ON es.match_id = m.id
    LEFT JOIN bp_session_results result ON result.session_id = es.id
    ${filters.sql}
    GROUP BY m.id
    ORDER BY COALESCE(result.decided_at, 0) DESC, COALESCE(m.date, '') DESC, m.sort_order DESC
    LIMIT ? OFFSET ?`).all(...filters.params, options.limit, options.offset).map(row => ({
      id: row.id,
      eventId: row.event_id,
      eventName: row.event_name,
      division: row.division,
      date: row.date,
      startTime: row.start_time,
      homeName: row.home_name,
      awayName: row.away_name,
      winner: row.winner_team_id ? { id: row.winner_team_id, name: row.winner_name || row.winner_team_id } : null,
      effectiveGameCount: Number(row.effective_game_count || 0),
      completedGameCount: Number(row.completed_game_count || 0),
      score: { home: Number(row.home_game_wins || 0), away: Number(row.away_game_wins || 0) },
      decidedAt: row.decided_at,
      highestAttempt: Number(row.highest_attempt || 0),
      replayCount: Number(row.replay_count || 0)
    }));
  return { total, limit: options.limit, offset: options.offset, hasMore: options.offset + items.length < total, items };
}

function teamDetail(database, rawTeamId) {
  const teamId = String(rawTeamId || '').trim().slice(0, 100);
  if (!teamId) {
    const error = new Error('缺少战队 ID');
    error.code = 'TEAM_ID_REQUIRED';
    throw error;
  }
  const team = database.prepare('SELECT id, display_name, division, aliases_json FROM teams WHERE id = ?').get(teamId);
  if (!team) {
    const error = new Error('战队不存在');
    error.code = 'TEAM_NOT_FOUND';
    throw error;
  }
  let aliases = [];
  if (team.aliases_json) {
    try {
      const parsed = JSON.parse(team.aliases_json);
      if (Array.isArray(parsed)) aliases = parsed.map(item => String(item)).filter(Boolean);
    } catch { aliases = []; }
  }
  // 历史赛程的 matchup_home/matchup_away 可能存显示名而非队伍 id,先建名字到 id 的解析表
  const teamIdByName = new Map();
  for (const row of database.prepare('SELECT id, display_name, aliases_json FROM teams').all()) {
    const names = [row.id, row.display_name];
    if (row.aliases_json) {
      try {
        const parsed = JSON.parse(row.aliases_json);
        if (Array.isArray(parsed)) names.push(...parsed.map(item => String(item)));
      } catch { /* 别名解析失败只影响名字匹配 */ }
    }
    for (const name of names) {
      if (name) teamIdByName.set(String(name).toLowerCase(), row.id);
    }
  }
  const selfVariants = [...new Set([team.id, team.display_name, ...aliases]
    .map(value => String(value).toLowerCase()).filter(Boolean))];
  const variantPlaceholders = selfVariants.map(() => '?').join(', ');
  const roster = database.prepare(`SELECT player_id, nickname, official_id, registered_nickname,
      registered_official_id, role, slot, is_substitute
    FROM players WHERE team_id = ?
    ORDER BY role, is_substitute, slot, nickname`).all(teamId).map(row => ({
    id: row.player_id,
    nickname: row.nickname,
    officialId: row.official_id,
    registeredNickname: row.registered_nickname,
    registeredOfficialId: row.registered_official_id,
    role: row.role,
    slot: Number(row.slot || 0),
    substitute: Boolean(row.is_substitute)
  }));
  const events = database.prepare(`SELECT e.id, e.name, e.division, e.date, e.stage_label, e.stage, e.mode, e.format
    FROM event_teams et JOIN events e ON e.id = et.event_id
    WHERE et.team_id = ?
    ORDER BY COALESCE(e.date, '9999-12-31'), e.sort_order, e.name`).all(teamId).map(row => ({
    id: row.id,
    name: row.name,
    division: row.division,
    date: row.date,
    stage: row.stage_label || row.stage,
    mode: row.mode,
    format: row.format
  }));
  const records = database.prepare(`${EFFECTIVE_SESSIONS_CTE}
    SELECT m.id, e.name AS event_name, m.date, m.start_time,
      m.matchup_home, m.matchup_away, m.winner_team_id,
      GROUP_CONCAT(result.winner_team_id) AS game_winners,
      MAX(result.decided_at) AS decided_at
    FROM matches m
    JOIN events e ON e.id = m.event_id
    LEFT JOIN effective_sessions es ON es.match_id = m.id
    LEFT JOIN bp_session_results result ON result.session_id = es.id
    WHERE m.id != 'bp-interface-test-match'
      AND (LOWER(m.matchup_home) IN (${variantPlaceholders}) OR LOWER(m.matchup_away) IN (${variantPlaceholders}))
    GROUP BY m.id
    ORDER BY COALESCE(result.decided_at, 0) DESC, COALESCE(m.date, '') DESC, m.sort_order DESC
    LIMIT 8`).all(...selfVariants, ...selfVariants).map(row => {
    const resolveId = value => teamIdByName.get(String(value ?? '').toLowerCase()) || null;
    const homeId = resolveId(row.matchup_home);
    const awayId = resolveId(row.matchup_away);
    let homeWins = 0;
    let awayWins = 0;
    for (const winner of String(row.game_winners || '').split(',')) {
      const winnerId = resolveId(winner);
      if (!winnerId) continue;
      if (winnerId === homeId) homeWins += 1;
      else if (winnerId === awayId) awayWins += 1;
    }
    return {
      id: row.id,
      eventName: row.event_name,
      date: row.date,
      startTime: row.start_time,
      home: { id: homeId, name: row.matchup_home },
      away: { id: awayId, name: row.matchup_away },
      score: { home: homeWins, away: awayWins },
      decided: row.winner_team_id != null,
      won: row.winner_team_id === teamId,
      decidedAt: row.decided_at
    };
  });
  const totals = database.prepare(`SELECT COUNT(*) AS played,
      COALESCE(SUM(CASE WHEN m.winner_team_id = ? THEN 1 ELSE 0 END), 0) AS wins
    FROM matches m
    WHERE m.id != 'bp-interface-test-match' AND m.winner_team_id IS NOT NULL
      AND (LOWER(m.matchup_home) IN (${variantPlaceholders}) OR LOWER(m.matchup_away) IN (${variantPlaceholders}))`)
    .get(teamId, ...selfVariants, ...selfVariants);
  const played = Number(totals?.played || 0);
  const wins = Number(totals?.wins || 0);

  // 角色使用统计:有效局中该队阵营的 pick 槽位(阵营由 match_rooms 决定)
  const sideExpression = `CASE WHEN LOWER(mr.escape_team_id) IN (${variantPlaceholders}) THEN 'escape'
    WHEN LOWER(mr.hunter_team_id) IN (${variantPlaceholders}) THEN 'hunter' END`;
  const teamRoomsClause = `(LOWER(mr.escape_team_id) IN (${variantPlaceholders}) OR LOWER(mr.hunter_team_id) IN (${variantPlaceholders}))`;
  const totalGames = Number(database.prepare(`${EFFECTIVE_SESSIONS_CTE}
    SELECT COUNT(DISTINCT es.id) AS total
    FROM effective_sessions es
    JOIN match_rooms mr ON mr.match_id = es.match_id AND mr.room = es.room
    WHERE es.match_id != 'bp-interface-test-match' AND ${teamRoomsClause}`)
    .get(...selfVariants, ...selfVariants)?.total || 0);
  const common = database.prepare(`${EFFECTIVE_SESSIONS_CTE}
    SELECT s.character_id AS id, COALESCE(c.nickname, s.character_id) AS nickname,
      COUNT(DISTINCT es.id) AS uses,
      COUNT(DISTINCT CASE WHEN LOWER(r.winner_team_id) IN (${variantPlaceholders}) THEN es.id END) AS wins
    FROM effective_sessions es
    JOIN match_rooms mr ON mr.match_id = es.match_id AND mr.room = es.room
    JOIN bp_session_slots s ON s.session_id = es.id
      AND s.character_id IS NOT NULL
      AND s.slot_id LIKE (${sideExpression} || '-pick-%')
    LEFT JOIN characters c ON c.id = s.character_id
    LEFT JOIN bp_session_results r ON r.session_id = es.id
    WHERE es.match_id != 'bp-interface-test-match' AND ${teamRoomsClause}
    GROUP BY s.character_id
    ORDER BY uses DESC, nickname
    LIMIT 8`).all(...selfVariants, ...selfVariants, ...selfVariants, ...selfVariants, ...selfVariants)
    .map(row => {
      const uses = Number(row.uses || 0);
      const charWins = Number(row.wins || 0);
      return {
        id: row.id,
        nickname: row.nickname,
        uses,
        winRate: uses ? charWins / uses : null,
        usageRate: totalGames ? uses / totalGames : null
      };
    });
  const latestSession = database.prepare(`${EFFECTIVE_SESSIONS_CTE}
    SELECT es.id AS session_id, es.match_id, es.game_number, mr.escape_team_id, mr.hunter_team_id,
      m.matchup_home, m.matchup_away, m.date, e.name AS event_name
    FROM effective_sessions es
    JOIN match_rooms mr ON mr.match_id = es.match_id AND mr.room = es.room
    JOIN matches m ON m.id = es.match_id
    JOIN events e ON e.id = m.event_id
    LEFT JOIN bp_session_results r ON r.session_id = es.id
    WHERE es.match_id != 'bp-interface-test-match' AND ${teamRoomsClause}
    ORDER BY COALESCE(r.decided_at, 0) DESC, COALESCE(m.date, '') DESC, es.game_number DESC
    LIMIT 1`).get(...selfVariants, ...selfVariants);
  let latestLineup = null;
  if (latestSession) {
    const side = selfVariants.includes(String(latestSession.escape_team_id || '').toLowerCase()) ? 'escape' : 'hunter';
    const lineupRows = database.prepare(`SELECT s.character_id AS id, COALESCE(c.nickname, s.character_id) AS nickname,
        c.portrait_url AS portrait
      FROM bp_session_slots s
      LEFT JOIN characters c ON c.id = s.character_id
      WHERE s.session_id = ? AND s.character_id IS NOT NULL AND s.slot_id LIKE ?
      ORDER BY s.slot_id`).all(latestSession.session_id, `${side}-pick-%`);
    const seenCharacters = new Set();
    const lineup = lineupRows.filter(item => {
      if (seenCharacters.has(item.id)) return false;
      seenCharacters.add(item.id);
      return true;
    });
    const resolveDisplayName = value => {
      const resolved = teamIdByName.get(String(value ?? '').toLowerCase());
      return resolved ? database.prepare('SELECT display_name FROM teams WHERE id = ?').get(resolved)?.display_name || value : value;
    };
    latestLineup = {
      matchId: latestSession.match_id,
      side,
      lineup,
      eventName: latestSession.event_name,
      date: latestSession.date,
      matchupHome: resolveDisplayName(latestSession.matchup_home) || 'TBD',
      matchupAway: resolveDisplayName(latestSession.matchup_away) || 'TBD'
    };
  }

  return {
    team: { id: team.id, name: team.display_name, division: team.division, aliases },
    roster,
    events,
    records,
    totals: { played, wins, winRate: played ? wins / played : null },
    characters: { totalGames, common, latest: latestLineup }
  };
}

function dataConfiguration(database) {
  const entityTables = [
    ['events', '赛事'], ['matches', '赛程'], ['teams', '战队'], ['players', '选手'],
    ['characters', '角色'], ['bp_sessions', 'BP 会话'], ['material_entries', '素材索引'],
    ['users', '用户'], ['communication_messages', '通讯消息'], ['notifications', '通知']
  ];
  const sources = database.prepare(`SELECT id, name, division, source_workbook, source_workbook_sha256
    FROM events ORDER BY sort_order, name`).all().map(row => ({
      id: row.id,
      name: row.name,
      division: row.division,
      sourceName: row.source_workbook ? path.basename(row.source_workbook) : null,
      fingerprint: row.source_workbook_sha256 ? String(row.source_workbook_sha256).slice(0, 12) : null
    }));
  return {
    schemaVersion: databaseVersion(database),
    entities: entityTables.map(([table, label]) => ({ key: table, label, count: tableCount(database, table) })),
    sources
  };
}

function terminalSnapshot(database, runtime = {}) {
  const openDuty = Number(database.prepare('SELECT COUNT(*) AS count FROM user_duty_logs WHERE ended_at IS NULL').get()?.count || 0);
  const lastDatabaseActivity = database.prepare(`SELECT MAX(value) AS latest FROM (
      SELECT MAX(updated_at) AS value FROM bp_sessions
      UNION ALL SELECT MAX(timestamp_ms) AS value FROM account_operation_logs
      UNION ALL SELECT MAX(added_at) AS value FROM material_entries
    )`).get()?.latest || null;
  return {
    process: {
      pid: runtime.pid || process.pid,
      node: runtime.node || process.version,
      platform: runtime.platform || process.platform,
      uptimeSeconds: Math.floor(runtime.uptimeSeconds ?? process.uptime()),
      startedAt: runtime.startedAt || null,
      memory: runtime.memory || process.memoryUsage()
    },
    connections: {
      activeSessions: Number(runtime.activeSessions || 0),
      dutySessions: openDuty,
      communicationStreams: Number(runtime.communicationStreams || 0),
      notificationStreams: Number(runtime.notificationStreams || 0),
      presentationStreams: Number(runtime.presentationStreams || 0)
    },
    database: {
      schemaVersion: databaseVersion(database),
      lastActivityAt: lastDatabaseActivity,
      healthy: Boolean(database.prepare('PRAGMA quick_check').get()?.quick_check === 'ok')
    }
  };
}

function settingsSnapshot(database, runtime = {}) {
  return {
    laboratory: laboratorySettings(database)
  };
}

function hudSnapshot(database, runtime = {}) {
  const hubs = database.prepare('SELECT * FROM hub_states ORDER BY hub_id').all().map(row => ({
    id: row.hub_id,
    mode: row.mode,
    durationSeconds: row.duration_seconds,
    remainingSeconds: row.remaining_seconds,
    running: Boolean(row.running),
    updatedAt: row.updated_at
  }));
  const presentation = database.prepare(`SELECT state.*, session.match_id, session.game_number, session.room,
      event.name AS event_name
    FROM bp_presentation_state state
    LEFT JOIN bp_sessions session ON session.id = state.active_session_id
    LEFT JOIN matches match ON match.id = session.match_id
    LEFT JOIN events event ON event.id = match.event_id
    WHERE state.id = 1`).get();
  const recentObs = database.prepare(`SELECT timestamp_ms, label, ok, error
    FROM obs_operation_logs ORDER BY timestamp_ms DESC LIMIT 12`).all().map(row => ({
      timestamp: row.timestamp_ms,
      label: row.label,
      ok: Boolean(row.ok),
      error: row.error || null
    }));
  return {
    obs: runtime.obs || null,
    hubs,
    presentation: presentation ? {
      enabled: Boolean(presentation.dynamic_enabled),
      visibility: presentation.visibility,
      reason: presentation.reason,
      activeSessionId: presentation.active_session_id,
      eventName: presentation.event_name || null,
      matchId: presentation.match_id || null,
      gameNumber: presentation.game_number || null,
      room: presentation.room || null,
      updatedAt: presentation.updated_at
    } : null,
    recentObs
  };
}

function alertsSnapshot(database) {
  const items = database.prepare(`SELECT id, timestamp_ms, actor_display_name, action, success,
      error, category, ip_address, region, device_name, actor_identity_key, sensitive
    FROM account_operation_logs
    WHERE sensitive = 1 OR success = 0 OR error IS NOT NULL
    ORDER BY timestamp_ms DESC LIMIT 100`).all().map(row => ({
      id: row.id,
      timestamp: row.timestamp_ms,
      actor: row.actor_display_name || '系统',
      action: row.action,
      success: Boolean(row.success),
      error: row.error || null,
      category: row.category,
      ipAddress: row.ip_address || 'unknown',
      region: row.region || '未知地区',
      deviceName: row.device_name || '未知设备',
      identityKey: row.actor_identity_key || 'unknown',
      sensitive: Boolean(row.sensitive)
    }));
  const obsFailures = database.prepare(`SELECT timestamp_ms, label, error
    FROM obs_operation_logs WHERE ok = 0 ORDER BY timestamp_ms DESC LIMIT 30`).all().map(row => ({
      timestamp: row.timestamp_ms,
      label: row.label,
      error: row.error || 'OBS 操作失败'
    }));
  return {
    metrics: {
      sensitive: items.filter(item => item.sensitive).length,
      failed: items.filter(item => !item.success).length,
      obsFailed: obsFailures.length,
      unresolved: items.filter(item => !item.success || item.error).length + obsFailures.length
    },
    items,
    obsFailures
  };
}

function personalSnapshot(database, options = {}) {
  const userId = options.userId;
  const today = options.today || new Date().toISOString().slice(0, 10);
  const user = userId ? database.prepare(`SELECT id, username, display_name FROM users WHERE id = ?`).get(userId) : null;
  const duty = userId ? database.prepare(`SELECT COUNT(*) AS sessions,
      COALESCE(SUM(CASE WHEN ended_at IS NULL THEN MAX(0, CAST((? - started_at) / 1000 AS INTEGER)) ELSE duration_seconds END), 0) AS seconds
    FROM user_duty_logs WHERE user_id = ? AND date(started_at / 1000, 'unixepoch', 'localtime') = ?`)
    .get(Date.now(), userId, today) : { sessions: 0, seconds: 0 };
  const todayMatches = database.prepare(`SELECT m.id, m.date, m.start_time, m.matchup_home, m.matchup_away,
      m.winner_team_id, e.name AS event_name, e.division
    FROM matches m JOIN events e ON e.id = m.event_id
    WHERE COALESCE(m.date, e.date) = ?
    ORDER BY COALESCE(m.start_time, '99:99'), m.sort_order`).all(today);
  const nearestMatches = todayMatches.length ? [] : database.prepare(`SELECT m.id, m.date, m.start_time,
      m.matchup_home, m.matchup_away, m.winner_team_id, e.name AS event_name, e.division
    FROM matches m JOIN events e ON e.id = m.event_id
    ORDER BY ABS(julianday(COALESCE(m.date, e.date)) - julianday(?)), m.sort_order LIMIT 4`).all(today);
  const recentActions = userId ? database.prepare(`SELECT timestamp_ms, action, success, actor_identity_key
    FROM account_operation_logs WHERE actor_user_id = ? ORDER BY timestamp_ms DESC LIMIT 6`).all(userId) : [];
  const activity = userId ? database.prepare(`SELECT date(timestamp_ms / 1000, 'unixepoch', 'localtime') AS day,
      COUNT(*) AS total
    FROM account_operation_logs
    WHERE actor_user_id = ? AND timestamp_ms >= ?
    GROUP BY day ORDER BY day`).all(userId, Date.now() - 182 * 86400000) : [];
  return {
    user: user ? { id: user.id, account: user.username, displayName: user.display_name || user.username } : null,
    today,
    duty: { sessions: Number(duty.sessions || 0), seconds: Number(duty.seconds || 0) },
    matches: todayMatches.length ? todayMatches : nearestMatches,
    scheduleMode: todayMatches.length ? 'today' : 'nearest',
    recentActions: recentActions.map(row => ({
      timestamp: row.timestamp_ms,
      action: row.action,
      success: Boolean(row.success),
      identityKey: row.actor_identity_key || 'unknown'
    })),
    activity: activity.map(row => ({ day: row.day, count: Number(row.total) })),
    todos: [
      { id: 'bp-room', page: 'schedule', title: 'A/B 房控制', description: '赛程管理的比赛编辑弹窗内设置 BP 房间' },
      { id: 'commentator', page: 'schedule', title: '解说组图与兑换码', description: '赛程管理的比赛编辑弹窗底部选择并同步 OBS' },
      { id: 'start-bp', page: 'schedule', title: '开始 BP', description: '赛程管理对阵卡上直接发起 BP 控制台' },
      { id: 'obs-websocket', page: 'hudCenter', title: 'OBS WebSocket 连接', description: '已迁移至 HUD 中心页面' }
    ]
  };
}

function operationsView(database = defaultDb, view, options = {}) {
  if (!ALL_VIEWS.has(view)) {
    const error = new Error('未知运营数据视图');
    error.code = 'OPERATIONS_VIEW_NOT_FOUND';
    throw error;
  }
  let data;
  if (view === 'personal') data = personalSnapshot(database, options);
  else if (view === 'events') data = listEvents(database, options);
  else if (view === 'schedule') data = listSchedule(database, options);
  else if (view === 'teams') data = listTeams(database, options);
  else if (view === 'players') data = listPlayers(database, options);
  else if (view === 'resources') data = resourceSnapshot(database);
  else if (view === 'matches') data = listMatchRecords(database, options);
  else if (view === 'dataConfig') data = dataConfiguration(database);
  else if (view === 'terminal') data = terminalSnapshot(database, options.runtime);
  else if (view === 'settings') data = settingsSnapshot(database, options.runtime);
  else if (view === 'hud') data = hudSnapshot(database, options.runtime);
  else if (view === 'alerts') data = alertsSnapshot(database);
  return { view, generatedAt: Date.now(), data };
}

module.exports = {
  ALL_VIEWS,
  MANAGEMENT_VIEWS,
  PUBLIC_VIEWS,
  operationsView,
  listEvents,
  listSchedule,
  listTeams,
  listPlayers,
  listMatchRecords,
  teamDetail
};
