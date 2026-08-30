const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
process.env.STELLA_DB_PATH = ':memory:';
const { ObsController } = require('./obs-controller');
const { createTournamentResolver, readAllData } = require('./tournament-data');

class MockClient extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.requests = [];
  }

  request(type, data) {
    this.requests.push({ type, data });
    return Promise.resolve({});
  }

  status() {
    return { connected: this.connected };
  }
}

test('OBS timer always uses two digits', async () => {
  const client = new MockClient();
  const controller = new ObsController({ client, resolver: createTournamentResolver() });
  await controller.setTimer(7);
  assert.equal(client.requests.at(-1).data.inputSettings.text, '07');
  await controller.setTimer(0);
  assert.equal(client.requests.at(-1).data.inputSettings.text, '00');
});

test('character output mode sends the selected character title', () => {
  const controller = new ObsController({ client: new MockClient(), resolver: createTournamentResolver() });
  const session = {
    matchId: 'mobile-2026-07-25-qf-1',
    room: 'A',
    outputMode: 'character',
    slots: { 'hunter-pick-1': { characterId: '机器人', playerId: 'feitongfanxiang:hunter1', playerText: null } }
  };
  assert.equal(controller.playerNickname(session, 'hunter-pick-1'), '机器人');
});

test('match metadata follows selected group and BO3 game', () => {
  const controller = new ObsController({ client: new MockClient(), resolver: createTournamentResolver() });
  assert.deepEqual(controller.matchMetadata({ matchId: 'mobile-2026-07-25-qf-2', gameNumber: 3 }), {
    division: '手游赛区',
    round: '第二轮',
    game: 'MATCH 3',
    info: '7-25 15:00 BO3'
  });
});

test('PC schedule metadata uses the selected tournament date and division', () => {
  const controller = new ObsController({ client: new MockClient(), resolver: createTournamentResolver(readAllData()) });
  assert.deepEqual(controller.matchMetadata({ matchId: 'pc-2026-07-26-qf-3', gameNumber: 2 }), {
    division: '端游赛区',
    round: '第三轮',
    game: 'MATCH 2',
    info: '7-26 16:00 BO3'
  });
});

test('mobile lower-bracket metadata follows the July 27 second round', () => {
  const controller = new ObsController({ client: new MockClient(), resolver: createTournamentResolver(readAllData()) });
  assert.deepEqual(controller.matchMetadata({ matchId: 'mobile-2026-07-27-qf-loser-2', gameNumber: 1 }), {
    division: '手游赛区',
    round: '第二轮',
    game: 'MATCH 1',
    info: '7-27 15:00 BO3'
  });
});

test('result sync writes score before the atomic result layers', async () => {
  const client = new MockClient();
  const controller = new ObsController({ client, resolver: createTournamentResolver() });
  await controller.syncResult({
    id: 'result-test',
    result: { winnerRole: 'escape' },
    score: { escape: 1, hunter: 0 }
  });
  const inputs = client.requests.filter(request => request.type === 'SetInputSettings');
  assert.deepEqual(inputs.slice(0, 2).map(request => request.data.inputName), ['逃生方比分', '追捕方比分']);
  assert.deepEqual(new Set(inputs.slice(2).map(request => request.data.inputName)), new Set(['逃生方战果', '追捕方战果', '战果文字']));
  assert(inputs.find(request => request.data.inputName === '战果文字').data.inputSettings.file.endsWith('/逃生者胜利文字图.png'));
});

test('scene switching selects the configured transition before the target scene', async () => {
  const client = new MockClient();
  const controller = new ObsController({ client, resolver: createTournamentResolver() });
  await controller.switchScene('bp');
  assert.deepEqual(client.requests.slice(-3), [
    { type: 'SetSceneSceneTransitionOverride', data: { sceneName: 'BP', transitionName: '2026追风杯', transitionDuration: 300 } },
    { type: 'SetCurrentSceneTransition', data: { transitionName: '2026追风杯' } },
    { type: 'SetCurrentProgramScene', data: { sceneName: 'BP' } }
  ]);
  await controller.switchScene('result');
  assert.equal(client.requests.at(-1).data.sceneName, '本场赛果');
  await controller.switchScene('bracket');
  assert.equal(client.requests.at(-1).data.sceneName, '晋级榜');
});

test('console scene push preserves the transition configured in OBS', async () => {
  const client = new MockClient();
  const controller = new ObsController({ client, resolver: createTournamentResolver() });
  await controller.pushScene('本场赛果');
  assert.deepEqual(client.requests, [
    { type: 'SetCurrentProgramScene', data: { sceneName: '本场赛果' } }
  ]);
});

test('commentator image sync updates the fixed OBS image source', async () => {
  const client = new MockClient();
  const controller = new ObsController({ client, resolver: createTournamentResolver() });
  await controller.syncCommentatorImage('E:\\commentators\\十三香组合.png');
  assert.deepEqual(client.requests.at(-1), {
    type: 'SetInputSettings',
    data: { inputName: '解说头像', inputSettings: { file: 'E:/commentators/十三香组合.png' }, overlay: true }
  });
});

test('commentator logo and codes switch through the shared image staging source', async () => {
  const client = new MockClient();
  client.request = function (type, data) {
    this.requests.push({ type, data });
    if (type === 'GetSceneItemId') return Promise.resolve({ sceneItemId: 31 });
    return Promise.resolve({});
  };
  const controller = new ObsController({
    client,
    resolver: createTournamentResolver(),
    transitionMs: 0
  });
  await controller.syncCommentatorLogo('E:\\commentators\\codes\\0803.png');
  assert.deepEqual(client.requests, [
    {
      type: 'SetInputSettings',
      data: { inputName: '暗T', inputSettings: { file: 'E:/commentators/codes/0803.png' }, overlay: true }
    },
    {
      type: 'GetSceneItemId',
      data: { sceneName: '解说席底板', sourceName: '解说LOGO' }
    },
    {
      type: 'SetSceneItemEnabled',
      data: { sceneName: '解说席底板', sceneItemId: 31, sceneItemEnabled: false }
    },
    {
      type: 'SetInputSettings',
      data: { inputName: '解说LOGO', inputSettings: { file: 'E:/commentators/codes/0803.png' }, overlay: true }
    },
    {
      type: 'SetSceneItemEnabled',
      data: { sceneName: '解说席底板', sceneItemId: 31, sceneItemEnabled: true }
    }
  ]);
});

test('schedule sync updates both pre-match and schedule-scene image sources', async () => {
  const client = new MockClient();
  const controller = new ObsController({ client, resolver: createTournamentResolver() });
  await controller.syncScheduleImage('E:\\assets\\pre-match.png');
  await controller.syncScheduleTableImage('E:\\assets\\schedule.png');
  assert.deepEqual(client.requests.slice(-2).map(request => ({
    inputName: request.data.inputName,
    file: request.data.inputSettings.file
  })), [
    { inputName: '今日对战图', file: 'E:/assets/pre-match.png' },
    { inputName: '今日赛程表', file: 'E:/assets/schedule.png' }
  ]);
});

test('dynamic BP browser source is configured behind a disable-first guard', async () => {
  const client = new MockClient();
  client.request = function (type, data) {
    this.requests.push({ type, data });
    if (type === 'GetSceneItemId') return Promise.resolve({ sceneItemId: 78 });
    return Promise.resolve({});
  };
  const controller = new ObsController({ client, resolver: createTournamentResolver() });
  await controller.configureBpOverlay({ url: 'http://127.0.0.1:3788/bp-overlay.html', enabled: true });
  assert.deepEqual(client.requests, [
    { type: 'GetSceneItemId', data: { sceneName: 'BP', sourceName: 'BP动态底板' } },
    { type: 'SetSceneItemEnabled', data: { sceneName: 'BP', sceneItemId: 78, sceneItemEnabled: false } },
    {
      type: 'SetInputSettings',
      data: {
        inputName: 'BP动态底板',
        inputSettings: {
          url: 'http://127.0.0.1:3788/bp-overlay.html', width: 1920, height: 1080,
          reroute_audio: false, restart_when_active: false, shutdown: false
        },
        overlay: true
      }
    },
    {
      type: 'PressInputPropertiesButton',
      data: { inputName: 'BP动态底板', propertyName: 'refreshnocache' }
    },
    { type: 'SetSceneItemEnabled', data: { sceneName: 'BP', sceneItemId: 78, sceneItemEnabled: true } }
  ]);
  await controller.configureBpOverlay({ url: 'http://127.0.0.1:3788/bp-overlay.html', enabled: false });
  assert.equal(client.requests.at(-1).data.inputName, 'BP动态底板');
  assert.equal(client.requests.filter(item => item.type === 'SetSceneItemEnabled').at(-1).data.sceneItemEnabled, false);
});

test('scene catalog and custom transition are exposed for console controls', async () => {
  const client = new MockClient();
  client.request = function (type, data) {
    this.requests.push({ type, data });
    if (type === 'GetSceneList') return Promise.resolve({
      currentProgramSceneName: 'BP',
      scenes: [{ sceneName: 'BP' }, { sceneName: '本场赛果' }]
    });
    if (type === 'GetSceneTransitionList') return Promise.resolve({
      currentSceneTransitionName: '淡入淡出',
      transitions: [{ transitionName: '淡入淡出' }, { transitionName: '2026追风杯' }]
    });
    return Promise.resolve({});
  };
  const controller = new ObsController({ client, resolver: createTournamentResolver() });

  assert.deepEqual(await controller.sceneCatalog(), {
    currentScene: 'BP',
    currentTransition: '淡入淡出',
    scenes: ['BP', '本场赛果'],
    transitions: ['淡入淡出', '2026追风杯']
  });
  await controller.switchScene('本场赛果', '淡入淡出');
  assert.deepEqual(client.requests.slice(-3), [
    { type: 'SetSceneSceneTransitionOverride', data: { sceneName: '本场赛果', transitionName: '淡入淡出', transitionDuration: 300 } },
    { type: 'SetCurrentSceneTransition', data: { transitionName: '淡入淡出' } },
    { type: 'SetCurrentProgramScene', data: { sceneName: '本场赛果' } }
  ]);
});

test('match sync updates the mapped stage image', async () => {
  const client = new MockClient();
  const controller = new ObsController({ client, resolver: createTournamentResolver(readAllData()) });
  await controller.syncMatch({ matchId: 'pc-2026-08-01-sf-winner-1', room: 'A', gameNumber: 1 });
  const stage = client.requests.find(request => request.type === 'SetInputSettings' && request.data.inputName === '比赛阶段');
  assert(stage.data.inputSettings.file.endsWith('/BP/胜者组.png'));
});
