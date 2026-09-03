const fs = require('node:fs');
const path = require('node:path');
const { db, withTransaction, IN_MEMORY } = require('./db');
const { DATA_ROOT, DEFAULTS_ROOT, INSTALL_DATA_ROOT, parseJsonFile } = require('./data-paths');

const TOURNAMENT_DIR_LEGACY = path.resolve(__dirname, '..', 'public', 'assets', 'data');
const TOURNAMENT_DIR_SEED = path.join(DEFAULTS_ROOT, 'tournaments');
const MIGRATED_SUFFIX = () => `.migrated-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

function seedCandidates(relativeName) {
  return [...new Set([
    path.join(DATA_ROOT, relativeName),
    path.join(DEFAULTS_ROOT, relativeName),
    path.join(INSTALL_DATA_ROOT, relativeName)
  ])].filter(candidate => fs.existsSync(candidate));
}

function readSeedJson(relativeName) {
  const candidate = seedCandidates(relativeName)[0];
  return candidate ? { path: candidate, data: parseJsonFile(candidate) } : null;
}

function renameMigrated(absolutePath) {
  // 仅重命名数据目录里的运行时副本；defaults 种子保持原位供后续安装复用
  if (IN_MEMORY || !absolutePath.startsWith(DATA_ROOT)) return false;
  const target = `${absolutePath}${MIGRATED_SUFFIX()}`;
  fs.renameSync(absolutePath, target);
  return true;
}

function countOf(table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

function excelDateText(value) {
  if (!Number.isFinite(value)) return String(value || '').trim() || null;
  const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

function importCharacterProfiles() {
  const migrationKey = 'migration.characterProfiles.v1';
  if (db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(migrationKey)) {
    return { skipped: true, reason: 'already imported' };
  }
  const seed = readSeedJson('character-profile-data.json');
  if (!seed) return { skipped: true, reason: 'no character profile seed' };
  if (seed.data.schemaVersion !== 1 || !Array.isArray(seed.data.characters)) {
    throw new Error('角色资料种子格式无效');
  }

  let skillCount = 0;
  withTransaction(() => {
    const upsertCharacter = db.prepare(`INSERT INTO characters
      (id, role, sort_order, enabled, nickname, display_name, release_date_text, portrait_url)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        nickname = CASE
          WHEN characters.nickname IS NULL OR characters.nickname = '' THEN excluded.nickname
          ELSE characters.nickname
        END,
        display_name = CASE
          WHEN characters.display_name IS NULL OR characters.display_name = '' THEN excluded.display_name
          ELSE characters.display_name
        END,
        release_date_text = CASE
          WHEN characters.release_date_text IS NULL OR characters.release_date_text = '' THEN excluded.release_date_text
          ELSE characters.release_date_text
        END,
        portrait_url = CASE
          WHEN characters.portrait_url IS NULL OR characters.portrait_url = '' THEN excluded.portrait_url
          ELSE characters.portrait_url
        END`);
    const upsertSkill = db.prepare(`INSERT INTO character_skills
      (character_id, slot, name, description, icon_url) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (character_id, slot) DO UPDATE SET
        name = CASE
          WHEN character_skills.name IS NULL OR character_skills.name = '' THEN excluded.name
          ELSE character_skills.name
        END,
        description = CASE
          WHEN character_skills.description IS NULL OR character_skills.description = '' THEN excluded.description
          ELSE character_skills.description
        END,
        icon_url = CASE
          WHEN character_skills.icon_url IS NULL OR character_skills.icon_url = '' THEN excluded.icon_url
          ELSE character_skills.icon_url
        END`);
    const roleIndexes = { escape: 0, hunter: 0 };
    for (const character of seed.data.characters) {
      const id = String(character.id || '').trim();
      const role = character.role;
      if (!id || !Object.hasOwn(roleIndexes, role)) throw new Error('角色资料种子包含无效角色');
      const sortOrder = roleIndexes[role]++;
      upsertCharacter.run(
        id,
        role,
        sortOrder,
        id,
        String(character.name || '').trim() || null,
        excelDateText(character.releaseDate),
        `/assets/characters/ban/${encodeURIComponent(id)}.png?v=2`
      );
      (Array.isArray(character.skills) ? character.skills : []).forEach((skill, index) => {
        upsertSkill.run(
          id,
          index + 1,
          String(skill?.name || '').trim() || null,
          String(skill?.description || '').trim() || null,
          String(skill?.iconUrl || '').trim() || null
        );
        skillCount += 1;
      });
    }
    db.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)').run(
      migrationKey,
      JSON.stringify({ source: seed.data.source || null, importedAt: Date.now(), schemaVersion: 1 })
    );
  });
  return { imported: true, characters: seed.data.characters.length, skills: skillCount };
}

function importCharacterChangeHistory() {
  const migrationKey = 'migration.characterChangeHistory.v1';
  if (db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(migrationKey)) {
    return { skipped: true, reason: 'already imported' };
  }
  const seed = readSeedJson('character-change-history.json');
  if (!seed) return { skipped: true, reason: 'no character change history seed' };
  if (seed.data.schemaVersion !== 1 || !Array.isArray(seed.data.characters)) {
    throw new Error('角色修改历史种子格式无效');
  }

  let changeCount = 0;
  withTransaction(() => {
    const insert = db.prepare(`INSERT INTO character_change_history
      (character_id, changed_on, title, content, source_order)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(character_id, changed_on, title) DO UPDATE SET
        content = excluded.content,
        source_order = excluded.source_order`);
    for (const character of seed.data.characters) {
      const characterId = String(character.id || '').trim();
      if (!characterId || !db.prepare('SELECT 1 FROM characters WHERE id = ?').get(characterId)) continue;
      (Array.isArray(character.changes) ? character.changes : []).forEach((change, index) => {
        const title = String(change?.title || '').trim();
        if (!title) return;
        insert.run(
          characterId,
          String(change?.date || '').trim() || null,
          title,
          String(change?.content || '').trim() || null,
          index
        );
        changeCount += 1;
      });
    }
    db.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)').run(
      migrationKey,
      JSON.stringify({ source: seed.data.source || null, importedAt: Date.now(), schemaVersion: 1 })
    );
  });
  return { imported: true, changes: changeCount };
}

function importBpConfig({ rename = false } = {}) {
  if (countOf('characters') > 0) return { skipped: true };
  const seed = readSeedJson('bp-config.json');
  if (!seed) return { skipped: true, reason: 'no bp-config seed' };
  const config = seed.data;
  withTransaction(() => {
    const insertCharacter = db.prepare('INSERT INTO characters (id, role, sort_order, nickname) VALUES (?, ?, ?, ?)');
    config.characters.escape.forEach((name, index) => insertCharacter.run(name, 'escape', index, name));
    config.characters.hunter.forEach((name, index) => insertCharacter.run(name, 'hunter', index, name));

    const insertSlot = db.prepare(`INSERT INTO bp_slots
      (id, label, kind, role, image_source, text_source, image_group, text_group, group_name, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const slotIds = Object.keys(config.slots);
    slotIds.forEach((slotId, index) => {
      const slot = config.slots[slotId];
      insertSlot.run(slotId, slot.label, slot.kind, slot.role, slot.imageSource || null,
        slot.textSource || null, slot.imageGroup || null, slot.textGroup || null,
        slot.group || null, index);
    });

    const insertPhase = db.prepare(
      'INSERT INTO bp_phases (id, label, sort_order, duration_seconds) VALUES (?, ?, ?, ?)');
    const insertPhaseSlot = db.prepare(
      'INSERT INTO bp_phase_slots (phase_id, slot_id, sort_order) VALUES (?, ?, ?)');
    config.phases.forEach((phase, index) => {
      insertPhase.run(phase.id, phase.label, index, config.timer.phaseDurations[phase.id] ?? null);
      phase.slots.forEach((slotId, slotIndex) => insertPhaseSlot.run(phase.id, slotId, slotIndex));
    });

    const insertUi = db.prepare('INSERT INTO bp_ui_sections (kind, slot_id, sort_order) VALUES (?, ?, ?)');
    for (const [kind, slotIdsInSection] of Object.entries(config.ui?.sections || {})) {
      slotIdsInSection.forEach((slotId, index) => insertUi.run(kind, slotId, index));
    }

    const insertSetting = db.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)');
    insertSetting.run('timer.durationSeconds', JSON.stringify(config.timer.durationSeconds));
    insertSetting.run('timer.zeroPulseMs', JSON.stringify(config.timer.zeroPulseMs));
    insertSetting.run('overlay.animationStyle', JSON.stringify(config.overlay?.animationStyle || 'classic'));
    insertSetting.run('commentator.imageId', JSON.stringify(config.commentator?.imageId ?? null));
    insertSetting.run('commentator.logoImageId', JSON.stringify(config.commentator?.logoImageId ?? null));
    insertSetting.run('assets', JSON.stringify(config.assets || {}));
    insertSetting.run('obsScenes', JSON.stringify(config.obsScenes || {}));
    insertSetting.run('obsGroups', JSON.stringify(config.obsGroups || {}));
    insertSetting.run('obsInputs', JSON.stringify(config.obsInputs || {}));
  });
  return { imported: true, renamed: rename ? renameMigrated(seed.path) : false, characters: config.characters.escape.length + config.characters.hunter.length };
}

function importTournaments() {
  if (countOf('events') > 0) return { skipped: true };
  const legacyFiles = fs.existsSync(TOURNAMENT_DIR_LEGACY)
    ? fs.readdirSync(TOURNAMENT_DIR_LEGACY).filter(name => /^tournament-.*\.json$/.test(name)).sort()
    : [];
  const seedFiles = fs.existsSync(TOURNAMENT_DIR_SEED)
    ? fs.readdirSync(TOURNAMENT_DIR_SEED).filter(name => /^tournament-.*\.json$/.test(name)).sort()
    : [];
  const sources = legacyFiles.length
    ? legacyFiles.map(name => ({ name, filePath: path.join(TOURNAMENT_DIR_LEGACY, name), data: parseJsonFile(path.join(TOURNAMENT_DIR_LEGACY, name)) }))
    : seedFiles.map(name => ({ name, filePath: path.join(TOURNAMENT_DIR_SEED, name), data: parseJsonFile(path.join(TOURNAMENT_DIR_SEED, name)) }));
  if (!sources.length) return { skipped: true, reason: 'no tournament sources' };

  let teamCount = 0;
  let matchCount = 0;
  withTransaction(() => {
    const insertEvent = db.prepare(`INSERT INTO events
      (id, name, division, stage, stage_label, date, mode, format,
       schedule_image, stage_image, schedule_table_image, source_workbook, source_workbook_sha256,
       role_rules_json, integrity_json, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertEventTeam = db.prepare(
      'INSERT INTO event_teams (event_id, team_id, sort_order) VALUES (?, ?, ?)');
    const upsertTeam = db.prepare('INSERT OR IGNORE INTO teams (id, display_name, source_rows, aliases_json) VALUES (?, ?, ?, ?)');
    const insertLogo = db.prepare(
      'INSERT OR REPLACE INTO team_logos (team_id, kind, obs_file, web_file, sha256) VALUES (?, ?, ?, ?, ?)');
    const insertPlayer = db.prepare(`INSERT OR IGNORE INTO players
      (player_id, team_id, role, slot, nickname, official_id, registered_nickname, registered_official_id, is_substitute)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertMatch = db.prepare(`INSERT INTO matches
      (id, event_id, source_row, date, start_time, end_time, mode, format, matchup_home, matchup_away, winner_team_id, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertParticipant = db.prepare(
      'INSERT INTO match_participants (match_id, slot, ref_type, team_id, from_match_id, outcome) VALUES (?, ?, ?, ?, ?, ?)');
    const insertRoom = db.prepare(
      'INSERT INTO match_rooms (match_id, room, escape_team_id, hunter_team_id) VALUES (?, ?, ?, ?)');

    // 第一遍：全量队伍（跨文件共享的 teamIds 可能前向引用）
    for (const { data } of sources) {
      for (const team of Object.values(data.teams || {})) {
        upsertTeam.run(team.id, team.displayName, team.sourceRows != null ? String(team.sourceRows) : null,
          team.aliases ? JSON.stringify(team.aliases) : null);
        teamCount += 1;
        for (const kind of ['escape', 'hunter']) {
          const logo = team.logos?.[kind];
          if (logo) insertLogo.run(team.id, kind, logo.obsFile || null, logo.webFile || null, logo.sha256 || null);
        }
        const roster = team.roster || {};
        const insertRoster = (role, players, substitute) => {
          players.filter(player => player.playerId).forEach(player => insertPlayer.run(
            player.playerId, team.id, role, player.slot, player.nickname ?? null,
            player.officialId || null, player.registeredNickname || null,
            player.registeredOfficialId || null, substitute ? 1 : 0));
        };
        insertRoster('escape', roster.escape || [], false);
        insertRoster('hunter', roster.hunter || [], false);
        insertRoster('escape', roster.substitutes || [], true);
      }
    }

    // 第二遍：赛事、成员关系与对阵
    sources.forEach(({ name, filePath, data }, sortIndex) => {
      const event = data.event;
      insertEvent.run(event.id, event.name, event.division, event.stage, event.stageLabel || null,
        event.date || null, event.mode || null, event.format || null,
        event.scheduleImage || null, event.stageImage || null, event.scheduleTableImage || null,
        data.source?.workbook || null, data.source?.workbookSha256 || null,
        data.roleRules ? JSON.stringify(data.roleRules) : null,
        data.integrity ? JSON.stringify(data.integrity) : null, sortIndex);

      const teamSources = [
        ...Object.keys(data.teams || {}),
        ...(data.teamIds || [])
      ];
      teamSources.forEach((teamId, index) => insertEventTeam.run(event.id, teamId, index));

      (data.matches || []).forEach((match, matchIndex) => {
        insertMatch.run(match.id, event.id, match.sourceRow ?? null, match.date || null,
          match.startTime || null, match.endTime || null, match.mode || null, match.format || null,
          match.matchup?.[0] || null, match.matchup?.[1] || null, match.winnerTeamId || null, matchIndex);
        matchCount += 1;
        (match.participantRefs || []).forEach((ref, slot) => {
          insertParticipant.run(match.id, slot,
            ref.teamId ? 'team' : (ref.outcome === 'loser' ? 'loser_of' : 'winner_of'),
            ref.teamId || null, ref.fromMatchId || null, ref.outcome || null);
        });
        for (const room of ['A', 'B']) {
          const assignment = match.rooms?.[room];
          if (assignment) insertRoom.run(match.id, room, assignment.escapeTeamId, assignment.hunterTeamId);
        }
      });
    });
  });

  // 赛事 JSON 的物理移除由打包/整理流程统一处理，导入本身不做改名
  return { imported: true, renamed: false, events: sources.length, teams: teamCount, matches: matchCount };
}

function ensureBpTestMatch() {
  const eventId = 'bp-interface-test-event';
  const matchId = 'bp-interface-test-match';
  const preferredTeamIds = ['pc-365days', 'pc-chunxin'];
  const selectTeam = id => db.prepare(`SELECT teams.id, teams.display_name
    FROM teams
    WHERE teams.id = ?
      AND EXISTS (SELECT 1 FROM players WHERE players.team_id = teams.id)
      AND (SELECT COUNT(DISTINCT kind) FROM team_logos WHERE team_id = teams.id) = 2`).get(id);
  let teams = preferredTeamIds.map(selectTeam).filter(Boolean);
  if (teams.length < 2) {
    teams = db.prepare(`SELECT teams.id, teams.display_name
      FROM teams
      WHERE EXISTS (SELECT 1 FROM players WHERE players.team_id = teams.id)
        AND (SELECT COUNT(DISTINCT kind) FROM team_logos WHERE team_id = teams.id) = 2
      ORDER BY teams.id
      LIMIT 2`).all();
  }
  if (teams.length < 2) return { skipped: true, reason: 'not enough complete teams' };

  const [home, away] = teams;
  const presentationAssets = db.prepare(`SELECT schedule_image, stage_image
    FROM events
    WHERE schedule_image IS NOT NULL AND schedule_image <> ''
      AND stage_image IS NOT NULL AND stage_image <> ''
    ORDER BY sort_order
    LIMIT 1`).get() || {};
  const scheduleImage = presentationAssets.schedule_image || '/assets/match-intro/bp-background.png';
  const stageImage = presentationAssets.stage_image || '/assets/match-intro/bp-layout/stage-quarterfinals.png';
  const playerCount = Number(db.prepare(`SELECT COUNT(DISTINCT player_id) AS count
    FROM players WHERE team_id IN (?, ?)`).get(home.id, away.id).count);
  const integrity = {
    teamCount: 2,
    matchCount: 1,
    registeredPlayerCount: playerCount,
    logoCount: 4,
    checks: ['BP test match is excluded from character statistics']
  };
  const nextSortOrder = Number(db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM events').get().value);

  withTransaction(() => {
    db.prepare(`INSERT INTO events
      (id, name, division, stage, stage_label, date, mode, format, schedule_image, stage_image, integrity_json, sort_order)
      VALUES (?, ?, 'pc', 'test', ?, ?, '测试', 'BO3', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        division = excluded.division,
        stage = excluded.stage,
        stage_label = excluded.stage_label,
        date = excluded.date,
        mode = excluded.mode,
        format = excluded.format,
        schedule_image = excluded.schedule_image,
        stage_image = excluded.stage_image,
        integrity_json = excluded.integrity_json`)
      .run(eventId, 'BP 功能测试', '功能测试', '2026-09-02', scheduleImage, stageImage, JSON.stringify(integrity), nextSortOrder);
    db.prepare('INSERT OR IGNORE INTO event_teams (event_id, team_id, sort_order) VALUES (?, ?, ?)')
      .run(eventId, home.id, 0);
    db.prepare('INSERT OR IGNORE INTO event_teams (event_id, team_id, sort_order) VALUES (?, ?, ?)')
      .run(eventId, away.id, 1);
    db.prepare(`INSERT INTO matches
      (id, event_id, date, start_time, end_time, mode, format, matchup_home, matchup_away,
       exclude_from_character_stats, sort_order)
      VALUES (?, ?, ?, '00:00', '23:59', '测试', 'BO3', ?, ?, 1, 0)
      ON CONFLICT(id) DO UPDATE SET
        event_id = excluded.event_id,
        date = excluded.date,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        mode = excluded.mode,
        format = excluded.format,
        matchup_home = excluded.matchup_home,
        matchup_away = excluded.matchup_away,
        exclude_from_character_stats = 1`)
      .run(matchId, eventId, '2026-09-02', home.display_name, away.display_name);
    db.prepare(`INSERT INTO match_rooms (match_id, room, escape_team_id, hunter_team_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(match_id, room) DO UPDATE SET
        escape_team_id = excluded.escape_team_id,
        hunter_team_id = excluded.hunter_team_id`)
      .run(matchId, 'A', home.id, away.id);
    db.prepare(`INSERT INTO match_rooms (match_id, room, escape_team_id, hunter_team_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(match_id, room) DO UPDATE SET
        escape_team_id = excluded.escape_team_id,
        hunter_team_id = excluded.hunter_team_id`)
      .run(matchId, 'B', away.id, home.id);
  });
  return { seeded: true, eventId, matchId, teams: [home.id, away.id] };
}

function importBpState() {
  if (countOf('bp_sessions') > 0) return { skipped: true };
  const statePath = path.join(DATA_ROOT, 'bp-state.json');
  if (!fs.existsSync(statePath)) return { skipped: true, reason: 'no bp-state.json' };
  const state = parseJsonFile(statePath);
  const sessions = Object.values(state.sessions || {});
  const forfeits = Object.values(state.forfeits || {});

  let historyCount = 0;
  withTransaction(() => {
    const insertSession = db.prepare(`INSERT INTO bp_sessions
      (id, match_id, game_number, room, attempt, replay_of, output_mode, status, current_phase_index,
       commentator_image_id, commentator_image_name, timer_duration_seconds, timer_remaining_seconds,
       timer_running, timer_deadline_ms, timer_transition_pending, created_at, updated_at, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertSlot = db.prepare(
      'INSERT INTO bp_session_slots (session_id, slot_id, character_id, player_id, player_text) VALUES (?, ?, ?, ?, ?)');
    const insertResult = db.prepare(`INSERT INTO bp_session_results
      (session_id, winner_role, winner_team_id, decided_at, image_file_name, image_file_path, image_uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertHistory = db.prepare(`INSERT INTO bp_session_history
      (session_id, revision, timestamp_ms, action, details_json, snapshot_json) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const session of sessions) {
      insertSession.run(
        session.id, session.matchId, session.gameNumber, session.room, session.attempt ?? 1,
        session.replayOf || null, session.outputMode || 'nickname', session.status,
        session.currentPhaseIndex ?? -1,
        session.commentatorImage?.id || null, session.commentatorImage?.name || null,
        session.timer?.durationSeconds ?? 30, session.timer?.remainingSeconds ?? 30,
        session.timer?.running ? 1 : 0, session.timer?.deadline ?? null,
        session.timer?.transitionPending ? 1 : 0,
        session.createdAt ?? 0, session.updatedAt ?? 0, session.revision ?? 0);
      for (const [slotId, slot] of Object.entries(session.slots || {})) {
        insertSlot.run(session.id, slotId, slot.characterId || null, slot.playerId || null, slot.playerText || null);
      }
      if (session.result) {
        insertResult.run(session.id, session.result.winnerRole, session.result.winnerTeamId,
          session.result.decidedAt ?? 0, session.result.image?.fileName || null,
          session.result.image?.filePath || null, session.result.image?.uploadedAt ?? null);
      }
      for (const item of session.history || []) {
        insertHistory.run(session.id, item.revision, item.timestamp ?? 0, item.action,
          JSON.stringify(item.details || {}), JSON.stringify(item.snapshot || {}));
        historyCount += 1;
      }
    }

    const insertForfeit = db.prepare(`INSERT INTO bp_forfeits
      (match_id, room, forfeiting_team_id, winner_team_id, active, declared_at, revoked_at, session_states_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertForfeitEvent = db.prepare(`INSERT INTO bp_forfeit_events
      (match_id, room, seq, action, timestamp_ms, forfeiting_team_id, winner_team_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const forfeit of forfeits) {
      insertForfeit.run(forfeit.matchId, forfeit.room, forfeit.forfeitingTeamId, forfeit.winnerTeamId,
        forfeit.active ? 1 : 0, forfeit.declaredAt ?? 0, forfeit.revokedAt ?? null,
        JSON.stringify(forfeit.sessionStates || {}));
      (forfeit.events || []).forEach((event, seq) => insertForfeitEvent.run(
        forfeit.matchId, forfeit.room, seq, event.action, event.timestamp ?? 0,
        event.forfeitingTeamId || null, event.winnerTeamId || null));
    }
  });

  // 计数断言：任一不符即中止改名，保留原文件供排查
  if (countOf('bp_sessions') !== sessions.length) throw new Error(`bp_sessions 迁移计数不符: ${countOf('bp_sessions')} != ${sessions.length}`);
  if (countOf('bp_session_history') !== historyCount) throw new Error('bp_session_history 迁移计数不符');
  if (countOf('bp_forfeits') !== forfeits.length) throw new Error('bp_forfeits 迁移计数不符');

  return {
    imported: true, renamed: renameMigrated(statePath),
    sessions: sessions.length, history: historyCount, forfeits: forfeits.length
  };
}

function importMaterialLibrary() {
  if (countOf('material_entries') > 0) return { skipped: true };
  const libraryPath = path.join(DATA_ROOT, 'material-library.json');
  if (!fs.existsSync(libraryPath)) return { skipped: true, reason: 'no material-library.json' };
  const library = parseJsonFile(libraryPath);
  const entries = Object.values(library.entries || {});
  withTransaction(() => {
    const insertEntry = db.prepare('INSERT INTO material_entries (id, path, kind, added_at) VALUES (?, ?, ?, ?)');
    for (const entry of entries) insertEntry.run(entry.id, entry.path, entry.kind, entry.addedAt ?? 0);
    const insertFolder = db.prepare('INSERT OR IGNORE INTO material_watched_folders (path) VALUES (?)');
    for (const folder of library.watchedFolders || []) insertFolder.run(folder);
    const insertExcluded = db.prepare('INSERT OR IGNORE INTO material_excluded_paths (path) VALUES (?)');
    for (const excluded of library.excludedPaths || []) insertExcluded.run(excluded);
  });
  if (countOf('material_entries') !== entries.length) throw new Error('material_entries 迁移计数不符');
  return { imported: true, renamed: renameMigrated(libraryPath), entries: entries.length };
}

function importObsPathMigration() {
  const syncCount = countOf('asset_path_syncs');
  if (syncCount > 0) return { skipped: true };
  const migrationPath = path.join(DATA_ROOT, 'obs-path-migration.json');
  if (!fs.existsSync(migrationPath)) return { skipped: true, reason: 'no obs-path-migration.json' };
  const migration = parseJsonFile(migrationPath);
  withTransaction(() => {
    const insertSetting = db.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)');
    insertSetting.run('assetPaths.canonicalRoot', JSON.stringify(migration.canonicalRoot || null));
    insertSetting.run('assetPaths.lastSelectedFolderId', JSON.stringify(migration.lastSelectedFolderId || null));
    insertSetting.run('assetPaths.lastRollback', JSON.stringify(migration.lastRollback || null));
    const sync = migration.lastSuccessfulSync;
    if (sync) {
      db.prepare(`INSERT INTO asset_path_syncs
        (id, folder_id, target_root, canonical_root, synced_at, rolled_back_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(sync.id, sync.folderId || null, sync.targetRoot || '', sync.canonicalRoot || '',
          sync.syncedAt || new Date().toISOString(), sync.rolledBackAt || null);
      const insertRecord = db.prepare(`INSERT INTO asset_path_sync_records
        (sync_id, object_type, source_name, filter_name, setting_path, setting_tokens_json, before, after)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const record of sync.records || []) {
        insertRecord.run(sync.id, record.objectType, record.sourceName, record.filterName || null,
          record.settingPath, JSON.stringify(record.settingTokens || []), record.before ?? null, record.after ?? null);
      }
    }
    const validation = migration.lastValidation;
    if (validation) {
      db.prepare(`INSERT INTO asset_path_validation
        (id, valid, folder_id, target_root, canonical_root, reference_count, object_count, missing_count, records_json, missing_json, checked_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(validation.valid ? 1 : 0, validation.folderId || null, validation.targetRoot || null,
          validation.canonicalRoot || null, validation.referenceCount ?? 0, validation.objectCount ?? 0,
          validation.missingCount ?? 0, JSON.stringify(validation.records || []),
          JSON.stringify(validation.missing || []), validation.checkedAt || null);
    }
  });
  return { imported: true, renamed: renameMigrated(migrationPath), syncs: syncCount };
}

function importRuntimeConfig() {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key IN ('obs.url', 'obs.password')").get().n;
  if (existing > 0) return { skipped: true };
  const configPath = path.join(DATA_ROOT, 'runtime-config.json');
  if (!fs.existsSync(configPath)) return { skipped: true, reason: 'no runtime-config.json' };
  const config = parseJsonFile(configPath);
  withTransaction(() => {
    const insertSetting = db.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)');
    if (config.obs?.url) insertSetting.run('obs.url', JSON.stringify(config.obs.url));
    if (config.obs?.password != null) insertSetting.run('obs.password', JSON.stringify(config.obs.password));
  });
  return { imported: true, renamed: renameMigrated(configPath) };
}

function importPresentation() {
  const exists = db.prepare('SELECT COUNT(*) AS n FROM bp_presentation_state').get().n;
  if (exists > 0) return { skipped: true };
  const presentationPath = path.join(DATA_ROOT, 'bp-presentation.json');
  if (!fs.existsSync(presentationPath)) return { skipped: true, reason: 'no bp-presentation.json' };
  const presentation = parseJsonFile(presentationPath);
  db.prepare(`INSERT INTO bp_presentation_state
    (id, dynamic_enabled, active_session_id, sequence, intro_epoch, visibility, play_at, command_expires_at, reason, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(presentation.dynamicEnabled ? 1 : 0, presentation.activeSessionId || null,
      presentation.sequence ?? 0, presentation.introEpoch ?? 0, presentation.visibility || 'hidden',
      presentation.playAt ?? null, presentation.commandExpiresAt ?? null, presentation.reason || null,
      presentation.updatedAt ?? Date.now());
  return { imported: true, renamed: renameMigrated(presentationPath) };
}

let migrationResult = null;

function migrateLegacyData() {
  if (migrationResult) return migrationResult;
  const tournaments = importTournaments();
  migrationResult = {
    bpConfig: importBpConfig({ rename: !IN_MEMORY }),
    characterProfiles: importCharacterProfiles(),
    characterChangeHistory: importCharacterChangeHistory(),
    tournaments,
    bpTestMatch: ensureBpTestMatch(),
    bpState: importBpState(),
    materialLibrary: importMaterialLibrary(),
    obsPathMigration: importObsPathMigration(),
    runtimeConfig: importRuntimeConfig(),
    presentation: importPresentation()
  };
  return migrationResult;
}

function readAppSetting(key, fallback = null) {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return fallback;
  }
}

function writeAppSetting(key, value) {
  db.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json')
    .run(key, JSON.stringify(value));
}

module.exports = {
  migrateLegacyData,
  importBpConfig,
  importCharacterProfiles,
  importCharacterChangeHistory,
  importTournaments,
  ensureBpTestMatch,
  readAppSetting,
  writeAppSetting
};
