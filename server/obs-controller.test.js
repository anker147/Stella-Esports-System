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
