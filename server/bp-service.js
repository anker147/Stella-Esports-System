const { EventEmitter } = require('events');
const { CONFIG, ESCAPE_CHARACTERS, HUNTER_CHARACTERS, PHASES, SLOT_CONFIG } = require('./bp-config');
const { db, withTransaction } = require('./db');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function emptySlots() {
  const slots = {};
  for (const [slotId, config] of Object.entries(SLOT_CONFIG)) {
    slots[slotId] = config.kind === 'ban'
      ? { characterId: null }
      : { characterId: null, playerId: null, playerText: null };
  }
  return slots;
}

function snapshot(session) {
  const copy = clone(session);
  delete copy.history;
  delete copy.auditActor;
  return copy;
}

class BpService extends EventEmitter {
  constructor({ resolver, zeroPulseMs = CONFIG.timer.zeroPulseMs, tickMs = 250, phaseDurations = null, commentatorImage = null } = {}) {
    super();
    assert(resolver, 'Tournament resolver is required');
    this.resolver = resolver;
    this.zeroPulseMs = zeroPulseMs;
    this.configuredPhaseDurations = phaseDurations;
    this.commentatorImage = commentatorImage ? clone(commentatorImage) : null;
    this.sessions = this.loadSessions();
    this.forfeits = this.loadForfeits();
    this.transitionTimers = new Map();
    this.lastDisplayedSeconds = new Map();
    this.tickTimer = setInterval(() => this.tick(), tickMs);
    this.tickTimer.unref?.();
    this.recoverPendingTransitions();
  }

  close() {
    clearInterval(this.tickTimer);
    for (const timer of this.transitionTimers.values()) clearTimeout(timer);
    this.transitionTimers.clear();
  }

  loadSessions() {
    const sessions = {};
    try {
      const sessionRows = db.prepare('SELECT * FROM bp_sessions').all();
      const slotRows = db.prepare('SELECT * FROM bp_session_slots').all();
      const resultRows = db.prepare('SELECT * FROM bp_session_results').all();

      const slotsBySession = new Map();
      for (const row of slotRows) {
        if (!slotsBySession.has(row.session_id)) slotsBySession.set(row.session_id, {});
        slotsBySession.get(row.session_id)[row.slot_id] = {
          characterId: row.character_id || null,
          playerId: row.player_id || null,
          playerText: row.player_text || null
        };
      }
      const resultsBySession = new Map();
      for (const row of resultRows) {
        resultsBySession.set(row.session_id, {
          winnerRole: row.winner_role,
          winnerTeamId: row.winner_team_id,
          decidedAt: row.decided_at,
          ...(row.image_file_name != null
            ? { image: { fileName: row.image_file_name, filePath: row.image_file_path, uploadedAt: row.image_uploaded_at } }
            : {})
        });
      }
      const resultUpdatedSessions = new Set(db.prepare(
        "SELECT DISTINCT session_id FROM bp_session_history WHERE action = 'result-updated'"
      ).all().map(row => row.session_id));

      for (const row of sessionRows) {
        const slots = slotsBySession.get(row.id) || {};
        for (const [slotId, config] of Object.entries(SLOT_CONFIG)) {
          if (!slots[slotId]) {
            slots[slotId] = config.kind === 'ban'
              ? { characterId: null }
              : { characterId: null, playerId: null, playerText: null };
          } else if (config.kind === 'ban') {
            slots[slotId] = { characterId: slots[slotId].characterId || null };
          }
        }
        const result = resultsBySession.get(row.id) || null;
        const session = {
          id: row.id,
          matchId: row.match_id,
          gameNumber: row.game_number,
          room: row.room,
          attempt: row.attempt,
          replayOf: row.replay_of || null,
          outputMode: !row.output_mode || row.output_mode === 'officialId' ? 'nickname' : row.output_mode,
          commentatorImage: row.commentator_image_id
            ? { id: row.commentator_image_id, name: row.commentator_image_name }
            : null,
          result: result ? clone(result) : null,
          revision: row.revision,
          status: row.status,
          currentPhaseIndex: row.current_phase_index,
          slots,
          timer: {
            durationSeconds: row.timer_duration_seconds,
            remainingSeconds: row.timer_remaining_seconds,
            running: Boolean(row.timer_running),
            deadline: row.timer_deadline_ms ?? null,
            transitionPending: Boolean(row.timer_transition_pending)
          },
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          auditActor: null,
          history: null
        };
        if (session.result) session.result ||= null;
        if (session.attempt > 1 && !resultUpdatedSessions.has(session.id)) session.result = null;
        sessions[session.id] = session;
      }
    } catch (error) {
      console.warn(`BP 会话加载失败，已重置 BP 域数据: ${error.message}`);
      db.exec('DELETE FROM bp_session_history; DELETE FROM bp_session_results; DELETE FROM bp_session_slots; DELETE FROM bp_sessions;');
      return {};
    }
    return sessions;
  }

  loadForfeits() {
    const forfeits = {};
    try {
      const rows = db.prepare('SELECT * FROM bp_forfeits').all();
      const eventRows = db.prepare('SELECT * FROM bp_forfeit_events ORDER BY seq').all();
      const eventsByForfeit = new Map();
      for (const row of eventRows) {
        const key = `${row.match_id}:r${row.room}`;
        if (!eventsByForfeit.has(key)) eventsByForfeit.set(key, []);
        const event = { action: row.action, timestamp: row.timestamp_ms };
        if (row.forfeiting_team_id != null) event.forfeitingTeamId = row.forfeiting_team_id;
        if (row.winner_team_id != null) event.winnerTeamId = row.winner_team_id;
        eventsByForfeit.get(key).push(event);
      }
      for (const row of rows) {
        const key = `${row.match_id}:r${row.room}`;
        forfeits[key] = {
          matchId: row.match_id,
          room: row.room,
          forfeitingTeamId: row.forfeiting_team_id,
          winnerTeamId: row.winner_team_id,
          active: Boolean(row.active),
          declaredAt: row.declared_at,
          revokedAt: row.revoked_at ?? null,
          sessionStates: JSON.parse(row.session_states_json || '{}'),
          events: eventsByForfeit.get(key) || []
        };
      }
    } catch (error) {
      console.warn(`弃赛记录加载失败，已重置: ${error.message}`);
      db.exec('DELETE FROM bp_forfeit_events; DELETE FROM bp_forfeits;');
      return {};
    }
    return forfeits;
  }

  ensureHistory(session) {
    if (Array.isArray(session.history)) return session.history;
    session.history = db.prepare(`SELECT revision, timestamp_ms, actor_user_id, actor_display_name, actor_identity_key,
      action, details_json, snapshot_json FROM bp_session_history
      WHERE session_id = ? ORDER BY seq`).all(session.id).map(row => ({
      revision: row.revision,
      timestamp: row.timestamp_ms,
      actorUserId: row.actor_user_id || null,
      actorName: row.actor_display_name || '系统',
      actorIdentityKey: row.actor_identity_key || (row.actor_user_id ? 'unknown' : 'system'),
      action: row.action,
      details: JSON.parse(row.details_json || '{}'),
      snapshot: JSON.parse(row.snapshot_json || '{}')
    }));
    return session.history;
  }

  persist(...subjects) {
    const targets = subjects.filter(Boolean);
    if (!targets.length) return;
    withTransaction(() => {
      const upsertSession = db.prepare(`INSERT INTO bp_sessions
        (id, match_id, game_number, room, attempt, replay_of, output_mode, status, current_phase_index,
         commentator_image_id, commentator_image_name, timer_duration_seconds, timer_remaining_seconds,
         timer_running, timer_deadline_ms, timer_transition_pending, created_at, updated_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          match_id = excluded.match_id, game_number = excluded.game_number, room = excluded.room,
          attempt = excluded.attempt, replay_of = excluded.replay_of, output_mode = excluded.output_mode,
          status = excluded.status, current_phase_index = excluded.current_phase_index,
          commentator_image_id = excluded.commentator_image_id, commentator_image_name = excluded.commentator_image_name,
          timer_duration_seconds = excluded.timer_duration_seconds, timer_remaining_seconds = excluded.timer_remaining_seconds,
          timer_running = excluded.timer_running, timer_deadline_ms = excluded.timer_deadline_ms,
          timer_transition_pending = excluded.timer_transition_pending, created_at = excluded.created_at,
          updated_at = excluded.updated_at, revision = excluded.revision`);
      const deleteSlots = db.prepare('DELETE FROM bp_session_slots WHERE session_id = ?');
      const insertSlot = db.prepare(
        'INSERT INTO bp_session_slots (session_id, slot_id, character_id, player_id, player_text) VALUES (?, ?, ?, ?, ?)');
      const deleteResult = db.prepare('DELETE FROM bp_session_results WHERE session_id = ?');
      const insertResult = db.prepare(`INSERT INTO bp_session_results
        (session_id, winner_role, winner_team_id, decided_at, image_file_name, image_file_path, image_uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const deleteHistory = db.prepare('DELETE FROM bp_session_history WHERE session_id = ?');
      const insertHistory = db.prepare(`INSERT INTO bp_session_history
        (session_id, revision, timestamp_ms, actor_user_id, actor_display_name, actor_identity_key,
          action, details_json, snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const upsertForfeit = db.prepare(`INSERT INTO bp_forfeits
        (match_id, room, forfeiting_team_id, winner_team_id, active, declared_at, revoked_at, session_states_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (match_id, room) DO UPDATE SET
          forfeiting_team_id = excluded.forfeiting_team_id, winner_team_id = excluded.winner_team_id,
          active = excluded.active, declared_at = excluded.declared_at, revoked_at = excluded.revoked_at,
          session_states_json = excluded.session_states_json`);
      const deleteForfeitEvents = db.prepare('DELETE FROM bp_forfeit_events WHERE match_id = ? AND room = ?');
      const insertForfeitEvent = db.prepare(`INSERT INTO bp_forfeit_events
        (match_id, room, seq, action, timestamp_ms, forfeiting_team_id, winner_team_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);

      for (const subject of targets) {
        if (subject.events) {
          const forfeit = subject;
          upsertForfeit.run(forfeit.matchId, forfeit.room, forfeit.forfeitingTeamId, forfeit.winnerTeamId,
            forfeit.active ? 1 : 0, forfeit.declaredAt ?? 0, forfeit.revokedAt ?? null,
            JSON.stringify(forfeit.sessionStates || {}));
          deleteForfeitEvents.run(forfeit.matchId, forfeit.room);
          (forfeit.events || []).forEach((event, seq) => insertForfeitEvent.run(
            forfeit.matchId, forfeit.room, seq, event.action, event.timestamp ?? 0,
            event.forfeitingTeamId ?? null, event.winnerTeamId ?? null));
          continue;
        }
        const session = subject;
        this.ensureHistory(session);
        upsertSession.run(
          session.id, session.matchId, session.gameNumber, session.room, session.attempt ?? 1,
          session.replayOf || null, session.outputMode || 'nickname', session.status,
          session.currentPhaseIndex ?? -1,
          session.commentatorImage?.id || null, session.commentatorImage?.name || null,
          session.timer?.durationSeconds ?? 30, session.timer?.remainingSeconds ?? 30,
          session.timer?.running ? 1 : 0, session.timer?.deadline ?? null,
          session.timer?.transitionPending ? 1 : 0,
          session.createdAt ?? 0, session.updatedAt ?? 0, session.revision ?? 0);
        deleteSlots.run(session.id);
        for (const [slotId, slot] of Object.entries(session.slots || {})) {
          insertSlot.run(session.id, slotId, slot.characterId || null, slot.playerId || null, slot.playerText ?? null);
        }
        deleteResult.run(session.id);
        if (session.result) {
          insertResult.run(session.id, session.result.winnerRole, session.result.winnerTeamId,
            session.result.decidedAt ?? 0, session.result.image?.fileName || null,
            session.result.image?.filePath || null, session.result.image?.uploadedAt ?? null);
        }
        deleteHistory.run(session.id);
        for (const item of session.history || []) {
          insertHistory.run(session.id, item.revision, item.timestamp ?? 0,
            item.actorUserId || null, item.actorName || '系统',
            item.actorIdentityKey || (item.actorUserId ? 'unknown' : 'system'), item.action,
            JSON.stringify(item.details || {}), JSON.stringify(item.snapshot || {}));
        }
      }
    });
  }

  sessionId(matchId, gameNumber, room, attempt = 1) {
    return `${matchId}:g${gameNumber}:r${room}:a${attempt}`;
  }

  validateContext(matchId, gameNumber, room) {
    this.resolver.getMatch(matchId);
    assert(Number.isInteger(gameNumber) && gameNumber >= 1 && gameNumber <= 3, 'BO3局数必须是1、2或3');
    assert(room === 'A' || room === 'B', '房间必须是A或B');
  }

  createSession(matchId, gameNumber, room, attempt = 1, auditActor = null) {
    this.validateContext(matchId, gameNumber, room);
    this.assertGameAvailable(matchId, gameNumber, room);
    const id = this.sessionId(matchId, gameNumber, room, attempt);
    const now = Date.now();
    const initialDuration = this.durationForPhase(0);
    const session = {
      id,
      matchId,
      gameNumber,
      room,
      attempt,
      replayOf: null,
      outputMode: 'nickname',
      commentatorImage: clone(this.commentatorImage),
      result: null,
      revision: 0,
      status: 'ready',
      currentPhaseIndex: -1,
      slots: emptySlots(),
      timer: {
        durationSeconds: initialDuration,
        remainingSeconds: initialDuration,
        running: false,
        deadline: null,
        transitionPending: false
      },
      createdAt: now,
      updatedAt: now,
      auditActor: auditActor ? { ...auditActor } : null,
      history: []
    };
    this.sessions[id] = session;
    this.record(session, 'session-created');
    this.persist(session);
    return session;
  }

  ensureSession(matchId, gameNumber, room, attempt = 1, auditActor = null) {
    const id = this.sessionId(matchId, gameNumber, room, attempt);
    return this.sessions[id] || this.createSession(matchId, gameNumber, room, attempt, auditActor);
  }

  setAuditActor(id, auditActor) {
    const session = this.getSession(id);
    session.auditActor = auditActor ? { ...auditActor } : null;
    return session;
  }

  getSession(id) {
    const session = this.sessions[id];
    assert(session, `BP记录不存在: ${id}`);
    this.ensureHistory(session);
    return session;
  }

  listSessions(matchId = null) {
    return Object.values(this.sessions)
      .filter(session => !matchId || session.matchId === matchId)
      .map(session => this.serialize(session));
  }

  listSessionSummaries(matchId = null) {
    return Object.values(this.sessions)
      .filter(session => !matchId || session.matchId === matchId)
      .map(session => ({
        id: session.id,
        matchId: session.matchId,
        gameNumber: session.gameNumber,
        room: session.room,
        attempt: session.attempt,
        status: session.status,
        result: clone(session.result),
        forfeit: clone(this.activeForfeit(session.matchId, session.room))
      }));
  }

  currentRemaining(session, now = Date.now()) {
    if (!session.timer.running || !session.timer.deadline) return session.timer.remainingSeconds;
    return Math.max(0, Math.ceil((session.timer.deadline - now) / 1000));
  }

  serialize(session) {
    this.ensureHistory(session);
    const data = clone(session);
    delete data.auditActor;
    data.timer.remainingSeconds = this.currentRemaining(session);
    data.phase = session.currentPhaseIndex >= 0 ? PHASES[session.currentPhaseIndex] || null : null;
    data.roomAssignment = {
      escapeTeamId: this.resolver.getMatch(session.matchId).rooms[session.room].escapeTeamId,
      hunterTeamId: this.resolver.getMatch(session.matchId).rooms[session.room].hunterTeamId
    };
    data.score = this.scoreFor(session.matchId, session.room, session);
    data.forfeit = clone(this.activeForfeit(session.matchId, session.room));
    return data;
  }

  forfeitKey(matchId, room) {
    return `${matchId}:r${room}`;
  }

  activeForfeit(matchId, room) {
    const record = this.forfeits[this.forfeitKey(matchId, room)];
    return record?.active ? record : null;
  }

  assertNotForfeited(matchId, room) {
    assert(!this.activeForfeit(matchId, room), '当前房间已按弃赛结算，请先撤回弃赛');
  }

  scoreFor(matchId, room, selectedSession = null) {
    const score = { escape: 0, hunter: 0 };
    const forfeit = this.activeForfeit(matchId, room);
    if (forfeit) {
      const assignment = this.resolver.getMatch(matchId).rooms[room];
      const winnerRole = assignment.escapeTeamId === forfeit.winnerTeamId ? 'escape' : 'hunter';
      score[winnerRole] = 2;
      return score;
    }
    for (let gameNumber = 1; gameNumber <= 3; gameNumber += 1) {
      const effective = selectedSession?.matchId === matchId && selectedSession.room === room && selectedSession.gameNumber === gameNumber
        ? selectedSession
        : Object.values(this.sessions)
          .filter(item => item.matchId === matchId && item.room === room && item.gameNumber === gameNumber)
          .sort((left, right) => right.attempt - left.attempt)[0];
      if (effective?.result?.winnerRole) score[effective.result.winnerRole] += 1;
    }
    return score;
  }

  effectiveSession(matchId, room, gameNumber) {
    return Object.values(this.sessions)
      .filter(item => item.matchId === matchId && item.room === room && item.gameNumber === gameNumber)
      .sort((left, right) => right.attempt - left.attempt)[0] || null;
  }

  gameAvailability(matchId, room, gameNumber) {
    this.validateContext(matchId, gameNumber, room);
    const forfeit = this.activeForfeit(matchId, room);
    if (forfeit) return { available: false, reason: '当前房间已按弃赛结算' };
    if (gameNumber === 1) return { available: true, reason: null };

    const previous = this.effectiveSession(matchId, room, gameNumber - 1);
    if (!previous || (previous.status !== 'completed' && previous.status !== 'replay')) {
      return { available: false, reason: `第 ${gameNumber - 1} 局 BP 尚未结束` };
    }

    if (gameNumber === 3) {
      const score = this.scoreFor(matchId, room);
      if (score.escape >= 2 || score.hunter >= 2) {
        return { available: false, reason: 'BO3 已有队伍取得 2 分，无需进行第 3 局' };
      }
    }
    return { available: true, reason: null };
  }

  assertGameAvailable(matchId, gameNumber, room) {
    const availability = this.gameAvailability(matchId, room, gameNumber);
    assert(availability.available, availability.reason);
  }

  record(session, action, details = {}) {
    this.ensureHistory(session);
    session.revision += 1;
    session.updatedAt = Date.now();
    session.history.push({
      revision: session.revision,
      timestamp: session.updatedAt,
      actorUserId: session.auditActor?.userId || null,
      actorName: session.auditActor?.displayName || '系统',
      actorIdentityKey: session.auditActor?.identityKey || (session.auditActor?.userId ? 'unknown' : 'system'),
      action,
      details: clone(details),
      snapshot: snapshot(session)
    });
  }

  emitSession(session, reason, details = {}) {
    this.emit('session', { session: this.serialize(session), reason, details });
  }

  startSession(id) {
    const session = this.getSession(id);
    this.assertNotForfeited(session.matchId, session.room);
    assert(session.attempt === 1, '重赛快照不重新进行BP');
    this.assertGameAvailable(session.matchId, session.gameNumber, session.room);
    if (session.currentPhaseIndex < 0) session.currentPhaseIndex = 0;
    session.status = 'active';
    this.startTimer(session);
    this.record(session, 'bp-started');
    this.persist(session);
    this.emitSession(session, 'bp-started');
    return this.serialize(session);
  }

  startTimer(session) {
    session.timer.durationSeconds = this.durationForPhase(session.currentPhaseIndex);
    session.timer.remainingSeconds = session.timer.durationSeconds;
    session.timer.deadline = Date.now() + session.timer.durationSeconds * 1000;
    session.timer.running = true;
    session.timer.transitionPending = false;
    this.lastDisplayedSeconds.set(session.id, session.timer.durationSeconds);
  }

  durationForPhase(phaseIndex) {
    const phase = PHASES[Math.max(0, phaseIndex)];
    const configured = Number(this.configuredPhaseDurations?.[phase?.id] ?? CONFIG.timer.phaseDurations?.[phase?.id]);
    return Number.isInteger(configured) && configured > 0 ? configured : CONFIG.timer.durationSeconds;
  }

  phaseIndexForSlot(slotId) {
    return PHASES.findIndex(phase => phase.slots.includes(slotId));
  }

  slotComplete(session, slotId) {
    const config = SLOT_CONFIG[slotId];
    const slot = session.slots[slotId];
    return config.kind === 'ban'
      ? Boolean(slot.characterId)
      : Boolean(slot.characterId && (session.outputMode === 'character' || slot.playerId || slot.playerText));
  }

  phaseComplete(session) {
    const phase = PHASES[session.currentPhaseIndex];
    return Boolean(phase && phase.slots.every(slotId => this.slotComplete(session, slotId)));
  }

  validateCharacter(slotId, characterId) {
    if (characterId === null) return;
    const config = SLOT_CONFIG[slotId];
    const allowed = config.role === 'escape' ? ESCAPE_CHARACTERS : HUNTER_CHARACTERS;
    assert(allowed.includes(characterId), `${characterId}不属于${config.role === 'escape' ? '逃生' : '追捕'}角色`);
  }

  bannedCharacters(session, role) {
    return new Set(Object.entries(session.slots)
      .filter(([slotId, slot]) => SLOT_CONFIG[slotId].kind === 'ban' && SLOT_CONFIG[slotId].role === role && slot.characterId)
      .map(([, slot]) => slot.characterId));
  }

  validatePlayer(session, slotId, playerId) {
    if (playerId === null) return;
    const config = SLOT_CONFIG[slotId];
    assert(config.kind === 'pick', 'Ban槽位不能选择选手');
    const result = this.resolver.getCandidates(session.matchId, session.room, config.role);
    assert(result.candidates.some(player => player.playerId === playerId), `选手不在当前${config.role}候选池`);
    const duplicate = Object.entries(session.slots).some(([otherSlotId, slot]) =>
      otherSlotId !== slotId && SLOT_CONFIG[otherSlotId].role === config.role && slot.playerId === playerId
    );
    assert(!duplicate, '同一选手不能占用多个BP槽位');
  }

  updateSlot(id, { slotId, characterId, playerId, playerText, field }) {
    const session = this.getSession(id);
    this.assertNotForfeited(session.matchId, session.room);
    assert(session.status === 'active', 'BP尚未开始或已经结束');
    const config = SLOT_CONFIG[slotId];
    assert(config, `未知BP槽位: ${slotId}`);
    const phaseIndex = this.phaseIndexForSlot(slotId);
    assert(phaseIndex <= session.currentPhaseIndex, '不能提前操作未来阶段');

    const beforeComplete = this.slotComplete(session, slotId);
    if (field === 'character') {
      this.validateCharacter(slotId, characterId);
      if (config.kind === 'ban' && characterId) {
        const duplicateBan = Object.entries(session.slots).some(([otherSlotId, slot]) =>
          otherSlotId !== slotId &&
          SLOT_CONFIG[otherSlotId].kind === 'ban' &&
          SLOT_CONFIG[otherSlotId].role === config.role &&
          slot.characterId === characterId
        );
        assert(!duplicateBan, `${characterId}已被Ban，不能重复Ban`);
      }
      if (config.kind === 'pick' && characterId) {
        assert(!this.bannedCharacters(session, config.role).has(characterId), `${characterId}已被Ban，不能用于Pick`);
      }
      session.slots[slotId].characterId = characterId;
    } else if (field === 'player') {
      assert(session.outputMode === 'nickname', '角色称号模式不需要选择选手昵称');
      this.validatePlayer(session, slotId, playerId);
      session.slots[slotId].playerId = playerId;
      session.slots[slotId].playerText = null;
    } else if (field === 'playerText') {
      assert(session.outputMode === 'nickname', '角色称号模式不需要输入选手昵称');
      assert(config.kind === 'pick', 'Ban槽位不能输入选手文本');
      const text = String(playerText || '').trim();
      assert(text.length > 0 && text.length <= 64, '手动选手文本必须为1到64个字符');
      session.slots[slotId].playerId = null;
      session.slots[slotId].playerText = text;
    } else {
      throw new Error(`未知槽位字段: ${field}`);
    }

    const afterComplete = this.slotComplete(session, slotId);
    const value = field === 'character' ? characterId : field === 'player' ? playerId : session.slots[slotId].playerText;
    this.record(session, 'slot-updated', { slotId, field, value });
    this.persist(session);
    this.emitSession(session, 'slot-updated', { slotId, field });

    if (afterComplete) {
      this.emit('push-slot', { session: this.serialize(session), slotId, changedAfterComplete: beforeComplete });
    } else if (beforeComplete) {
      this.emit('clear-slot', { session: this.serialize(session), slotId });
    }

    if (phaseIndex === session.currentPhaseIndex && this.phaseComplete(session)) this.beginPhaseTransition(session);
    return this.serialize(session);
  }

  clearSlot(id, slotId) {
    const session = this.getSession(id);
    this.assertNotForfeited(session.matchId, session.room);
    const config = SLOT_CONFIG[slotId];
    assert(config, `未知BP槽位: ${slotId}`);
    const phaseIndex = this.phaseIndexForSlot(slotId);
    assert(phaseIndex <= session.currentPhaseIndex, '不能清空未来阶段');
    session.slots[slotId] = config.kind === 'ban'
      ? { characterId: null }
      : { characterId: null, playerId: null, playerText: null };
    if (phaseIndex < session.currentPhaseIndex || session.timer.transitionPending) {
      clearTimeout(this.transitionTimers.get(session.id));
      this.transitionTimers.delete(session.id);
      session.currentPhaseIndex = phaseIndex;
      session.status = 'active';
      session.timer.transitionPending = false;
      this.startTimer(session);
    }
    this.record(session, 'slot-cleared', { slotId });
    this.persist(session);
    this.emit('clear-slot', { session: this.serialize(session), slotId });
    this.emitSession(session, 'slot-cleared', { slotId });
    return this.serialize(session);
  }

  beginPhaseTransition(session) {
    if (session.timer.transitionPending || session.status !== 'active') return;
    session.timer.running = false;
    session.timer.deadline = null;
    session.timer.remainingSeconds = 0;
    session.timer.transitionPending = true;
    this.record(session, 'phase-completed', { phaseId: PHASES[session.currentPhaseIndex].id });
    this.persist(session);
    this.emitSession(session, 'phase-zero');
    this.emit('timer', { session: this.serialize(session), seconds: 0 });
    this.schedulePhaseAdvance(session);
  }

  schedulePhaseAdvance(session) {
    clearTimeout(this.transitionTimers.get(session.id));
    const timer = setTimeout(() => {
      this.transitionTimers.delete(session.id);
      const current = this.sessions[session.id];
      if (!current || !current.timer.transitionPending) return;
      current.currentPhaseIndex += 1;
      current.timer.transitionPending = false;
      if (current.currentPhaseIndex >= PHASES.length) {
        current.status = 'completed';
        current.timer.running = false;
        current.timer.deadline = null;
        current.timer.remainingSeconds = 0;
        this.record(current, 'bp-completed');
        this.persist(current);
        this.emitSession(current, 'bp-completed');
        return;
      }
      this.startTimer(current);
      this.record(current, 'phase-started', { phaseId: PHASES[current.currentPhaseIndex].id });
      this.persist(current);
      this.emitSession(current, 'phase-started');
      this.emit('timer', { session: this.serialize(current), seconds: current.timer.durationSeconds });
    }, this.zeroPulseMs);
    timer.unref?.();
    this.transitionTimers.set(session.id, timer);
  }

  recoverPendingTransitions() {
    for (const session of Object.values(this.sessions)) {
      if (session.timer.transitionPending) this.schedulePhaseAdvance(session);
    }
  }

  tick() {
    const now = Date.now();
    for (const session of Object.values(this.sessions)) {
      if (!session.timer.running) continue;
      const remaining = this.currentRemaining(session, now);
      if (remaining !== this.lastDisplayedSeconds.get(session.id)) {
        this.lastDisplayedSeconds.set(session.id, remaining);
        this.emit('timer', { session: this.serialize(session), seconds: remaining });
        this.emitSession(session, 'timer-tick');
      }
      if (remaining === 0) {
        session.timer.running = false;
        session.timer.deadline = null;
        session.timer.remainingSeconds = 0;
        this.record(session, 'timer-expired', { phaseId: PHASES[session.currentPhaseIndex]?.id });
        this.persist(session);
        this.emitSession(session, 'timer-expired');
      }
    }
  }

  restoreRevision(id, revision) {
    const session = this.getSession(id);
    this.assertNotForfeited(session.matchId, session.room);
    const entry = session.history.find(item => item.revision === revision);
    assert(entry, `历史版本不存在: ${revision}`);
    const history = session.history;
    const restored = clone(entry.snapshot);
    restored.history = history;
    restored.id = session.id;
    clearTimeout(this.transitionTimers.get(id));
    this.transitionTimers.delete(id);
    if (restored.status === 'active' && !restored.timer.transitionPending) this.startTimer(restored);
    this.sessions[id] = restored;
    this.record(restored, 'revision-restored', { restoredRevision: revision });
    this.persist(restored);
    if (restored.timer.transitionPending) this.schedulePhaseAdvance(restored);
    this.emitSession(restored, 'revision-restored', { revision });
    this.emit('sync-session', { session: this.serialize(restored) });
    return this.serialize(restored);
  }

  createReplay(id) {
    const original = this.getSession(id);
    this.assertNotForfeited(original.matchId, original.room);
    const attempts = Object.values(this.sessions)
      .filter(item => item.matchId === original.matchId && item.gameNumber === original.gameNumber && item.room === original.room)
      .map(item => item.attempt);
    const attempt = Math.max(...attempts) + 1;
    const replay = clone(original);
    replay.id = this.sessionId(original.matchId, original.gameNumber, original.room, attempt);
    replay.attempt = attempt;
    replay.replayOf = original.id;
    replay.status = 'replay';
    replay.result = null;
    replay.timer = { durationSeconds: this.durationForPhase(0), remainingSeconds: 0, running: false, deadline: null, transitionPending: false };
    replay.createdAt = Date.now();
    replay.updatedAt = replay.createdAt;
    replay.revision = 0;
    replay.history = [];
    this.sessions[replay.id] = replay;
    this.record(replay, 'replay-created', { replayOf: original.id });
    this.persist(replay);
    this.emitSession(replay, 'replay-created');
    this.emit('sync-session', { session: this.serialize(replay) });
    return this.serialize(replay);
  }

  setOutputMode(id, mode) {
    const session = this.getSession(id);
    this.assertNotForfeited(session.matchId, session.room);
    assert(mode === 'nickname' || mode === 'character', '显示模式必须是选手昵称或角色称号');
    const before = new Map(Object.keys(SLOT_CONFIG).map(slotId => [slotId, this.slotComplete(session, slotId)]));
    session.outputMode = mode;
    this.record(session, 'output-mode-updated', { mode });
    this.persist(session);
    this.emitSession(session, 'output-mode-updated', { mode });
    this.emit('sync-session', { session: this.serialize(session) });

    for (const [slotId, config] of Object.entries(SLOT_CONFIG)) {
      if (config.kind === 'pick' && !before.get(slotId) && this.slotComplete(session, slotId)) {
        this.emit('push-slot', { session: this.serialize(session), slotId, changedAfterComplete: false });
      }
    }
    if (session.status === 'active' && this.phaseComplete(session)) this.beginPhaseTransition(session);
    return this.serialize(session);
  }

  setCommentatorImage(id, image) {
    this.getSession(id);
    this.setGlobalCommentatorImage(image);
    return this.serialize(this.getSession(id));
  }

  setGlobalCommentatorImage(image) {
    assert(image && typeof image.id === 'string' && image.id && typeof image.name === 'string', '解说组图无效');
    this.commentatorImage = { id: image.id, name: image.name };
    const affected = Object.values(this.sessions);
    for (const session of affected) {
      session.commentatorImage = clone(this.commentatorImage);
      this.record(session, 'commentator-image-updated', { imageId: image.id, imageName: image.name });
    }
    if (affected.length) this.persist(...affected);
    for (const session of affected) this.emitSession(session, 'commentator-image-updated', { imageId: image.id });
    return clone(this.commentatorImage);
  }

  completeSession(id) {
    const session = this.getSession(id);
    this.assertNotForfeited(session.matchId, session.room);
    assert(session.status === 'ready' || session.status === 'active', '当前 BP 已经结束');
    clearTimeout(this.transitionTimers.get(id));
    this.transitionTimers.delete(id);
    session.status = 'completed';
    session.currentPhaseIndex = PHASES.length;
    session.timer.running = false;
    session.timer.deadline = null;
    session.timer.remainingSeconds = 0;
    session.timer.transitionPending = false;
    this.record(session, 'bp-manually-completed');
    this.persist(session);
    const serialized = this.serialize(session);
    this.emit('timer', { session: serialized, seconds: 0 });
    this.emitSession(session, 'bp-manually-completed');
    return serialized;
  }

  setResult(id, winnerRole) {
    const session = this.getSession(id);
    this.assertNotForfeited(session.matchId, session.room);
    assert(session.status === 'completed' || session.status === 'replay', 'BP完成后才能选择战果');
    assert(winnerRole === 'escape' || winnerRole === 'hunter', '战果必须选择逃生方或追捕方');
    const teamId = this.resolver.getMatch(session.matchId).rooms[session.room][`${winnerRole}TeamId`];
    session.result = { winnerRole, winnerTeamId: teamId, decidedAt: Date.now() };
    this.record(session, 'result-updated', { winnerRole, winnerTeamId: teamId });
    this.persist(session);
    const serialized = this.serialize(session);
    this.emitSession(session, 'result-updated', { winnerRole, winnerTeamId: teamId });
    return serialized;
  }

  setResultImage(id, image) {
    const session = this.getSession(id);
    this.assertNotForfeited(session.matchId, session.room);
    assert(session.result?.winnerRole, '请先选择本局战果');
    session.result.image = { ...image, uploadedAt: Date.now() };
    this.record(session, 'result-image-updated', { fileName: image.fileName, filePath: image.filePath });
    this.persist(session);
    this.emitSession(session, 'result-image-updated', { fileName: image.fileName });
    return this.serialize(session);
  }

  resetSession(id) {
    const session = this.getSession(id);
    this.assertNotForfeited(session.matchId, session.room);
    assert(session.attempt === 1, '只有正赛BP可以重置');
    clearTimeout(this.transitionTimers.get(id));
    this.transitionTimers.delete(id);
    session.status = 'ready';
    session.currentPhaseIndex = -1;
    session.slots = emptySlots();
    session.result = null;
    session.timer = {
      durationSeconds: this.durationForPhase(0),
      remainingSeconds: this.durationForPhase(0),
      running: false,
      deadline: null,
      transitionPending: false
    };
    this.record(session, 'session-reset');
    this.persist(session);
    const serialized = this.serialize(session);
    this.emitSession(session, 'session-reset');
    this.emit('sync-session', { session: serialized });
    this.emit('score', { session: serialized, score: serialized.score });
    return serialized;
  }

  matchWinner(matchId) {
    const match = this.resolver.getMatch(matchId);
    const winners = [];
    for (const room of ['A', 'B']) {
      const score = this.scoreFor(matchId, room);
      if (score.escape >= 2) winners.push(match.rooms[room].escapeTeamId);
      if (score.hunter >= 2) winners.push(match.rooms[room].hunterTeamId);
    }
    const unique = [...new Set(winners)];
    return unique.length === 1 ? unique[0] : match.winnerTeamId || null;
  }

  declareForfeit(id, forfeitingTeamId) {
    const selected = this.getSession(id);
    this.assertNotForfeited(selected.matchId, selected.room);
    const assignment = this.resolver.getMatch(selected.matchId).rooms[selected.room];
    const teamIds = [assignment.escapeTeamId, assignment.hunterTeamId];
    assert(teamIds.includes(forfeitingTeamId), '弃赛队伍不属于当前对阵');
    const winnerTeamId = teamIds.find(teamId => teamId !== forfeitingTeamId);
    const now = Date.now();
    const affected = Object.values(this.sessions)
      .filter(session => session.matchId === selected.matchId && session.room === selected.room);
    const sessionStates = {};

    for (const session of affected) {
      const timer = clone(session.timer);
      timer.remainingSeconds = this.currentRemaining(session, now);
      timer.deadline = null;
      sessionStates[session.id] = {
        status: session.status,
        currentPhaseIndex: session.currentPhaseIndex,
        timer
      };
      clearTimeout(this.transitionTimers.get(session.id));
      this.transitionTimers.delete(session.id);
      session.status = 'forfeited';
      session.timer.running = false;
      session.timer.deadline = null;
      session.timer.transitionPending = false;
      this.record(session, 'forfeit-declared', { forfeitingTeamId, winnerTeamId });
    }

    const key = this.forfeitKey(selected.matchId, selected.room);
    this.forfeits[key] = {
      matchId: selected.matchId,
      room: selected.room,
      forfeitingTeamId,
      winnerTeamId,
      active: true,
      declaredAt: now,
      revokedAt: null,
      sessionStates,
      events: [{ action: 'forfeit-declared', timestamp: now, forfeitingTeamId, winnerTeamId }]
    };
    this.persist(...affected, this.forfeits[key]);
    for (const session of affected) this.emitSession(session, 'forfeit-declared', { forfeitingTeamId, winnerTeamId });
    const serialized = this.serialize(selected);
    this.emit('score', { session: serialized, score: serialized.score });
    return serialized;
  }

  revokeForfeit(id) {
    const selected = this.getSession(id);
    const key = this.forfeitKey(selected.matchId, selected.room);
    const forfeit = this.forfeits[key];
    assert(forfeit?.active, '当前房间没有可撤回的弃赛记录');
    const now = Date.now();

    for (const [sessionId, state] of Object.entries(forfeit.sessionStates || {})) {
      const session = this.sessions[sessionId];
      if (!session) continue;
      session.status = state.status;
      session.currentPhaseIndex = state.currentPhaseIndex;
      session.timer = clone(state.timer);
      if (session.timer.running) {
        session.timer.deadline = now + session.timer.remainingSeconds * 1000;
      }
      this.record(session, 'forfeit-revoked', {
        forfeitingTeamId: forfeit.forfeitingTeamId,
        winnerTeamId: forfeit.winnerTeamId
      });
      if (session.timer.transitionPending) this.schedulePhaseAdvance(session);
    }

    forfeit.active = false;
    forfeit.revokedAt = now;
    forfeit.events.push({ action: 'forfeit-revoked', timestamp: now });
    const affected = Object.keys(forfeit.sessionStates || {})
      .map(sessionId => this.sessions[sessionId])
      .filter(Boolean);
    this.persist(...affected, forfeit);
    for (const session of affected) this.emitSession(session, 'forfeit-revoked');
    const serialized = this.serialize(selected);
    this.emit('score', { session: serialized, score: serialized.score });
    return serialized;
  }
}

module.exports = { BpService };
