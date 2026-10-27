const { EventEmitter } = require('events');
const path = require('path');
const { CONFIG, OBS_INPUTS } = require('./bp-config');

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
  constructor({ client, resolver, transitionMs = 300, assetPath = value => value }) {
    super();
    this.client = client;
    this.resolver = resolver;
    this.transitionMs = transitionMs;
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

  // 在全部场景中定位源所在场景（取第一个命中的），返回 { sceneName, sceneItemId, sceneItemEnabled } 或 null
  async locateSource(sourceName) {
    const sceneResult = await this.client.request('GetSceneList');
    for (const scene of sceneResult.scenes || []) {
      try {
        const itemResult = await this.client.request('GetSceneItemList', { sceneName: scene.sceneName });
        const hit = (itemResult.sceneItems || []).find(item => item.sourceName === sourceName);
        if (hit) {
          return { sceneName: scene.sceneName, sceneItemId: hit.sceneItemId, sceneItemEnabled: Boolean(hit.sceneItemEnabled) };
        }
      } catch {}
    }
    return null;
  }

  async setSourceVisible(sourceName, enabled) {
    const located = await this.locateSource(sourceName);
    if (!located) throw new Error(`OBS 中未找到源：${sourceName}`);
    await this.client.request('SetSceneItemEnabled', {
      sceneName: located.sceneName,
      sceneItemId: located.sceneItemId,
      sceneItemEnabled: Boolean(enabled)
    });
    return { ...located, sceneItemEnabled: Boolean(enabled) };
  }

  async sourceVisible(sourceName) {
    return this.locateSource(sourceName);
  }

  runOperation(label, task, actor = null) {
    if (!this.client.connected && !this.client.connecting) {
      this.lastError = 'OBS 未连接';
      return Promise.reject(new Error('OBS 未连接，请先连接 OBS 后重试'));
    }
    return this.queue.add(async () => {
      try {
        const result = await task();
        this.lastError = null;
        this.emit('operation', { label, ok: true, timestamp: Date.now(), actor });
        return result;
      } catch (error) {
        this.lastError = error.message;
        this.emit('operation', { label, ok: false, error: error.message, timestamp: Date.now(), actor });
        throw error;
      }
    });
  }

  syncCountdownUrl(url) {
    if (!this.client.connected || !url) return Promise.resolve();
    return this.setInput(OBS_INPUTS.countdownBrowser, { url });
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
}

module.exports = { ObsController, SerialQueue };
