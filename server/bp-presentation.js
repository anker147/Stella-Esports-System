const { EventEmitter } = require('node:events');
const { SLOT_CONFIG, animationStyle } = require('./bp-config');
const { db } = require('./db');

const STAGE_ASSETS = {
  quarterfinals: '/assets/match-intro/bp-layout/stage-quarterfinals.png',
  'quarterfinals-lower-rounds-1-2': '/assets/match-intro/bp-layout/stage-losers.png',
  'semifinals-upper-rounds-1-2': '/assets/match-intro/bp-layout/stage-winners.png',
  finals: '/assets/match-intro/bp-layout/stage-finals.png'
};
const ROUND_LABELS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function defaultState() {
  return {
    schemaVersion: 1,
    dynamicEnabled: false,
    activeSessionId: null,
    sequence: 0,
    introEpoch: 0,
    visibility: 'hidden',
    playAt: null,
    commandExpiresAt: null,
    reason: 'initial',
    updatedAt: Date.now()
  };
}

class BpPresentationService extends EventEmitter {
  constructor({ resolver, getSession, now = () => Date.now() } = {}) {
    super();
    if (!resolver) throw new Error('Tournament resolver is required');
    if (typeof getSession !== 'function') throw new Error('BP session resolver is required');
    this.resolver = resolver;
    this.getSession = getSession;
    this.now = now;
    this.state = this.readStore();
  }

  readStore() {
    try {
      const row = db.prepare('SELECT * FROM bp_presentation_state WHERE id = 1').get();
      if (!row) return defaultState();
      if (row.sequence == null) throw new Error('Unsupported BP presentation state');
      return {
        ...defaultState(),
        dynamicEnabled: Boolean(row.dynamic_enabled),
        activeSessionId: row.active_session_id || null,
        sequence: row.sequence,
        introEpoch: row.intro_epoch,
        reason: row.reason || 'initial',
        updatedAt: row.updated_at ?? Date.now(),
        visibility: 'hidden',
        playAt: null,
        commandExpiresAt: null
      };
    } catch {
      return defaultState();
    }
  }

  persist() {
    db.prepare(`INSERT INTO bp_presentation_state
      (id, dynamic_enabled, active_session_id, sequence, intro_epoch, visibility, play_at, command_expires_at, reason, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        dynamic_enabled = excluded.dynamic_enabled, active_session_id = excluded.active_session_id,
        sequence = excluded.sequence, intro_epoch = excluded.intro_epoch, visibility = excluded.visibility,
        play_at = excluded.play_at, command_expires_at = excluded.command_expires_at,
        reason = excluded.reason, updated_at = excluded.updated_at`)
      .run(this.state.dynamicEnabled ? 1 : 0, this.state.activeSessionId || null,
        this.state.sequence ?? 0, this.state.introEpoch ?? 0, this.state.visibility || 'hidden',
        this.state.playAt ?? null, this.state.commandExpiresAt ?? null, this.state.reason || null,
        this.state.updatedAt ?? Date.now());
  }

  resolveSession(id = this.state.activeSessionId) {
    if (!id) return null;
    try {
      return this.getSession(id);
    } catch {
      return null;
    }
  }

  playerText(session, slotId) {
    const slot = session.slots[slotId];
    if (!slot?.characterId) return '';
    if (session.outputMode === 'character') return slot.characterId;
    if (!slot.playerId) return slot.playerText || '';
    const role = SLOT_CONFIG[slotId].role;
    const candidates = this.resolver.getCandidates(session.matchId, session.room, role).candidates;
    return candidates.find(player => player.playerId === slot.playerId)?.nickname || slot.playerText || '';
  }

  characterUrl(kind, characterId) {
    if (!characterId) return null;
    const folder = kind === 'ban' ? 'ban' : 'pick';
    return `/assets/characters/${folder}/${encodeURIComponent(characterId)}.png?v=2`;
  }

  buildSnapshot(session) {
    if (!session) return null;
    const match = this.resolver.getMatch(session.matchId);
    const tournament = this.resolver.getTournamentByMatch(session.matchId);
    const assignment = match.rooms[session.room];
    const escapeTeam = this.resolver.getTeam(assignment.escapeTeamId);
    const hunterTeam = this.resolver.getTeam(assignment.hunterTeamId);
    const roundNumber = tournament.matches.findIndex(item => item.id === session.matchId) + 1;
    const slots = {};
    for (const [slotId, config] of Object.entries(SLOT_CONFIG)) {
      const slot = session.slots[slotId];
      const text = config.kind === 'pick' ? this.playerText(session, slotId) : '';
      const complete = Boolean(slot.characterId) && (config.kind === 'ban' || Boolean(text));
      slots[slotId] = {
        id: slotId,
        kind: config.kind,
        role: config.role,
        characterId: complete ? slot.characterId : null,
        imageUrl: complete ? this.characterUrl(config.kind, slot.characterId) : null,
        text: complete ? text : '',
        complete
      };
    }
    return {
      id: session.id,
      revision: session.revision,
      status: session.status,
      matchId: session.matchId,
      gameNumber: session.gameNumber,
      room: session.room,
      attempt: session.attempt,
      outputMode: session.outputMode,
      animationStyle: animationStyle(),
      currentPhaseIndex: session.currentPhaseIndex,
      phase: clone(session.phase),
      timer: clone(session.timer),
      score: clone(session.score || { escape: 0, hunter: 0 }),
      teams: {
        escape: {
          id: escapeTeam.id,
          name: escapeTeam.displayName,
          logoUrl: escapeTeam.logos.escape.webFile
        },
        hunter: {
          id: hunterTeam.id,
          name: hunterTeam.displayName,
          logoUrl: hunterTeam.logos.hunter.webFile
        }
      },
      metadata: {
        division: tournament.event.division === 'pc' ? '端游赛区' : '手游赛区',
        round: `第${ROUND_LABELS[roundNumber] || roundNumber}轮`,
        game: `MATCH ${session.gameNumber}`,
        stage: tournament.event.stage,
        stageImageUrl: STAGE_ASSETS[tournament.event.stage] || STAGE_ASSETS.quarterfinals
      },
      slots
    };
  }

  payload(reason = this.state.reason) {
    const session = this.resolveSession();
    return {
      ...clone(this.state),
      reason,
      serverTime: this.now(),
      snapshot: this.buildSnapshot(session)
    };
  }

  commit(reason, changes = {}) {
    Object.assign(this.state, changes, {
      sequence: this.state.sequence + 1,
      reason,
      updatedAt: this.now()
    });
    this.persist();
    const payload = this.payload(reason);
    this.emit('presentation', payload);
    return payload;
  }

  setEnabled(enabled) {
    const value = Boolean(enabled);
    return this.commit(value ? 'dynamic-enabled' : 'dynamic-disabled', {
      dynamicEnabled: value,
      visibility: 'hidden',
      playAt: null,
      commandExpiresAt: null
    });
  }

  prepare(session, reason = 'presentation-prepared') {
    if (!session?.id) throw new Error('BP presentation session is required');
    return this.commit(reason, {
      activeSessionId: session.id,
      visibility: this.state.dynamicEnabled ? 'armed' : 'hidden',
      playAt: null,
      commandExpiresAt: null
    });
  }

  publishSession(session, reason = 'session-updated') {
    if (!this.state.dynamicEnabled || !session || session.id !== this.state.activeSessionId) return null;
    return this.commit(reason);
  }

  armIntro(session, delayMs = 2000, commandWindowMs = 1500) {
    if (!this.state.dynamicEnabled) return this.payload('dynamic-disabled');
    if (!session?.id) throw new Error('BP presentation session is required');
    const playAt = this.now() + delayMs;
    return this.commit('intro-armed', {
      activeSessionId: session.id,
      introEpoch: this.state.introEpoch + 1,
      visibility: 'armed',
      playAt,
      commandExpiresAt: playAt + commandWindowMs
    });
  }

  hide(reason = 'presentation-hidden') {
    return this.commit(reason, {
      visibility: 'hidden',
      playAt: null,
      commandExpiresAt: null
    });
  }

  heartbeat() {
    return {
      serverTime: this.now(),
      dynamicEnabled: this.state.dynamicEnabled,
      sequence: this.state.sequence,
      activeSessionId: this.state.activeSessionId
    };
  }
}

module.exports = { BpPresentationService, STAGE_ASSETS };
