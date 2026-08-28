const assert = require('node:assert/strict');
const test = require('node:test');
const { MusicController } = require('./music-controller');

test('music status is cached and media actions refresh state', async () => {
  const calls = [];
  const controller = new MusicController({
    cacheMs: 5000,
    runner: async action => {
      calls.push(action);
      return { available: true, title: 'Test Song', artist: 'Test Artist', playing: action === 'toggle', volume: 62 };
    }
  });

  const first = await controller.status();
  const cached = await controller.status();
  const toggled = await controller.action('toggle');
  assert.equal(first.title, 'Test Song');
  assert.equal(cached.artist, 'Test Artist');
  assert.equal(toggled.playing, true);
  assert.deepEqual(calls, ['status', 'toggle']);
});

test('music volume is clamped and unavailable sessions are rejected', async () => {
  const values = [];
  const controller = new MusicController({ runner: async (action, value) => {
    values.push({ action, value });
    return { available: value !== 0, volume: value };
  } });

  const state = await controller.action('set-volume', 140);
  assert.equal(state.volume, 100);
  assert.deepEqual(values[0], { action: 'set-volume', value: 100 });
  await assert.rejects(controller.action('set-volume', 0), /没有活动音频会话/);
});

test('previous and next reread track metadata after the media command', async () => {
  const calls = [];
  const controller = new MusicController({
    trackRefreshDelayMs: 0,
    runner: async action => {
      calls.push(action);
      return { available: true, title: action === 'status' ? 'New Song' : 'Old Song', playing: true };
    }
  });

  assert.equal((await controller.action('next')).title, 'New Song');
  assert.deepEqual(calls, ['next', 'status']);
});

test('window fallback keeps locally tracked play state between polls', async () => {
  const controller = new MusicController({
    cacheMs: 0,
    runner: async () => ({
      available: true,
      source: 'cloudmusic-window',
      title: 'Window Song',
      artist: 'Window Artist',
      playing: true,
      playbackStatus: 'unknown',
      volume: 50
    })
  });

  assert.equal((await controller.status()).playing, true);
  assert.equal((await controller.action('toggle')).playing, false);
  assert.equal((await controller.status({ force: true })).playing, false);
});
