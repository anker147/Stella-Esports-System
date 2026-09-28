const crypto = require('node:crypto');
const { db: defaultDb } = require('./db');

const DIVISIONS = new Set(['pc', 'mobile', 'all']);
const VISIBILITIES = new Set(['system', 'participants', 'invite_only']);
const REGISTRATION_METHODS = new Set(['invite', 'manual', 'closed']);
const TEAM_REQUIREMENTS = new Set(['any', 'club', 'organization']);
const ORGANIZER_TYPES = new Set(['personal', 'organization']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const STAGE_FORMATS = new Set(['BO1', 'BO3', 'BO5', '单败淘汰', '双败淘汰', '循环赛', '积分赛', '自定义']);
const WEEKDAYS = new Set(['1', '2', '3', '4', '5', '6', '7']);

function text(value, label, maximum, required = false) {
  const result = String(value || '').trim();
  if (required && !result) throw new Error(`${label}不能为空`);
  if (result.length > maximum) throw new Error(`${label}不能超过 ${maximum} 个字符`);
  return result;
}

function urlValue(value, label, required = false) {
  const result = text(value, label, 500, required);
  if (!result) return '';
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${label}不是有效链接`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${label}仅支持 HTTP 或 HTTPS 链接`);
  return parsed.toString();
}

function enumValue(value, values, label, fallback) {
  const result = String(value || fallback);
  if (!values.has(result)) throw new Error(`${label}无效`);
  return result;
}

function dateValue(value, label, required = false) {
  const result = String(value || '').trim();
  if (required && !result) throw new Error(`${label}不能为空`);
  if (result && !/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error(`${label}格式无效`);
  return result || null;
}

function integerValue(value, label, minimum, maximum, required = false) {
  if (value === '' || value === undefined || value === null) {
    if (required) throw new Error(`${label}不能为空`);
    return null;
  }
  const result = Number(value);
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${label}必须在 ${minimum} 到 ${maximum} 之间`);
  }
  return result;
}

function normalizeEventInput(source = {}) {
  const event = {
    name: text(source.name, '赛事名称', 80, true),
    format: text(source.format, '赛程赛制', 80, true),
    maxTeams: integerValue(source.maxTeams, '最大队伍数', 2, 128, true),
    description: text(source.description, '赛事简介', 1000),
    eventType: enumValue(source.eventType, new Set(['private']), '赛事类型', 'private'),
    requireRealName: Boolean(source.requireRealName),
    visibility: enumValue(source.visibility, VISIBILITIES, '可见范围', 'system'),
    registrationMethod: enumValue(source.registrationMethod, REGISTRATION_METHODS, '报名方式', 'invite'),
    teamRequirement: enumValue(source.teamRequirement, TEAM_REQUIREMENTS, '队伍类型要求', 'any'),
    division: enumValue(source.division, DIVISIONS, '比赛赛区', 'all'),
    priority: integerValue(source.priority, '赛事级别', 0, 1000) ?? 0,
    startDate: dateValue(source.startDate, '赛事开始日期', true),
    endDate: dateValue(source.endDate, '赛事结束日期', true),
    registrationStart: dateValue(source.registrationStart, '报名开始日期'),
    registrationEnd: dateValue(source.registrationEnd, '报名结束日期'),
    minTeamMembers: integerValue(source.minTeamMembers, '最少队伍人数', 1, 99, true),
    maxTeamMembers: integerValue(source.maxTeamMembers, '最多队伍人数', 1, 99, true),
    requireSystemLogin: Boolean(source.requireSystemLogin),
    organizerType: enumValue(source.organizerType, ORGANIZER_TYPES, '主办方类型', 'personal'),
    organizerName: text(source.organizerName, '主办方', 100, true),
    contact: text(source.contact || source.contactGroup, '联系方式', 160, true),
    handbookUrl: urlValue(source.handbookUrl, '赛事手册链接'),
    contactGroup: text(source.contactGroup || source.contact, '赛事联络群', 160, true),
    contactGroupUrl: urlValue(source.contactGroupUrl, '加群链接'),
    rulesText: text(source.rulesText || '赛事规则待补充', '赛事规则', 12000, true),
    teamIds: [...new Set((Array.isArray(source.teamIds) ? source.teamIds : []).map(value => String(value).trim()).filter(Boolean))]
  };
  if (event.endDate < event.startDate) throw new Error('赛事结束日期不能早于开始日期');
  if (event.registrationStart && event.registrationEnd && event.registrationEnd < event.registrationStart) {
    throw new Error('报名结束日期不能早于报名开始日期');
  }
  if (event.minTeamMembers > event.maxTeamMembers) throw new Error('最多队伍人数不能少于最少队伍人数');
  return event;
}

function decodeImage(value, kind) {
  if (!value) return null;
  const match = String(value).match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !IMAGE_TYPES.has(match[1])) throw new Error(`${kind}仅支持 PNG、JPEG 或 WebP 图片`);
  const data = Buffer.from(match[2], 'base64');
  const maximum = kind === '赛事 LOGO' ? 2 * 1024 * 1024 : 4 * 1024 * 1024;
  if (!data.length || data.length > maximum) throw new Error(`${kind}文件过大`);
  return {
    mimeType: match[1],
    data,
    byteSize: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex')
  };
}

function withTransaction(database, callback) {
  database.exec('BEGIN');
  try {
    const result = callback();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function writeMedia(database, eventId, kind, changed, value, now) {
  if (!changed) return;
  database.prepare('DELETE FROM tournament_event_media WHERE tournament_event_id = ? AND kind = ?').run(eventId, kind);
  const image = decodeImage(value, kind === 'logo' ? '赛事 LOGO' : kind === 'group_qr' ? '加群二维码' : '赛事 KV');
  if (!image) return;
  database.prepare(`INSERT INTO tournament_event_media
    (tournament_event_id, kind, mime_type, data, byte_size, sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    eventId, kind, image.mimeType, image.data, image.byteSize, image.sha256, now, now
  );
}

function validateEventTeams(database, teamIds, division, minMembers, maxMembers) {
  if (!teamIds.length) return [];
  const placeholders = teamIds.map(() => '?').join(',');
  const rows = database.prepare(`SELECT t.id, t.division, COUNT(DISTINCT p.player_id) AS member_count
    FROM teams t LEFT JOIN players p ON p.team_id = t.id
    WHERE t.id IN (${placeholders}) GROUP BY t.id`).all(...teamIds);
  if (rows.length !== teamIds.length) throw new Error('参赛队伍中包含不存在的系统队伍');
  if (division !== 'all' && rows.some(row => row.division && row.division !== division)) {
    throw new Error('参赛队伍中包含不符合赛事赛区的队伍');
  }
  const invalidSize = rows.find(row => Number(row.member_count) < minMembers || Number(row.member_count) > maxMembers);
  if (invalidSize) throw new Error('参赛队伍中包含不符合人数要求的队伍');
  return rows.map(row => row.id);
}

// 分级降级：任何一层依赖表缺失时逐级重试，尽量保留赛区与 LOGO 字段，并在日志中记录降级原因
const TEAM_CANDIDATE_QUERIES = [
  `SELECT t.id, t.display_name AS name,
      COALESCE(t.division, (
        SELECT CASE WHEN COUNT(DISTINCT e.division) = 1 THEN MIN(e.division) ELSE NULL END
        FROM (
          SELECT et.event_id AS event_id FROM event_teams et WHERE et.team_id = t.id
          UNION
          SELECT m.event_id AS event_id FROM matches m
            JOIN match_rooms mr ON mr.match_id = m.id
            WHERE mr.escape_team_id = t.id OR mr.hunter_team_id = t.id
        ) part
        JOIN events e ON e.id = part.event_id
        WHERE e.division IN ('pc', 'mobile')
      )) AS team_division,
      COUNT(DISTINCT p.player_id) AS member_count,
      COUNT(DISTINCT CASE WHEN p.role = 'escape' THEN p.player_id END) AS escape_count,
      COUNT(DISTINCT CASE WHEN p.role = 'hunter' THEN p.player_id END) AS hunter_count,
      COUNT(DISTINCT et.event_id) AS event_count,
      COUNT(DISTINCT CASE WHEN m.winner_team_id = t.id THEN m.id END) AS match_wins,
      MAX(CASE WHEN logo.kind = 'escape' THEN logo.web_file END) AS escape_logo_url,
      MAX(CASE WHEN logo.kind = 'hunter' THEN logo.web_file END) AS hunter_logo_url
    FROM teams t
    LEFT JOIN players p ON p.team_id = t.id
    LEFT JOIN team_logos logo ON logo.team_id = t.id
    LEFT JOIN event_teams et ON et.team_id = t.id
    LEFT JOIN matches m ON m.winner_team_id = t.id AND m.id != 'bp-interface-test-match'
    GROUP BY t.id ORDER BY t.display_name, t.id`,
  `SELECT t.id, t.display_name AS name, t.division AS team_division,
      COUNT(DISTINCT p.player_id) AS member_count,
      COUNT(DISTINCT CASE WHEN p.role = 'escape' THEN p.player_id END) AS escape_count,
      COUNT(DISTINCT CASE WHEN p.role = 'hunter' THEN p.player_id END) AS hunter_count,
      COUNT(DISTINCT et.event_id) AS event_count,
      0 AS match_wins,
      MAX(CASE WHEN logo.kind = 'escape' THEN logo.web_file END) AS escape_logo_url,
      MAX(CASE WHEN logo.kind = 'hunter' THEN logo.web_file END) AS hunter_logo_url
    FROM teams t
    LEFT JOIN players p ON p.team_id = t.id
    LEFT JOIN team_logos logo ON logo.team_id = t.id
    LEFT JOIN event_teams et ON et.team_id = t.id
    GROUP BY t.id ORDER BY t.display_name, t.id`,
  `SELECT t.id, t.display_name AS name, t.division AS team_division,
      COUNT(DISTINCT p.player_id) AS member_count,
      0 AS escape_count, 0 AS hunter_count, 0 AS event_count, 0 AS match_wins,
      MAX(CASE WHEN logo.kind = 'escape' THEN logo.web_file END) AS escape_logo_url,
      MAX(CASE WHEN logo.kind = 'hunter' THEN logo.web_file END) AS hunter_logo_url
    FROM teams t
    LEFT JOIN players p ON p.team_id = t.id
    LEFT JOIN team_logos logo ON logo.team_id = t.id
    GROUP BY t.id ORDER BY t.display_name, t.id`,
  `SELECT t.id, t.display_name AS name, NULL AS team_division,
      COUNT(DISTINCT p.player_id) AS member_count,
      0 AS escape_count, 0 AS hunter_count, 0 AS event_count, 0 AS match_wins,
      NULL AS escape_logo_url, NULL AS hunter_logo_url
    FROM teams t LEFT JOIN players p ON p.team_id = t.id
    GROUP BY t.id ORDER BY t.display_name, t.id`
];

function findEventTeamCandidates(database = defaultDb, division = 'all', minMembers = 1, maxMembers = 99) {
  let rows;
  let lastError;
  let usedTier = -1;
  for (let index = 0; index < TEAM_CANDIDATE_QUERIES.length; index += 1) {
    try {
      rows = database.prepare(TEAM_CANDIDATE_QUERIES[index]).all();
      usedTier = index;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!rows) throw lastError;
  if (usedTier > 0) {
    console.warn(`[events] team-candidates 降级到第 ${usedTier + 1} 级查询: ${lastError?.message}`);
  }
  return rows
    .filter(row => Number(row.member_count) >= Number(minMembers) && Number(row.member_count) <= Number(maxMembers))
    .filter(row => division === 'all' || !row.team_division || row.team_division === division)
    .map(row => ({
      id: row.id,
      name: row.name,
      memberCount: Number(row.member_count || 0),
      escapeCount: Number(row.escape_count || 0),
      hunterCount: Number(row.hunter_count || 0),
      eventCount: Number(row.event_count || 0),
      matchWins: Number(row.match_wins || 0),
      division: row.team_division || null,
      logoUrl: row.escape_logo_url || row.hunter_logo_url || null,
      logos: { escape: row.escape_logo_url || null, hunter: row.hunter_logo_url || null }
    }));
}

function createManagedEvent(database = defaultDb, source, actorUserId = null) {
  const event = normalizeEventInput(source);
  if (event.teamIds.length < 2) throw new Error('正式赛事至少需要选择两支参赛队伍');
  if (event.teamIds.length > event.maxTeams) throw new Error('已选队伍数不能超过最大队伍数');
  if (database.prepare('SELECT 1 FROM tournament_events WHERE lower(name) = lower(?)').get(event.name)) {
    throw new Error('已存在同名赛事');
  }
  const id = `tournament-${crypto.randomUUID()}`;
  const now = Date.now();
  const validTeams = validateEventTeams(database, event.teamIds, event.division, event.minTeamMembers, event.maxTeamMembers);
  withTransaction(database, () => {
    database.prepare(`INSERT INTO tournament_events
      (id, name, division, stage, mode, format, priority, description, max_teams, event_type, require_real_name, visibility,
       registration_method, team_requirement, start_date, end_date, registration_start,
       registration_end, min_team_members, max_team_members, require_system_login,
       organizer_type, organizer_name, contact, handbook_url, contact_group, contact_group_url,
       rules_text, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, '筹备阶段', '标准对局', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`).run(
      id, event.name, event.division, event.format, event.priority, event.description, event.maxTeams,
      event.eventType, Number(event.requireRealName), event.visibility, event.registrationMethod,
      event.teamRequirement, event.startDate, event.endDate, event.registrationStart, event.registrationEnd,
      event.minTeamMembers, event.maxTeamMembers, Number(event.requireSystemLogin), event.organizerType,
      event.organizerName, event.contact, event.handbookUrl, event.contactGroup, event.contactGroupUrl,
      event.rulesText, actorUserId || null, now, now
    );
    writeMedia(database, id, 'logo', Boolean(source.logoChanged), source.logo, now);
    writeMedia(database, id, 'cover', Boolean(source.coverChanged), source.cover, now);
    writeMedia(database, id, 'group_qr', Boolean(source.groupQrChanged), source.groupQr, now);
    const insertTeam = database.prepare('INSERT INTO tournament_event_teams (tournament_event_id, team_id, created_at) VALUES (?, ?, ?)');
    validTeams.forEach(teamId => insertTeam.run(id, teamId, now));
  });
  return readManagedEvent(database, id);
}

function updateManagedEvent(database = defaultDb, eventId, source, actorUserId = null) {
  const current = database.prepare('SELECT id, priority FROM tournament_events WHERE id = ?').get(eventId);
  if (!current) throw new Error('赛事不存在');
  const currentTeamIds = database.prepare(`SELECT team_id FROM tournament_event_teams
    WHERE tournament_event_id = ? ORDER BY team_id`).all(eventId).map(row => row.team_id);
  const event = normalizeEventInput({
    ...source,
    teamIds: Array.isArray(source.teamIds) ? source.teamIds : currentTeamIds
  });
  if (event.teamIds.length < 2) throw new Error('正式赛事至少需要选择两支参赛队伍');
  if (event.teamIds.length > event.maxTeams) throw new Error('已选队伍数不能超过最大队伍数');
  if (database.prepare('SELECT 1 FROM tournament_events WHERE lower(name) = lower(?) AND id <> ?').get(event.name, eventId)) {
    throw new Error('已存在同名赛事');
  }
  const now = Date.now();
  const validTeams = validateEventTeams(database, event.teamIds, event.division, event.minTeamMembers, event.maxTeamMembers);
  withTransaction(database, () => {
    database.prepare(`UPDATE tournament_events SET
      name = ?, division = ?, format = ?, priority = ?, description = ?, max_teams = ?, event_type = ?,
      require_real_name = ?, visibility = ?, registration_method = ?, team_requirement = ?,
      start_date = ?, end_date = ?, registration_start = ?, registration_end = ?, min_team_members = ?,
      max_team_members = ?, require_system_login = ?, organizer_type = ?, organizer_name = ?, contact = ?,
      handbook_url = ?, contact_group = ?, contact_group_url = ?, rules_text = ?, updated_at = ? WHERE id = ?`).run(
      event.name, event.division, event.format, source.priority === undefined ? current.priority : event.priority,
      event.description, event.maxTeams, event.eventType, Number(event.requireRealName), event.visibility,
      event.registrationMethod, event.teamRequirement, event.startDate, event.endDate,
      event.registrationStart, event.registrationEnd, event.minTeamMembers, event.maxTeamMembers,
      Number(event.requireSystemLogin), event.organizerType, event.organizerName, event.contact,
      event.handbookUrl, event.contactGroup, event.contactGroupUrl, event.rulesText, now, eventId
    );
    writeMedia(database, eventId, 'logo', Boolean(source.logoChanged), source.logo, now);
    writeMedia(database, eventId, 'cover', Boolean(source.coverChanged), source.cover, now);
    writeMedia(database, eventId, 'group_qr', Boolean(source.groupQrChanged), source.groupQr, now);
    if (Array.isArray(source.teamIds)) {
      database.prepare('DELETE FROM tournament_event_teams WHERE tournament_event_id = ?').run(eventId);
      const insertTeam = database.prepare('INSERT INTO tournament_event_teams (tournament_event_id, team_id, created_at) VALUES (?, ?, ?)');
      validTeams.forEach(teamId => insertTeam.run(eventId, teamId, now));
    }
  });
  return readManagedEvent(database, eventId);
}

function eventRows(database) {
  return database.prepare(`SELECT e.*,
      logo.sha256 AS logo_sha256, cover.sha256 AS cover_sha256, qr.sha256 AS group_qr_sha256,
      COUNT(DISTINCT selected_team.team_id) AS team_count,
      COUNT(DISTINCT link.match_id) AS match_count,
      COUNT(DISTINCT CASE WHEN match.winner_team_id IS NOT NULL THEN link.match_id END) AS completed_match_count
    FROM tournament_events AS e
    LEFT JOIN tournament_event_media AS logo ON logo.tournament_event_id = e.id AND logo.kind = 'logo'
    LEFT JOIN tournament_event_media AS cover ON cover.tournament_event_id = e.id AND cover.kind = 'cover'
    LEFT JOIN tournament_event_media AS qr ON qr.tournament_event_id = e.id AND qr.kind = 'group_qr'
    LEFT JOIN tournament_schedule_links AS link ON link.tournament_event_id = e.id
    LEFT JOIN tournament_event_teams AS selected_team ON selected_team.tournament_event_id = e.id
    LEFT JOIN matches AS match ON match.id = link.match_id
    GROUP BY e.id
    ORDER BY e.marked DESC, e.priority DESC, COALESCE(e.started_at, e.created_at) DESC`).all();
}

// 批量预取各赛事的下一场比赛与参赛队伍，替代逐赛事两条查询
function prepareEventContext(database, eventIds, today) {
  const nextMatches = new Map();
  const teamLists = new Map();
  if (!eventIds.length) return { nextMatches, teamLists };
  const placeholders = eventIds.map(() => '?').join(',');
  for (const row of database.prepare(`SELECT tournament_event_id, id, date, start_time, matchup_home, matchup_away FROM (
      SELECT link.tournament_event_id, m.id, m.date, m.start_time, m.matchup_home, m.matchup_away,
        ROW_NUMBER() OVER (PARTITION BY link.tournament_event_id
          ORDER BY COALESCE(m.date, '9999-12-31'), COALESCE(m.start_time, '99:99'), m.sort_order) AS rn
      FROM matches m
      JOIN tournament_schedule_links link ON link.match_id = m.id
      WHERE link.tournament_event_id IN (${placeholders}) AND m.winner_team_id IS NULL
        AND (m.date IS NULL OR m.date >= ?)
    ) WHERE rn = 1`).all(...eventIds, today)) {
    nextMatches.set(row.tournament_event_id, row);
  }
  for (const row of database.prepare(`SELECT et.tournament_event_id, t.id, t.display_name AS name
    FROM tournament_event_teams et JOIN teams t ON t.id = et.team_id
    WHERE et.tournament_event_id IN (${placeholders}) ORDER BY et.tournament_event_id, t.display_name`).all(...eventIds)) {
    if (!teamLists.has(row.tournament_event_id)) teamLists.set(row.tournament_event_id, []);
    teamLists.get(row.tournament_event_id).push({ id: row.id, name: row.name });
  }
  return { nextMatches, teamLists };
}

function serializeRow(database, row, today, context = null) {
  const prepared = context || prepareEventContext(database, [row.id], today);
  const next = prepared.nextMatches.get(row.id) || null;
  const teams = prepared.teamLists.get(row.id) || [];
  return {
    id: row.id,
    name: row.name,
    division: row.division,
    stage: row.stage || '筹备阶段',
    mode: row.mode || '标准对局',
    format: row.format || '赛制待定',
    description: row.description || '',
    maxTeams: row.max_teams || null,
    eventType: row.event_type || 'private',
    requireRealName: Boolean(row.require_real_name),
    visibility: row.visibility || 'system',
    registrationMethod: row.registration_method || 'invite',
    teamRequirement: row.team_requirement || 'any',
    priority: Number(row.priority || 0),
    startDate: row.start_date || null,
    endDate: row.end_date || null,
    registrationStart: row.registration_start || null,
    registrationEnd: row.registration_end || null,
    minTeamMembers: row.min_team_members || null,
    maxTeamMembers: row.max_team_members || null,
    requireSystemLogin: row.require_system_login === null ? true : Boolean(row.require_system_login),
    organizerType: row.organizer_type || 'personal',
    organizerName: row.organizer_name || '主办方待补充',
    contact: row.contact || '',
    rulesText: row.rules_text || '',
    status: row.status === 'draft' ? 'upcoming' : row.status,
    marked: Boolean(row.marked),
    teamCount: Number(row.team_count || 0),
    teamIds: teams.map(team => team.id),
    teams,
    handbookUrl: row.handbook_url || '',
    contactGroup: row.contact_group || '',
    contactGroupUrl: row.contact_group_url || '',
    groupQrUrl: row.group_qr_sha256 ? `/api/events/${encodeURIComponent(row.id)}/media/group_qr?v=${row.group_qr_sha256.slice(0, 12)}` : null,
    matchCount: Number(row.match_count || 0),
    completedMatchCount: Number(row.completed_match_count || 0),
    logoUrl: row.logo_sha256 ? `/api/events/${encodeURIComponent(row.id)}/media/logo?v=${row.logo_sha256.slice(0, 12)}` : null,
    coverUrl: row.cover_sha256 ? `/api/events/${encodeURIComponent(row.id)}/media/cover?v=${row.cover_sha256.slice(0, 12)}` : null,
    nextMatch: next ? {
      id: next.id,
      date: next.date,
      startTime: next.start_time,
      matchup: `${next.matchup_home || '待定'} vs ${next.matchup_away || '待定'}`
    } : null,
    updatedAt: row.updated_at || null
  };
}

function managedEventSnapshot(database = defaultDb, filter = 'all', today = new Date().toISOString().slice(0, 10)) {
  if (!['all', 'live', 'upcoming', 'completed'].includes(filter)) throw new Error('赛事筛选条件无效');
  const rows = eventRows(database);
  const context = prepareEventContext(database, rows.map(row => row.id), today);
  const allItems = rows.map(row => serializeRow(database, row, today, context));
  return {
    filter,
    counts: {
      all: allItems.length,
      live: allItems.filter(item => item.status === 'live').length,
      upcoming: allItems.filter(item => item.status === 'upcoming').length,
      completed: allItems.filter(item => item.status === 'completed').length
    },
    items: filter === 'all' ? allItems : allItems.filter(item => item.status === filter)
  };
}

function readManagedEvent(database = defaultDb, eventId, today = new Date().toISOString().slice(0, 10)) {
  const row = eventRows(database).find(item => item.id === eventId);
  if (!row) throw new Error('赛事不存在');
  return serializeRow(database, row, today);
}

function applyEventAction(database = defaultDb, eventId, action) {
  const current = database.prepare('SELECT id, status, marked FROM tournament_events WHERE id = ?').get(eventId);
  if (!current) throw new Error('赛事不存在');
  const now = Date.now();
  if (action === 'start') {
    if (current.status !== 'draft') throw new Error('只有未开始的赛事可以启动');
    database.prepare(`UPDATE tournament_events SET status = 'live', started_at = ?, ended_at = NULL, updated_at = ?
      WHERE id = ?`).run(now, now, eventId);
  } else if (action === 'end') {
    if (current.status !== 'live') throw new Error('只有进行中的赛事可以结束');
    database.prepare(`UPDATE tournament_events SET status = 'completed', ended_at = ?, updated_at = ?
      WHERE id = ?`).run(now, now, eventId);
  } else if (action === 'toggle-mark') {
    database.prepare(`UPDATE tournament_events SET marked = CASE marked WHEN 1 THEN 0 ELSE 1 END,
      updated_at = ? WHERE id = ?`).run(now, eventId);
  } else {
    throw new Error('未知赛事操作');
  }
  return readManagedEvent(database, eventId);
}

function readEventMedia(database = defaultDb, eventId, kind) {
  if (!['logo', 'cover', 'group_qr'].includes(kind)) throw new Error('赛事媒体类型无效');
  return database.prepare(`SELECT mime_type, data, byte_size, sha256, file_path FROM tournament_event_media
    WHERE tournament_event_id = ? AND kind = ?`).get(eventId, kind) || null;
}

function resolveScheduleEvent(database = defaultDb, requestedEventId = '') {
  const eventId = String(requestedEventId || '').trim();
  const row = eventId
    ? database.prepare(`SELECT id, name, division, stage, format, priority, status
        FROM tournament_events WHERE id = ?`).get(eventId)
    : database.prepare(`SELECT id, name, division, stage, format, priority, status
        FROM tournament_events WHERE status = 'live'
        ORDER BY priority DESC, started_at DESC, created_at DESC LIMIT 1`).get();
  if (!row) {
    const error = new Error(eventId ? '指定赛事不存在' : '当前没有正在进行的赛事，赛程管理暂不可访问');
    error.code = eventId ? 'TOURNAMENT_EVENT_NOT_FOUND' : 'NO_ACTIVE_TOURNAMENT_EVENT';
    throw error;
  }
  if (row.status !== 'live' && row.status !== 'completed') {
    const error = new Error('赛事启动后才可以进入赛程管理');
    error.code = 'TOURNAMENT_EVENT_NOT_ACTIVE';
    throw error;
  }
  return {
    id: row.id,
    name: row.name,
    division: row.division,
    stage: row.stage,
    format: row.format,
    priority: Number(row.priority || 0),
    status: row.status
  };
}

function linkScheduleMatch(database = defaultDb, eventId, matchId, actorUserId = null) {
  resolveScheduleEvent(database, eventId);
  if (!database.prepare('SELECT 1 FROM matches WHERE id = ?').get(matchId)) throw new Error('赛程不存在');
  database.prepare(`INSERT INTO tournament_schedule_links
    (tournament_event_id, match_id, created_by, created_at) VALUES (?, ?, ?, ?)`)
    .run(eventId, matchId, actorUserId || null, Date.now());
}

function normalizeStageInput(source = {}) {
  const stage = {
    name: text(source.name, '阶段名称', 80, true),
    format: enumValue(source.format, STAGE_FORMATS, '赛制', 'BO3'),
    division: source.division ? enumValue(source.division, new Set(['pc', 'mobile']), '赛区', null) : null,
    startAt: String(source.startAt || '').trim(),
    endAt: String(source.endAt || '').trim(),
    matchDayMode: enumValue(source.matchDayMode, new Set(['date', 'weekday']), '比赛日模式', 'date'),
    matchDate: dateValue(source.matchDate, '比赛日期'),
    weekdays: Array.isArray(source.weekdays) ? source.weekdays.map(value => String(value)) : []
  };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(stage.startAt)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(stage.endAt)) {
    throw new Error('阶段开始时间与结束时间格式无效');
  }
  if (stage.endAt < stage.startAt) throw new Error('阶段结束时间不能早于开始时间');
  if (stage.matchDayMode === 'date' && !stage.matchDate) throw new Error('请选择比赛日期');
  if (stage.matchDayMode === 'weekday' && (!stage.weekdays.length || stage.weekdays.some(day => !WEEKDAYS.has(day)))) {
    throw new Error('请选择至少一个比赛日');
  }
  if (stage.matchDayMode === 'date') stage.weekdays = [];
  stage.weekdays = [...new Set(stage.weekdays)].sort();
  return stage;
}

function listStageTeams(database, stageId) {
  return database.prepare(`SELECT t.id, t.display_name AS name, t.division,
      tel.web_file AS logo
    FROM tournament_stage_teams st JOIN teams t ON t.id = st.team_id
    LEFT JOIN team_logos tel ON tel.team_id = t.id AND tel.kind = 'escape'
    WHERE st.stage_id = ? ORDER BY st.created_at, st.team_id`).all(stageId).map(team => ({
    id: team.id,
    name: team.name,
    division: team.division || null,
    logo: team.logo || null
  }));
}

function listTournamentStages(database = defaultDb, eventId) {
  resolveScheduleEvent(database, eventId);
  return database.prepare(`SELECT id, tournament_event_id, name, format, division, status, start_at, end_at,
      match_day_mode, match_date, weekdays_json, created_at, updated_at
    FROM tournament_stages WHERE tournament_event_id = ? ORDER BY start_at, created_at`).all(eventId).map(row => ({
    id: row.id,
    eventId: row.tournament_event_id,
    name: row.name,
    format: row.format,
    division: row.division || null,
    status: row.status || 'draft',
    startAt: row.start_at,
    endAt: row.end_at,
    matchDayMode: row.match_day_mode,
    matchDate: row.match_date,
    weekdays: JSON.parse(row.weekdays_json || '[]'),
    teams: listStageTeams(database, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function createTournamentStage(database = defaultDb, eventId, source, actorUserId = null) {
  resolveScheduleEvent(database, eventId);
  const stage = normalizeStageInput(source);
  const id = `stage-${crypto.randomUUID()}`;
  const now = Date.now();
  const teamIds = [...new Set((Array.isArray(source.teamIds) ? source.teamIds : []).map(value => String(value).trim()).filter(Boolean))];
  if (teamIds.length < 2) throw new Error('阶段至少需要选择两支参赛队伍');
  const placeholders = teamIds.map(() => '?').join(',');
  const valid = database.prepare(`SELECT id FROM teams WHERE id IN (${placeholders})`).all(...teamIds).map(row => row.id);
  if (valid.length !== teamIds.length) throw new Error('参赛队伍中包含不存在的系统队伍');
  withTransaction(database, () => {
    database.prepare(`INSERT INTO tournament_stages
      (id, tournament_event_id, name, format, division, start_at, end_at, match_day_mode, match_date,
       weekdays_json, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, eventId, stage.name, stage.format, stage.division, stage.startAt, stage.endAt, stage.matchDayMode,
      stage.matchDate, JSON.stringify(stage.weekdays), actorUserId || null, now, now
    );
    const insert = database.prepare('INSERT INTO tournament_stage_teams (stage_id, team_id, created_at) VALUES (?, ?, ?)');
    valid.forEach(teamId => insert.run(id, teamId, now));
  });
  return listTournamentStages(database, eventId).find(item => item.id === id);
}

module.exports = {
  normalizeEventInput,
  createManagedEvent,
  updateManagedEvent,
  managedEventSnapshot,
  readManagedEvent,
  applyEventAction,
  readEventMedia,
  resolveScheduleEvent,
  linkScheduleMatch,
  normalizeStageInput,
  listTournamentStages,
  createTournamentStage
  ,findEventTeamCandidates
};
