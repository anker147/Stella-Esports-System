const crypto = require('node:crypto');
const { db: defaultDb } = require('./db');

const DIVISIONS = new Set(['pc', 'mobile', 'all']);
const VISIBILITIES = new Set(['system', 'participants', 'invite_only']);
const REGISTRATION_METHODS = new Set(['invite', 'manual', 'closed']);
const TEAM_REQUIREMENTS = new Set(['any', 'club', 'organization']);
const ORGANIZER_TYPES = new Set(['personal', 'organization']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function text(value, label, maximum, required = false) {
  const result = String(value || '').trim();
  if (required && !result) throw new Error(`${label}不能为空`);
  if (result.length > maximum) throw new Error(`${label}不能超过 ${maximum} 个字符`);
  return result;
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
    startDate: dateValue(source.startDate, '赛事开始日期', true),
    endDate: dateValue(source.endDate, '赛事结束日期', true),
    registrationStart: dateValue(source.registrationStart, '报名开始日期'),
    registrationEnd: dateValue(source.registrationEnd, '报名结束日期'),
    minTeamMembers: integerValue(source.minTeamMembers, '最少队伍人数', 1, 99, true),
    maxTeamMembers: integerValue(source.maxTeamMembers, '最多队伍人数', 1, 99, true),
    requireSystemLogin: Boolean(source.requireSystemLogin),
    organizerType: enumValue(source.organizerType, ORGANIZER_TYPES, '主办方类型', 'personal'),
    organizerName: text(source.organizerName, '主办方', 100, true),
    contact: text(source.contact, '联系方式', 160, true),
    rulesText: text(source.rulesText, '赛事规则', 12000, true)
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
  database.prepare('DELETE FROM event_media WHERE event_id = ? AND kind = ?').run(eventId, kind);
  const image = decodeImage(value, kind === 'logo' ? '赛事 LOGO' : '赛事主图');
  if (!image) return;
  database.prepare(`INSERT INTO event_media
    (event_id, kind, mime_type, data, byte_size, sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    eventId, kind, image.mimeType, image.data, image.byteSize, image.sha256, now, now
  );
}

function profileValues(event, actorUserId, now) {
  return [event.description, event.maxTeams, event.eventType, Number(event.requireRealName), event.visibility,
    event.registrationMethod, event.teamRequirement, event.startDate, event.endDate,
    event.registrationStart, event.registrationEnd, event.minTeamMembers, event.maxTeamMembers,
    Number(event.requireSystemLogin), event.organizerType, event.organizerName, event.contact,
    event.rulesText, actorUserId || null, now, now];
}

function createManagedEvent(database = defaultDb, source, actorUserId = null) {
  const event = normalizeEventInput(source);
  if (database.prepare('SELECT 1 FROM events WHERE lower(name) = lower(?)').get(event.name)) {
    throw new Error('已存在同名赛事');
  }
  const id = `event-${crypto.randomUUID()}`;
  const now = Date.now();
  withTransaction(database, () => {
    const sortOrder = Number(database.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM events').get().value);
    database.prepare(`INSERT INTO events
      (id, name, division, stage, stage_label, date, mode, format, sort_order)
      VALUES (?, ?, ?, 'registration', '筹备阶段', ?, '标准对局', ?, ?)`).run(
      id, event.name, event.division, event.startDate, event.format, sortOrder
    );
    database.prepare(`INSERT INTO event_management_profiles
      (event_id, description, max_teams, event_type, require_real_name, visibility,
       registration_method, team_requirement, start_date, end_date, registration_start,
       registration_end, min_team_members, max_team_members, require_system_login,
       organizer_type, organizer_name, contact, rules_text, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, ...profileValues(event, actorUserId, now)
    );
    writeMedia(database, id, 'logo', Boolean(source.logoChanged), source.logo, now);
    writeMedia(database, id, 'cover', Boolean(source.coverChanged), source.cover, now);
  });
  return readManagedEvent(database, id);
}

function updateManagedEvent(database = defaultDb, eventId, source, actorUserId = null) {
  const current = database.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (!current) throw new Error('赛事不存在');
  const event = normalizeEventInput(source);
  if (database.prepare('SELECT 1 FROM events WHERE lower(name) = lower(?) AND id <> ?').get(event.name, eventId)) {
    throw new Error('已存在同名赛事');
  }
  const now = Date.now();
  withTransaction(database, () => {
    database.prepare(`UPDATE events SET name = ?, division = ?, date = ?, format = ? WHERE id = ?`).run(
      event.name, event.division, event.startDate, event.format, eventId
    );
    database.prepare(`INSERT INTO event_management_profiles
      (event_id, description, max_teams, event_type, require_real_name, visibility,
       registration_method, team_requirement, start_date, end_date, registration_start,
       registration_end, min_team_members, max_team_members, require_system_login,
       organizer_type, organizer_name, contact, rules_text, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
       description = excluded.description, max_teams = excluded.max_teams,
       event_type = excluded.event_type, require_real_name = excluded.require_real_name,
       visibility = excluded.visibility, registration_method = excluded.registration_method,
       team_requirement = excluded.team_requirement, start_date = excluded.start_date,
       end_date = excluded.end_date, registration_start = excluded.registration_start,
       registration_end = excluded.registration_end, min_team_members = excluded.min_team_members,
       max_team_members = excluded.max_team_members, require_system_login = excluded.require_system_login,
       organizer_type = excluded.organizer_type, organizer_name = excluded.organizer_name,
       contact = excluded.contact, rules_text = excluded.rules_text, updated_at = excluded.updated_at`).run(
      eventId, ...profileValues(event, actorUserId, now)
    );
    writeMedia(database, eventId, 'logo', Boolean(source.logoChanged), source.logo, now);
    writeMedia(database, eventId, 'cover', Boolean(source.coverChanged), source.cover, now);
  });
  return readManagedEvent(database, eventId);
}

function statusFor(row, today) {
  if (row.manual_status) return row.manual_status;
  if (Number(row.match_count) > 0 && Number(row.completed_match_count) >= Number(row.match_count)) return 'completed';
  const start = row.start_date || row.first_match_date || row.date;
  const end = row.end_date || row.last_match_date || row.date;
  if (end && end < today) return 'completed';
  if (start && start <= today && (!end || end >= today)) return 'live';
  return 'upcoming';
}

function eventRows(database) {
  return database.prepare(`SELECT e.id, e.name, e.division, e.stage, e.stage_label, e.date, e.mode, e.format,
      profile.description, profile.max_teams, profile.event_type, profile.require_real_name,
      profile.visibility, profile.registration_method, profile.team_requirement,
      profile.start_date, profile.end_date, profile.registration_start, profile.registration_end,
      profile.min_team_members, profile.max_team_members, profile.require_system_login,
      profile.organizer_type, profile.organizer_name, profile.contact, profile.rules_text,
      profile.manual_status, profile.marked, profile.updated_at,
      logo.sha256 AS logo_sha256, cover.sha256 AS cover_sha256,
      COUNT(DISTINCT event_team.team_id) AS team_count,
      COUNT(DISTINCT match.id) AS match_count,
      COUNT(DISTINCT CASE WHEN match.winner_team_id IS NOT NULL THEN match.id END) AS completed_match_count,
      MIN(match.date) AS first_match_date, MAX(match.date) AS last_match_date
    FROM events AS e
    LEFT JOIN event_management_profiles AS profile ON profile.event_id = e.id
    LEFT JOIN event_media AS logo ON logo.event_id = e.id AND logo.kind = 'logo'
    LEFT JOIN event_media AS cover ON cover.event_id = e.id AND cover.kind = 'cover'
    LEFT JOIN event_teams AS event_team ON event_team.event_id = e.id
    LEFT JOIN matches AS match ON match.event_id = e.id
    GROUP BY e.id
    ORDER BY COALESCE(profile.marked, 0) DESC, COALESCE(profile.start_date, e.date, '9999-12-31') DESC, e.sort_order`).all();
}

function nextMatch(database, eventId, today) {
  return database.prepare(`SELECT id, date, start_time, matchup_home, matchup_away FROM matches
    WHERE event_id = ? AND winner_team_id IS NULL AND (date IS NULL OR date >= ?)
    ORDER BY COALESCE(date, '9999-12-31'), COALESCE(start_time, '99:99'), sort_order LIMIT 1`).get(eventId, today);
}

function serializeRow(database, row, today) {
  const next = nextMatch(database, row.id, today);
  return {
    id: row.id,
    name: row.name,
    division: row.division,
    stage: row.stage_label || row.stage || '筹备阶段',
    mode: row.mode || '标准对局',
    format: row.format || '赛制待定',
    description: row.description || '',
    maxTeams: row.max_teams || null,
    eventType: row.event_type || 'private',
    requireRealName: Boolean(row.require_real_name),
    visibility: row.visibility || 'system',
    registrationMethod: row.registration_method || 'invite',
    teamRequirement: row.team_requirement || 'any',
    startDate: row.start_date || row.first_match_date || row.date || null,
    endDate: row.end_date || row.last_match_date || row.date || null,
    registrationStart: row.registration_start || null,
    registrationEnd: row.registration_end || null,
    minTeamMembers: row.min_team_members || null,
    maxTeamMembers: row.max_team_members || null,
    requireSystemLogin: row.require_system_login === null ? true : Boolean(row.require_system_login),
    organizerType: row.organizer_type || 'personal',
    organizerName: row.organizer_name || '主办方待补充',
    contact: row.contact || '',
    rulesText: row.rules_text || '',
    status: statusFor(row, today),
    marked: Boolean(row.marked),
    teamCount: Number(row.team_count || 0),
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
  if (!['all', 'live', 'completed'].includes(filter)) throw new Error('赛事筛选条件无效');
  const allItems = eventRows(database).map(row => serializeRow(database, row, today));
  return {
    filter,
    counts: {
      all: allItems.length,
      live: allItems.filter(item => item.status === 'live').length,
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
  const current = database.prepare('SELECT event_id, manual_status, marked FROM event_management_profiles WHERE event_id = ?').get(eventId);
  if (!database.prepare('SELECT 1 FROM events WHERE id = ?').get(eventId)) throw new Error('赛事不存在');
  const now = Date.now();
  if (!current) {
    database.prepare(`INSERT INTO event_management_profiles (event_id, created_at, updated_at)
      VALUES (?, ?, ?)`).run(eventId, now, now);
  }
  if (action === 'start') {
    database.prepare(`UPDATE event_management_profiles SET manual_status = 'live', updated_at = ? WHERE event_id = ?`).run(now, eventId);
  } else if (action === 'end') {
    database.prepare(`UPDATE event_management_profiles SET manual_status = 'completed', updated_at = ? WHERE event_id = ?`).run(now, eventId);
  } else if (action === 'toggle-mark') {
    database.prepare(`UPDATE event_management_profiles SET marked = CASE marked WHEN 1 THEN 0 ELSE 1 END,
      updated_at = ? WHERE event_id = ?`).run(now, eventId);
  } else {
    throw new Error('未知赛事操作');
  }
  return readManagedEvent(database, eventId);
}

function readEventMedia(database = defaultDb, eventId, kind) {
  if (!['logo', 'cover'].includes(kind)) throw new Error('赛事媒体类型无效');
  return database.prepare(`SELECT mime_type, data, byte_size, sha256 FROM event_media
    WHERE event_id = ? AND kind = ?`).get(eventId, kind) || null;
}

module.exports = {
  normalizeEventInput,
  createManagedEvent,
  updateManagedEvent,
  managedEventSnapshot,
  readManagedEvent,
  applyEventAction,
  readEventMedia
};
