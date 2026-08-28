const { EventEmitter } = require('events');
const path = require('path');
const { CONFIG, OBS_INPUTS, SLOT_CONFIG } = require('./bp-config');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class SerialQueue {
  constructor() {
    this.tail = Promise.resolve();
    this.pending = 0;
  }

  add(task) {
    this.pending += 1;
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => {}).finally(() => {
      this.pending -= 1;
    });
    return result;
  }
}

class ObsController extends EventEmitter {
  constructor({ client, resolver, transitionMs = 300, characterRoot = CONFIG.assets.characterRoot, assetPath = value => value }) {
    super();
    this.client = client;
    this.resolver = resolver;
    this.transitionMs = transitionMs;
    this.characterRoot = characterRoot;
    this.assetPath = assetPath;
    this.queue = new SerialQueue();
    this.sceneItemIds = new Map();
    this.lastError = null;
    this.client.on('status', status => this.emit('status', this.status(status)));
  }

  status(clientStatus = this.client.status()) {
    return {
      ...clientStatus,
      queueDepth: this.queue.pending,
      lastOperationError: this.lastError
    };
  }

  async connect() {
    await this.client.connect();
    return this.verifyInputs();
  }

  async verifyInputs() {
    const response = await this.client.request('GetInputList');
    const names = new Set((response.inputs || []).map(input => input.inputName));
    const required = new Set([
      OBS_INPUTS.textStaging,
      OBS_INPUTS.imageStaging,
      OBS_INPUTS.timer,
      OBS_INPUTS.countdownBrowser,
      ...Object.values(OBS_INPUTS.score),
      ...Object.values(OBS_INPUTS.matchData),
      ...Object.values(OBS_INPUTS.result),
      OBS_INPUTS.bracketImage,
      OBS_INPUTS.scheduleImage,
      OBS_INPUTS.scheduleTableImage,
      OBS_INPUTS.matchStage,
      OBS_INPUTS.commentatorImage,
      OBS_INPUTS.commentatorLogo
    ]);
    for (const config of Object.values(SLOT_CONFIG)) {
      required.add(config.imageSource);
      if (config.textSource) required.add(config.textSource);
    }
    const missing = [...required].filter(name => !names.has(name));
    if (missing.length) throw new Error(`OBS缺少源: ${missing.join('、')}`);
    return { ...this.status(), verified: true, inputCount: required.size };
  }

  setInput(inputName, inputSettings) {
    return this.client.request('SetInputSettings', { inputName, inputSettings, overlay: true });
  }

  async sceneItemId(sceneName, sourceName) {
    const key = `${sceneName}\n${sourceName}`;
    if (this.sceneItemIds.has(key)) return this.sceneItemIds.get(key);
    const result = await this.client.request('GetSceneItemId', { sceneName, sourceName });
    this.sceneItemIds.set(key, result.sceneItemId);
    return result.sceneItemId;
  }

  async setVisible(sceneName, sourceName, enabled) {
    const sceneItemId = await this.sceneItemId(sceneName, sourceName);
    await this.client.request('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: enabled });
  }

  characterFile(kind, characterId) {
    const folder = kind === 'ban' ? 'Ban' : 'Pick';
    const fileName = characterId || '占位';
    return this.assetPath(path.posix.join(this.characterRoot.replaceAll('\\', '/'), folder, `${fileName}.png`)).replaceAll('\\', '/');
  }

  playerNickname(session, slotId) {
    const config = SLOT_CONFIG[slotId];
    if (session.outputMode === 'character') return session.slots[slotId].characterId || '';
    const playerId = session.slots[slotId].playerId;
    if (!playerId) return session.slots[slotId].playerText || '';
    const result = this.resolver.getCandidates(session.matchId, session.room, config.role);
    const player = result.candidates.find(item => item.playerId === playerId);
    return player?.nickname || '';
  }

  runOperation(label, task) {
    return this.queue.add(async () => {
      try {
        const result = await task();
        this.lastError = null;
        this.emit('operation', { label, ok: true, timestamp: Date.now() });
        return result;
      } catch (error) {
        this.lastError = error.message;
        this.emit('operation', { label, ok: false, error: error.message, timestamp: Date.now() });
        throw error;
      }
    });
  }

  pushSlot(session, slotId) {
    const config = SLOT_CONFIG[slotId];
    const slot = session.slots[slotId];
    return this.runOperation(`push:${session.id}:${slotId}`, async () => {
      const imageFile = this.characterFile(config.kind, slot.characterId);
      if (config.kind === 'ban') {
        await this.setInput(OBS_INPUTS.imageStaging, { file: imageFile });
        await this.setVisible(config.group, config.imageSource, false);
        await wait(this.transitionMs);
        await this.setInput(config.imageSource, { file: imageFile });
        await this.setVisible(config.group, config.imageSource, true);
        await wait(this.transitionMs);
        return;
      }

      const nickname = this.playerNickname(session, slotId);
      await Promise.all([
        this.setInput(OBS_INPUTS.imageStaging, { file: imageFile }),
        this.setInput(OBS_INPUTS.textStaging, { text: nickname })
      ]);
      await Promise.all([
        this.setVisible(config.imageGroup, config.imageSource, false),
        this.setVisible(config.textGroup, config.textSource, false)
      ]);
      await wait(this.transitionMs);
      await Promise.all([
        this.setInput(config.imageSource, { file: imageFile }),
        this.setInput(config.textSource, { text: nickname })
      ]);
      await Promise.all([
        this.setVisible(config.imageGroup, config.imageSource, true),
        this.setVisible(config.textGroup, config.textSource, true)
      ]);
      await wait(this.transitionMs);
    });
  }

  clearSlot(session, slotId) {
    const config = SLOT_CONFIG[slotId];
    const slot = session.slots[slotId];
    return this.runOperation(`clear:${session.id}:${slotId}`, async () => {
      const imageFile = this.characterFile(config.kind, null);
      if (config.kind === 'ban') {
        await this.setInput(OBS_INPUTS.imageStaging, { file: imageFile });
        await this.setVisible(config.group, config.imageSource, false);
        await wait(this.transitionMs);
        await this.setInput(config.imageSource, { file: imageFile });
        await this.setVisible(config.group, config.imageSource, true);
        await wait(this.transitionMs);
        return;
      }
      const nickname = slot.playerId ? this.playerNickname(session, slotId) : '';
      await Promise.all([
        this.setInput(OBS_INPUTS.imageStaging, { file: imageFile }),
        this.setInput(OBS_INPUTS.textStaging, { text: nickname })
      ]);
      await Promise.all([
        this.setVisible(config.imageGroup, config.imageSource, false),
        this.setVisible(config.textGroup, config.textSource, false)
      ]);
      await wait(this.transitionMs);
      await Promise.all([
        this.setInput(config.imageSource, { file: imageFile }),
        this.setInput(config.textSource, { text: nickname })
      ]);
      await Promise.all([
        this.setVisible(config.imageGroup, config.imageSource, true),
        this.setVisible(config.textGroup, config.textSource, true)
      ]);
      await wait(this.transitionMs);
    });
  }

  setTimer(seconds) {
    if (!this.client.connected) return Promise.resolve();
    return this.setInput(OBS_INPUTS.timer, { text: String(seconds).padStart(2, '0') });
  }

  syncCountdownUrl(url) {
    if (!this.client.connected || !url) return Promise.resolve();
    return this.setInput(OBS_INPUTS.countdownBrowser, { url });
  }

  syncScore(score) {
    if (!this.client.connected) return Promise.resolve();
    return Promise.all([
      this.setInput(OBS_INPUTS.score.escape, { text: String(score.escape) }),
      this.setInput(OBS_INPUTS.score.hunter, { text: String(score.hunter) })
    ]);
  }

  matchMetadata(session) {
    const match = this.resolver.getMatch(session.matchId);
    const tournament = this.resolver.getTournamentByMatch(session.matchId);
    const roundNumber = tournament.matches.findIndex(item => item.id === session.matchId) + 1;
    const [, month, day] = tournament.event.date.split('-').map(Number);
    return {
      division: tournament.event.division === 'pc' ? '端游赛区' : '手游赛区',
      round: `第${['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'][roundNumber]}轮`,
      game: `MATCH ${session.gameNumber}`,
      info: `${month}-${day} ${match.startTime} ${tournament.event.format}`
    };
  }

  matchInputUpdates(session) {
    const metadata = this.matchMetadata(session);
    const tournament = this.resolver.getTournamentByMatch(session.matchId);
    return [
      this.setInput(OBS_INPUTS.matchData.division, { text: metadata.division }),
      this.setInput(OBS_INPUTS.matchData.matchInfo, { text: metadata.info }),
      this.setInput(OBS_INPUTS.matchData.currentRound, { text: metadata.round }),
      this.setInput(OBS_INPUTS.matchData.currentGame, { text: metadata.game }),
      this.setInput(OBS_INPUTS.matchStage, { file: this.assetPath(tournament.event.stageImage).replaceAll('\\', '/') })
    ];
  }

  syncResult(session) {
    return this.runOperation(`result:${session.id}`, async () => {
      const winner = session.result?.winnerRole;
      if (!winner) return;
      await this.syncScore(session.score || { escape: 0, hunter: 0 });
      const files = winner === 'escape'
        ? ['逃生者胜利.png', '追捕者失败.png', '逃生者胜利文字图.png']
        : ['逃生者失败.png', '追捕者胜利.png', '追捕者胜利文字图.png'];
      await Promise.all([
        this.setInput(OBS_INPUTS.result.escapeLayer, { file: this.assetPath(path.posix.join(CONFIG.assets.resultOverlayRoot, files[0])).replaceAll('\\', '/') }),
        this.setInput(OBS_INPUTS.result.hunterLayer, { file: this.assetPath(path.posix.join(CONFIG.assets.resultOverlayRoot, files[1])).replaceAll('\\', '/') }),
        this.setInput(OBS_INPUTS.result.textLayer, { file: this.assetPath(path.posix.join(CONFIG.assets.resultOverlayRoot, files[2])).replaceAll('\\', '/') })
      ]);
    });
  }

  syncResultImage(filePath) {
    return this.runOperation('result-image', () => this.setInput(OBS_INPUTS.result.image, { file: this.assetPath(filePath).replaceAll('\\', '/') }));
  }

  syncBracketImage(filePath) {
    return this.runOperation('bracket-image', () => this.setInput(OBS_INPUTS.bracketImage, { file: this.assetPath(filePath).replaceAll('\\', '/') }));
  }

  syncScheduleImage(filePath) {
    return this.runOperation('schedule-image', () => this.setInput(OBS_INPUTS.scheduleImage, { file: this.assetPath(filePath).replaceAll('\\', '/') }));
  }

  syncScheduleTableImage(filePath) {
    return this.runOperation('schedule-table-image', () => this.setInput(OBS_INPUTS.scheduleTableImage, { file: this.assetPath(filePath).replaceAll('\\', '/') }));
  }

  async sceneCatalog() {
    const [sceneResult, transitionResult] = await Promise.all([
      this.client.request('GetSceneList'),
      this.client.request('GetSceneTransitionList')
    ]);
    return {
      currentScene: sceneResult.currentProgramSceneName || null,
      currentTransition: transitionResult.currentSceneTransitionName || CONFIG.obsScenes.transition,
      scenes: (sceneResult.scenes || []).map(scene => scene.sceneName),
      transitions: (transitionResult.transitions || []).map(transition => transition.transitionName)
    };
  }

  switchScene(sceneKeyOrName, transitionName = CONFIG.obsScenes.transition) {
    const sceneName = CONFIG.obsScenes?.[sceneKeyOrName] || String(sceneKeyOrName || '').trim();
    const selectedTransition = String(transitionName || '').trim();
    if (!sceneName) throw new Error('请选择 OBS 场景');
    if (!selectedTransition) throw new Error('请选择 OBS 转场');
    return this.runOperation(`scene:${sceneName}`, async () => {
      await this.client.request('SetSceneSceneTransitionOverride', {
        sceneName,
        transitionName: selectedTransition,
        transitionDuration: this.transitionMs
      });
      await this.client.request('SetCurrentSceneTransition', { transitionName: selectedTransition });
      await this.client.request('SetCurrentProgramScene', { sceneName });
    });
  }

  pushScene(sceneKeyOrName) {
    const sceneName = CONFIG.obsScenes?.[sceneKeyOrName] || String(sceneKeyOrName || '').trim();
    if (!sceneName) throw new Error('请选择 OBS 场景');
    return this.runOperation(`push-scene:${sceneName}`, () => (
      this.client.request('SetCurrentProgramScene', { sceneName })
    ));
  }

  syncCommentatorImage(filePath) {
    if (!filePath) throw new Error('解说组图路径无效');
    return this.runOperation('commentator-image', () => (
      this.setInput(OBS_INPUTS.commentatorImage, { file: this.assetPath(filePath).replaceAll('\\', '/') })
    ));
  }

  syncCommentatorLogo(filePath) {
    if (!filePath) throw new Error('解说 LOGO 或兑换码路径无效');
    return this.runOperation('commentator-logo', async () => {
      const imageFile = this.assetPath(filePath).replaceAll('\\', '/');
      await this.setInput(OBS_INPUTS.imageStaging, { file: imageFile });
      await this.setVisible(CONFIG.obsGroups.commentator, OBS_INPUTS.commentatorLogo, false);
      await wait(this.transitionMs);
      await this.setInput(OBS_INPUTS.commentatorLogo, { file: imageFile });
      await this.setVisible(CONFIG.obsGroups.commentator, OBS_INPUTS.commentatorLogo, true);
      await wait(this.transitionMs);
    });
  }

  refreshBpOverlay() {
    return this.client.request('PressInputPropertiesButton', {
      inputName: OBS_INPUTS.bpOverlay,
      propertyName: 'refreshnocache'
    });
  }

  configureBpOverlay({ url, enabled }) {
    const overlayUrl = String(url || '').trim();
    if (!overlayUrl) throw new Error('动态 BP Overlay 地址无效');
    return this.runOperation(`bp-overlay:${enabled ? 'enabled' : 'disabled'}`, async () => {
      await this.setVisible(CONFIG.obsScenes.bp, OBS_INPUTS.bpOverlay, false);
      await this.setInput(OBS_INPUTS.bpOverlay, {
        url: overlayUrl,
        width: 1920,
        height: 1080,
        reroute_audio: false,
        restart_when_active: false,
        shutdown: false
      });
      if (enabled) await this.refreshBpOverlay();
      if (enabled) await this.setVisible(CONFIG.obsScenes.bp, OBS_INPUTS.bpOverlay, true);
      return { enabled: Boolean(enabled), url: overlayUrl };
    });
  }

  syncMatch(session) {
    return this.runOperation(`match:${session.id}`, async () => {
      const match = this.resolver.getMatch(session.matchId);
      const assignment = match.rooms[session.room];
      const escapeTeam = this.resolver.getTeam(assignment.escapeTeamId);
      const hunterTeam = this.resolver.getTeam(assignment.hunterTeamId);
      await Promise.all([
        this.setInput(OBS_INPUTS.matchData.escapeTeamName, { text: escapeTeam.displayName }),
        this.setInput(OBS_INPUTS.matchData.hunterTeamName, { text: hunterTeam.displayName }),
        this.setInput(OBS_INPUTS.matchData.escapeTeamLogo, { file: this.assetPath(escapeTeam.logos.escape.obsFile).replaceAll('\\', '/') }),
        this.setInput(OBS_INPUTS.matchData.hunterTeamLogo, { file: this.assetPath(hunterTeam.logos.hunter.obsFile).replaceAll('\\', '/') }),
        ...this.matchInputUpdates(session)
      ]);
    });
  }

  syncSession(session) {
    return this.runOperation(`sync:${session.id}`, async () => {
      const match = this.resolver.getMatch(session.matchId);
      const assignment = match.rooms[session.room];
      const escapeTeam = this.resolver.getTeam(assignment.escapeTeamId);
      const hunterTeam = this.resolver.getTeam(assignment.hunterTeamId);
      const updates = [
        this.setInput(OBS_INPUTS.matchData.escapeTeamName, { text: escapeTeam.displayName }),
        this.setInput(OBS_INPUTS.matchData.hunterTeamName, { text: hunterTeam.displayName }),
        this.setInput(OBS_INPUTS.matchData.escapeTeamLogo, { file: this.assetPath(escapeTeam.logos.escape.obsFile).replaceAll('\\', '/') }),
        this.setInput(OBS_INPUTS.matchData.hunterTeamLogo, { file: this.assetPath(hunterTeam.logos.hunter.obsFile).replaceAll('\\', '/') }),
        ...this.matchInputUpdates(session),
        this.setInput(OBS_INPUTS.timer, { text: String(session.timer.remainingSeconds).padStart(2, '0') }),
        this.setInput(OBS_INPUTS.score.escape, { text: String(session.score?.escape || 0) }),
        this.setInput(OBS_INPUTS.score.hunter, { text: String(session.score?.hunter || 0) })
      ];
      if (session.commentatorImage?.filePath) {
        updates.push(this.setInput(OBS_INPUTS.commentatorImage, {
          file: this.assetPath(session.commentatorImage.filePath).replaceAll('\\', '/')
        }));
      }
      for (const [slotId, config] of Object.entries(SLOT_CONFIG)) {
        const slot = session.slots[slotId];
        updates.push(this.setInput(config.imageSource, { file: this.characterFile(config.kind, slot.characterId) }));
        if (config.textSource) updates.push(this.setInput(config.textSource, { text: this.playerNickname(session, slotId) }));
      }
      await Promise.all(updates);
    });
  }
}

module.exports = { ObsController, SerialQueue };
