const assert = require('node:assert/strict');
const test = require('node:test');
const { isGameScene, SceneMusicController } = require('./scene-music-controller');

test('game scene names are recognized', () => {
  assert.equal(isGameScene('游戏内'), true);
  assert.equal(isGameScene('游戏内.重构'), true);
  assert.equal(isGameScene('BP'), false);
});

test('scene changes play music in game and pause it outside game', async () => {
  let playing = false;
  const actions = [];
  const musicController = {
    async status() { return { available: true, playing }; },
    async action(type) {
      actions.push(type);
      playing = type === 'play';
      return { available: true, playing };
    }
  };
  const controller = new SceneMusicController({ musicController });

  await controller.setScene('游戏内.重构');
  await controller.setScene('BP');
  assert.deepEqual(actions, ['play', 'pause']);
});

test('scene music automation does not repeat an unchanged scene', async () => {
  const actions = [];
  const musicController = {
    async status() { return { available: true, playing: false }; },
    async action(type) { actions.push(type); }
  };
  const controller = new SceneMusicController({ musicController });

  await controller.setScene('赛事日历');
  await controller.setScene('赛事日历');
  assert.deepEqual(actions, ['pause']);
});
