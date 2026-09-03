const crypto = require('node:crypto');
const { db: defaultDb } = require('./db');

const FORMULA = Object.freeze({
  usageWeight: 0.4,
  banWeight: 0.25,
  winWeight: 0.35,
  priorGames: 2
});

const ROLE_KEYS = ['escape', 'hunter'];

function cleanText(value, label, maximum, required = false) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`${label}不能为空`);
  if (text.length > maximum) throw new Error(`${label}不能超过 ${maximum} 个字符`);
  return text || null;
}

function normalizeCharacterInput(input, creating = false) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const id = cleanText(source.id, '角色 ID', 64, true);
  if (!ROLE_KEYS.includes(source.role)) throw new Error('角色阵营无效');
  const skills = Array.isArray(source.skills) ? source.skills : [];
  if (skills.length > 3) throw new Error('角色技能最多只能设置三个');
  const changesToAdd = Array.isArray(source.changesToAdd) ? source.changesToAdd : [];
  if (changesToAdd.length > 12) throw new Error('单次最多新增 12 条角色修改记录');
  return {
    id,
    role: source.role,
    nickname: cleanText(source.nickname ?? id, '角色昵称', 80, true),
    displayName: cleanText(source.displayName, '角色姓名', 80, true),
    releaseDate: cleanText(source.releaseDate, '上线日期', 40),
    portraitUrl: cleanText(source.portraitUrl, '头像地址', 500),
    portraitChanged: source.portraitChanged === true,
    portrait: source.portraitChanged === true ? normalizePortrait(source.portrait) : undefined,
    skills: Array.from({ length: 3 }, (_, index) => {
      const skill = skills[index] && typeof skills[index] === 'object' ? skills[index] : {};
      return {
        slot: index + 1,
        name: cleanText(skill.name, `技能 ${index + 1} 名称`, 80),
        description: cleanText(skill.description, `技能 ${index + 1} 描述`, 2000),
        iconChanged: skill.iconChanged === true,
        icon: skill.iconChanged === true
          ? normalizeImage(skill.icon, `技能 ${index + 1} 图标`, 512 * 1024)
          : undefined
      };
    }),
    changesToAdd: changesToAdd.map((change, index) => {
      const record = change && typeof change === 'object' && !Array.isArray(change) ? change : {};
      const changedOn = cleanText(record.date, `修改记录 ${index + 1} 日期`, 10, true);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(changedOn)) throw new Error(`修改记录 ${index + 1} 日期格式无效`);
      return {
        date: changedOn,
        title: cleanText(record.title, `修改记录 ${index + 1} 标题`, 120, true),
        content: cleanText(record.content, `修改记录 ${index + 1} 详情`, 4000, true)
      };
    }),
    creating
  };
}

function normalizeImage(value, label, maximumBytes) {
  if (value === null || value === '') return null;
  const source = String(value || '');
  const match = source.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error(`${label}仅支持 PNG、JPG 或 WebP 图片`);
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > maximumBytes) {
    const maximumLabel = maximumBytes >= 1024 * 1024
      ? `${maximumBytes / 1024 / 1024}MB`
      : `${maximumBytes / 1024}KB`;
    throw new Error(`${label}不能超过 ${maximumLabel}`);
  }
  const signatures = {
    'image/png': data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/jpeg': data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255,
    'image/webp': data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF'
      && data.subarray(8, 12).toString('ascii') === 'WEBP'
  };
  if (!signatures[match[1]]) throw new Error(`${label}内容与图片类型不匹配`);
  return {
    mimeType: match[1],
    data,
    byteSize: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex')
  };
}

function normalizePortrait(value) {
  return normalizeImage(value, '角色头像', 2 * 1024 * 1024);
}

function generatedCharacterId(database) {
  let id;
  do {
    id = `character-${crypto.randomUUID()}`;
  } while (database.prepare('SELECT 1 FROM characters WHERE id = ?').get(id));
  return id;
}

function baseCharacter(database, id) {
  const row = database.prepare(`SELECT id, role, sort_order, enabled, nickname, display_name,
    release_date_text, portrait_url FROM characters WHERE id = ?`).get(id);
  if (!row) return null;
  const portrait = database.prepare(`SELECT mime_type, byte_size, sha256, updated_at
    FROM character_portraits WHERE character_id = ?`).get(id);
  return {
    id: row.id,
    role: row.role,
    sortOrder: row.sort_order,
    enabled: Boolean(row.enabled),
    nickname: row.nickname || row.id,
    displayName: row.display_name || row.id,
    releaseDate: row.release_date_text || '',
    portraitUrl: row.portrait_url || '',
    imageUrl: portrait
      ? `/api/characters/${encodeURIComponent(row.id)}/portrait?v=${portrait.updated_at}`
      : (row.portrait_url || `/assets/characters/ban/${encodeURIComponent(row.id)}.png?v=2`),
    hasCustomPortrait: Boolean(portrait),
    skills: database.prepare(`SELECT skill.slot, skill.name, skill.description, skill.icon_url,
        icon.updated_at AS icon_updated_at
      FROM character_skills skill
      LEFT JOIN character_skill_icons icon
        ON icon.character_id = skill.character_id AND icon.slot = skill.slot
      WHERE skill.character_id = ? ORDER BY skill.slot`).all(id).map(skill => ({
      slot: skill.slot,
      name: skill.name || '',
      description: skill.description || '',
      iconUrl: skill.icon_updated_at
        ? `/api/characters/${encodeURIComponent(row.id)}/skills/${skill.slot}/icon?v=${skill.icon_updated_at}`
        : (skill.icon_url || ''),
      hasCustomIcon: Boolean(skill.icon_updated_at)
    }))
  };
}

function writePortrait(database, character) {
  if (!character.portraitChanged) return;
  database.prepare('UPDATE characters SET portrait_url = NULL WHERE id = ?').run(character.id);
  if (!character.portrait) {
    database.prepare('DELETE FROM character_portraits WHERE character_id = ?').run(character.id);
    return;
  }
  const now = Date.now();
  database.prepare(`INSERT INTO character_portraits
    (character_id, mime_type, data, byte_size, sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (character_id) DO UPDATE SET mime_type = excluded.mime_type,
      data = excluded.data, byte_size = excluded.byte_size, sha256 = excluded.sha256,
      updated_at = excluded.updated_at`).run(
    character.id, character.portrait.mimeType, character.portrait.data,
    character.portrait.byteSize, character.portrait.sha256, now, now
  );
}

function writeSkills(database, character) {
  const upsert = database.prepare(`INSERT INTO character_skills
    (character_id, slot, name, description, icon_url) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (character_id, slot) DO UPDATE SET name = excluded.name,
      description = excluded.description, icon_url = excluded.icon_url`);
  const remove = database.prepare('DELETE FROM character_skills WHERE character_id = ? AND slot = ?');
  for (const skill of character.skills) {
    const previous = database.prepare(`SELECT icon_url FROM character_skills
      WHERE character_id = ? AND slot = ?`).get(character.id, skill.slot);
    if (skill.iconChanged) {
      database.prepare('DELETE FROM character_skill_icons WHERE character_id = ? AND slot = ?')
        .run(character.id, skill.slot);
      if (skill.icon) {
        const now = Date.now();
        database.prepare(`INSERT INTO character_skill_icons
          (character_id, slot, mime_type, data, byte_size, sha256, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(character.id, skill.slot, skill.icon.mimeType, skill.icon.data,
            skill.icon.byteSize, skill.icon.sha256, now, now);
      }
    }
    const hasHostedIcon = Boolean(database.prepare(`SELECT 1 FROM character_skill_icons
      WHERE character_id = ? AND slot = ?`).get(character.id, skill.slot));
    const iconUrl = skill.iconChanged ? null : (previous?.icon_url || null);
    if (skill.name || skill.description || iconUrl || hasHostedIcon) {
      upsert.run(character.id, skill.slot, skill.name, skill.description, iconUrl);
    } else {
      remove.run(character.id, skill.slot);
    }
  }
}

function writeChangeRecords(database, character) {
  if (!character.changesToAdd.length) return 0;
  const nextOrder = database.prepare(`SELECT COALESCE(MAX(source_order), -1) + 1 AS value
    FROM character_change_history WHERE character_id = ?`).get(character.id).value;
  const insert = database.prepare(`INSERT INTO character_change_history
    (character_id, changed_on, title, content, source_order) VALUES (?, ?, ?, ?, ?)`);
  character.changesToAdd.forEach((change, index) => {
    if (database.prepare(`SELECT 1 FROM character_change_history
      WHERE character_id = ? AND changed_on = ? AND title = ?`)
      .get(character.id, change.date, change.title)) {
      throw new Error(`修改记录“${change.date} ${change.title}”已存在`);
    }
    insert.run(character.id, change.date, change.title, change.content, nextOrder + index);
  });
  return character.changesToAdd.length;
}

function runTransaction(database, callback) {
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

function createCharacter(database, input) {
  const character = normalizeCharacterInput({ ...input, id: input?.id || generatedCharacterId(database) }, true);
  if (database.prepare('SELECT 1 FROM characters WHERE id = ?').get(character.id)) {
    throw new Error('角色 ID 已存在');
  }
  runTransaction(database, () => {
    const nextOrder = database.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM characters WHERE role = ?').get(character.role).value;
    database.prepare(`INSERT INTO characters
      (id, role, sort_order, enabled, nickname, display_name, release_date_text, portrait_url)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)`).run(
      character.id, character.role, nextOrder, character.nickname, character.displayName,
      character.releaseDate, character.portraitUrl
    );
    writeSkills(database, character);
    writePortrait(database, character);
    writeChangeRecords(database, character);
  });
  return baseCharacter(database, character.id);
}

function updateCharacter(database, id, input) {
  const characterId = cleanText(id, '角色 ID', 64, true);
  const previous = baseCharacter(database, characterId);
  if (!previous) throw new Error('角色不存在');
  const character = normalizeCharacterInput({
    ...input,
    id: characterId,
    nickname: input?.nickname ?? previous.nickname
  });
  const changesAdded = runTransaction(database, () => {
    let sortOrder = previous.sortOrder;
    if (character.role !== previous.role) {
      sortOrder = database.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM characters WHERE role = ?').get(character.role).value;
    }
    const portraitUrl = character.portraitChanged ? null : previous.portraitUrl;
    database.prepare(`UPDATE characters SET role = ?, sort_order = ?, nickname = ?, display_name = ?,
      release_date_text = ?, portrait_url = ? WHERE id = ?`).run(
      character.role, sortOrder, character.nickname, character.displayName,
      character.releaseDate, portraitUrl, characterId
    );
    writeSkills(database, character);
    writePortrait(database, character);
    return writeChangeRecords(database, character);
  });
  return { previous, character: baseCharacter(database, characterId), changesAdded };
}

function readCharacterPortrait(database, id) {
  const characterId = cleanText(id, '角色 ID', 64, true);
  return database.prepare(`SELECT mime_type, data, byte_size, sha256, updated_at
    FROM character_portraits WHERE character_id = ?`).get(characterId) || null;
}

function readCharacterSkillIcon(database, id, slot) {
  const characterId = cleanText(id, '角色 ID', 64, true);
  const skillSlot = Number(slot);
  if (!Number.isInteger(skillSlot) || skillSlot < 1 || skillSlot > 3) throw new Error('技能位置无效');
  return database.prepare(`SELECT mime_type, data, byte_size, sha256, updated_at
    FROM character_skill_icons WHERE character_id = ? AND slot = ?`)
    .get(characterId, skillSlot) || null;
}

function archiveCharacter(database, id) {
  const characterId = cleanText(id, '角色 ID', 64, true);
  const previous = baseCharacter(database, characterId);
  if (!previous) throw new Error('角色不存在');
  if (!previous.enabled) throw new Error('角色已停用');
  database.prepare('UPDATE characters SET enabled = 0 WHERE id = ?').run(characterId);
  return { ...previous, enabled: false };
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function resolvedMatchParticipants(database, matchId, cache = new Map(), resolving = new Set()) {
  if (cache.has(matchId)) return cache.get(matchId);
  if (resolving.has(matchId)) return [];
  resolving.add(matchId);
  const room = database.prepare(`SELECT escape_team_id, hunter_team_id FROM match_rooms
    WHERE match_id = ? AND room = 'A'`).get(matchId);
  let participants = room?.escape_team_id && room?.hunter_team_id
    ? [room.escape_team_id, room.hunter_team_id]
    : [];
  if (!participants.length) {
    const refs = database.prepare(`SELECT ref_type, team_id, from_match_id, outcome
      FROM match_participants WHERE match_id = ? ORDER BY slot`).all(matchId);
    const winnerFor = sourceMatchId => database.prepare(`SELECT r.winner_team_id
      FROM bp_sessions s
      INNER JOIN bp_session_results r ON r.session_id = s.id
      WHERE s.match_id = ?
      ORDER BY s.attempt DESC, r.decided_at DESC LIMIT 1`).get(sourceMatchId)?.winner_team_id
      || database.prepare('SELECT winner_team_id FROM matches WHERE id = ?').get(sourceMatchId)?.winner_team_id
      || null;
    participants = refs.map(ref => {
      if (ref.ref_type === 'team') return ref.team_id || null;
      const winner = winnerFor(ref.from_match_id);
      if (!winner) return null;
      if (ref.outcome === 'winner') return winner;
      return resolvedMatchParticipants(database, ref.from_match_id, cache, resolving)
        .find(teamId => teamId && teamId !== winner) || null;
    });
  }
  resolving.delete(matchId);
  cache.set(matchId, participants);
  return participants;
}

function enrichResolvedTeams(database, rows) {
  const participantCache = new Map();
  const teamCache = new Map();
  const teamFor = (teamId, role) => {
    if (!teamId) return null;
    const key = `${teamId}:${role}`;
    if (!teamCache.has(key)) {
      teamCache.set(key, database.prepare(`SELECT team.id, team.display_name,
        logo.web_file AS logo_url
        FROM teams team
        LEFT JOIN team_logos logo ON logo.team_id = team.id AND logo.kind = ?
        WHERE team.id = ?`).get(role, teamId) || null);
    }
    return teamCache.get(key);
  };
  for (const row of rows) {
    const participants = resolvedMatchParticipants(database, row.match_id, participantCache);
    if (participants.length < 2) continue;
    const roleIndex = row.room === 'B'
      ? (row.role === 'escape' ? 1 : 0)
      : (row.role === 'escape' ? 0 : 1);
    const roleTeam = teamFor(participants[roleIndex], row.role);
    const opponentTeam = teamFor(participants[roleIndex === 0 ? 1 : 0], row.role === 'escape' ? 'hunter' : 'escape');
    if (!row.team_id && roleTeam) {
      row.team_id = roleTeam.id;
      row.team_name = roleTeam.display_name;
      row.team_logo_url = roleTeam.logo_url;
    }
    if (!row.opponent_team_id && opponentTeam) {
      row.opponent_team_id = opponentTeam.id;
      row.opponent_team_name = opponentTeam.display_name;
    }
    if ((!row.matchup_home || !row.matchup_away || row.matchup_home === '待定' || row.matchup_away === '待定')) {
      const first = teamFor(participants[0], 'escape');
      const second = teamFor(participants[1], 'hunter');
      row.matchup_home = first?.display_name || row.matchup_home;
      row.matchup_away = second?.display_name || row.matchup_away;
    }
  }
  return rows;
}

function readEffectiveSlotRows(database, division) {
  const filters = ['COALESCE(m.exclude_from_character_stats, 0) = 0'];
  if (division !== 'all') filters.push('event.division = ?');
  const statement = database.prepare(`WITH ranked_sessions AS (
      SELECT s.id, s.match_id, s.game_number, s.room, s.attempt,
        r.winner_role, r.winner_team_id, r.decided_at,
        ROW_NUMBER() OVER (
          PARTITION BY s.match_id, s.game_number, s.room
          ORDER BY s.attempt DESC
        ) AS effective_rank
      FROM bp_sessions s
      INNER JOIN bp_session_results r ON r.session_id = s.id
    ), effective_sessions AS (
      SELECT id, match_id, game_number, room, attempt,
        winner_role, winner_team_id, decided_at
      FROM ranked_sessions
      WHERE effective_rank = 1
    )
    SELECT e.id AS session_id, e.match_id, e.game_number, e.room, e.attempt,
      e.winner_role, e.winner_team_id, e.decided_at,
      ss.character_id, ss.player_id, ss.player_text, slots.kind, slots.role,
      p.nickname AS player_nickname, p.official_id AS player_official_id,
      role_team.id AS team_id, role_team.display_name AS team_name,
      role_logo.web_file AS team_logo_url,
      opponent_team.id AS opponent_team_id, opponent_team.display_name AS opponent_team_name,
      m.date AS match_date, m.start_time, m.matchup_home, m.matchup_away,
      event.id AS event_id, event.name AS event_name,
      event.stage, event.stage_label
    FROM effective_sessions e
    LEFT JOIN bp_session_slots ss ON ss.session_id = e.id
    LEFT JOIN bp_slots slots ON slots.id = ss.slot_id
    LEFT JOIN players p ON p.player_id = ss.player_id
    LEFT JOIN matches m ON m.id = e.match_id
    LEFT JOIN events event ON event.id = m.event_id
    LEFT JOIN match_rooms room ON room.match_id = e.match_id AND room.room = e.room
    LEFT JOIN teams role_team ON role_team.id = COALESCE(CASE slots.role
      WHEN 'escape' THEN room.escape_team_id
      WHEN 'hunter' THEN room.hunter_team_id
    END, p.team_id)
    LEFT JOIN teams opponent_team ON opponent_team.id = CASE slots.role
      WHEN 'escape' THEN room.hunter_team_id
      WHEN 'hunter' THEN room.escape_team_id
    END
    LEFT JOIN team_logos role_logo ON role_logo.team_id = role_team.id AND role_logo.kind = slots.role
    WHERE ${filters.join(' AND ')}
    ORDER BY e.decided_at, e.id`);
  const rows = division === 'all' ? statement.all() : statement.all(division === 'pe' ? 'mobile' : 'pc');
  return enrichResolvedTeams(database, rows);
}

function profileFor(character) {
  const skills = new Map((character.skills || []).map(skill => [Number(skill.slot), skill]));
  return {
    nickname: character.nickname || character.id,
    name: character.display_name || character.id,
    releaseDate: character.release_date_text || null,
    changes: (character.changes || []).map(change => ({
      date: change.changed_on || null,
      title: change.title,
      content: change.content || null
    })),
    skills: Array.from({ length: 3 }, (_, index) => ({
      id: `${character.id}-skill-${index + 1}`,
      name: skills.get(index + 1)?.name || null,
      description: skills.get(index + 1)?.description || null,
      iconUrl: skills.get(index + 1)?.icon_updated_at
        ? `/api/characters/${encodeURIComponent(character.id)}/skills/${index + 1}/icon?v=${skills.get(index + 1).icon_updated_at}`
        : (skills.get(index + 1)?.icon_url || null)
    }))
  };
}

function readCharacters(database) {
  const characters = database.prepare(`SELECT id, role, sort_order, nickname, display_name,
    release_date_text, portrait_url,
    (SELECT updated_at FROM character_portraits WHERE character_id = characters.id) AS portrait_updated_at
    FROM characters
    WHERE enabled = 1
    ORDER BY role, sort_order, id`).all();
  const skillsByCharacter = new Map();
  for (const skill of database.prepare(`SELECT skill.character_id, skill.slot, skill.name,
      skill.description, skill.icon_url, icon.updated_at AS icon_updated_at
    FROM character_skills skill
    LEFT JOIN character_skill_icons icon
      ON icon.character_id = skill.character_id AND icon.slot = skill.slot
    ORDER BY skill.character_id, skill.slot`).all()) {
    const skills = skillsByCharacter.get(skill.character_id) || [];
    skills.push(skill);
    skillsByCharacter.set(skill.character_id, skills);
  }
  const changesByCharacter = new Map();
  for (const change of database.prepare(`SELECT character_id, changed_on, title, content, source_order
    FROM character_change_history
    ORDER BY character_id, changed_on DESC, source_order, id`).all()) {
    const changes = changesByCharacter.get(change.character_id) || [];
    changes.push(change);
    changesByCharacter.set(change.character_id, changes);
  }
  return characters.map(character => ({
    ...character,
    skills: skillsByCharacter.get(character.id) || [],
    changes: changesByCharacter.get(character.id) || []
  }));
}

function matchupLabel(row) {
  if (row.matchup_home && row.matchup_away) return `${row.matchup_home} vs ${row.matchup_away}`;
  if (row.team_name && row.opponent_team_name) return `${row.team_name} vs ${row.opponent_team_name}`;
  return row.event_name || row.match_id || null;
}

function teamFromRow(row) {
  if (!row.team_id && !row.team_name) return null;
  return { id: row.team_id || null, name: row.team_name || null, logoUrl: row.team_logo_url || null };
}

function playerFromRow(row) {
  const nickname = row.player_nickname || row.player_text || null;
  if (!row.player_id && !nickname) return null;
  return { id: row.player_id || null, nickname, officialId: row.player_official_id || null };
}

function mostCommon(rows, valueForRow, keyForValue, limit) {
  const counts = new Map();
  for (const row of rows) {
    const value = valueForRow(row);
    if (!value) continue;
    const key = keyForValue(value);
    const entry = counts.get(key) || { ...value, count: 0, latestAt: 0 };
    entry.count += 1;
    entry.latestAt = Math.max(entry.latestAt, Number(row.decided_at) || 0);
    counts.set(key, entry);
  }
  return [...counts.values()]
    .sort((left, right) => right.count - left.count || right.latestAt - left.latestAt)
    .slice(0, limit)
    .map(({ latestAt, ...value }) => value);
}

function usageFor(character, rows) {
  const seenSessions = new Set();
  const picks = rows.filter(row => {
    if (row.kind !== 'pick' || row.role !== character.role || row.character_id !== character.id) return false;
    if (seenSessions.has(row.session_id)) return false;
    seenSessions.add(row.session_id);
    return true;
  }).sort((left, right) => Number(right.decided_at) - Number(left.decided_at));
  const latest = picks[0] || null;
  return {
    latestTeam: latest ? teamFromRow(latest) : null,
    latestPlayer: latest ? playerFromRow(latest) : null,
    latestMatch: latest ? {
      id: latest.match_id,
      eventName: latest.event_name || null,
      stageName: latest.stage_label || latest.stage || null,
      matchupLabel: matchupLabel(latest),
      gameNumber: latest.game_number,
      room: latest.room,
      attempt: latest.attempt
    } : null,
    latestUsedAt: latest?.decided_at || null,
    commonTeams: mostCommon(picks, teamFromRow, team => team.id || team.name, 3),
    commonPlayers: mostCommon(picks, playerFromRow, player => player.id || player.nickname, 5),
    recentResults: picks.slice(0, 10).map(row => ({
      sessionId: row.session_id,
      matchId: row.match_id,
      eventName: row.event_name || null,
      matchupLabel: matchupLabel(row),
      gameNumber: row.game_number,
      room: row.room,
      attempt: row.attempt,
      decidedAt: row.decided_at,
      winnerRole: row.winner_role,
      won: row.winner_role === character.role
    }))
  };
}

function buildCharacterStats(characters, rows, now = Date.now()) {
  const effectiveSessionIds = new Set(rows.map(row => row.session_id));
  const decidedAt = rows.reduce((latest, row) => Math.max(latest, Number(row.decided_at) || 0), 0);
  const roles = {};

  for (const role of ROLE_KEYS) {
    const roleCharacters = characters.filter(character => character.role === role);
    const counters = new Map(roleCharacters.map(character => [character.id, {
      uses: 0,
      bans: 0,
      selectedSessionIds: new Set(),
      wonSessionIds: new Set()
    }]));
    let totalPicks = 0;
    let totalBans = 0;

    for (const row of rows) {
      if (row.role !== role || !row.character_id || !counters.has(row.character_id)) continue;
      const counter = counters.get(row.character_id);
      if (row.kind === 'pick') {
        counter.uses += 1;
        totalPicks += 1;
        counter.selectedSessionIds.add(row.session_id);
        if (row.winner_role === role) {
          counter.wonSessionIds.add(row.session_id);
        }
      } else if (row.kind === 'ban') {
        counter.bans += 1;
        totalBans += 1;
      }
    }

    const draft = roleCharacters.map(character => {
      const counter = counters.get(character.id);
      const selectedGames = counter.selectedSessionIds.size;
      const wonGames = counter.wonSessionIds.size;
      return {
        id: character.id,
        role,
        sortOrder: character.sort_order,
        profile: profileFor(character),
        portraitUrl: character.portrait_url || null,
        uses: counter.uses,
        bans: counter.bans,
        wins: wonGames,
        selectedGames,
        wonGames,
        usageRate: safeRate(counter.uses, totalPicks),
        banRate: safeRate(counter.bans, totalBans),
        winRate: safeRate(wonGames, selectedGames)
      };
    });
    const totalSelectedGames = draft.reduce((sum, character) => sum + character.selectedGames, 0);
    const totalWonGames = draft.reduce((sum, character) => sum + character.wonGames, 0);
    const averageWinRate = safeRate(totalWonGames, totalSelectedGames);
    const maxUsageRate = Math.max(0, ...draft.map(character => character.usageRate));
    const maxBanRate = Math.max(0, ...draft.map(character => character.banRate));

    for (const character of draft) {
      character.adjustedWinRate = character.selectedGames > 0
        ? safeRate(character.wonGames + FORMULA.priorGames * averageWinRate, character.selectedGames + FORMULA.priorGames)
        : 0;
      const normalizedUsageRate = safeRate(character.usageRate, maxUsageRate);
      const normalizedBanRate = safeRate(character.banRate, maxBanRate);
      character.score = FORMULA.usageWeight * normalizedUsageRate
        + FORMULA.banWeight * normalizedBanRate
        + FORMULA.winWeight * character.adjustedWinRate;
    }

    draft.sort((left, right) => right.score - left.score
      || right.uses - left.uses
      || right.bans - left.bans
      || left.sortOrder - right.sortOrder
      || left.id.localeCompare(right.id, 'zh-CN'));

    roles[role] = {
      totalPicks,
      totalBans,
      averageWinRate: round(averageWinRate),
      characters: draft.map((character, index) => ({
        ...character.profile,
        id: character.id,
        role: character.role,
        rank: index + 1,
        uses: character.uses,
        bans: character.bans,
        wins: character.wins,
        selectedGames: character.selectedGames,
        wonGames: character.wonGames,
        usageRate: round(character.usageRate),
        banRate: round(character.banRate),
        winRate: round(character.winRate),
        adjustedWinRate: round(character.adjustedWinRate),
        score: round(character.score),
        imageUrl: character.portrait_updated_at
          ? `/api/characters/${encodeURIComponent(character.id)}/portrait?v=${character.portrait_updated_at}`
          : (character.portraitUrl || `/assets/characters/ban/${encodeURIComponent(character.id)}.png?v=2`),
        usage: usageFor(character, rows)
      }))
    };
  }

  return {
    generatedAt: now,
    formula: FORMULA,
    sample: { effectiveGames: effectiveSessionIds.size, decidedAt: decidedAt || null },
    roles
  };
}

function calculateCharacterStats(database = defaultDb, division = 'all') {
  if (!['all', 'pc', 'pe'].includes(division)) {
    throw new RangeError('Invalid character stats division');
  }
  return {
    ...buildCharacterStats(readCharacters(database), readEffectiveSlotRows(database, division)),
    division
  };
}

module.exports = {
  FORMULA,
  buildCharacterStats,
  calculateCharacterStats,
  createCharacter,
  updateCharacter,
  archiveCharacter,
  readCharacterPortrait,
  readCharacterSkillIcon,
  baseCharacter,
  normalizeCharacterInput
};
