const assert = require('node:assert/strict');
const test = require('node:test');
const { ObsWebSocketClient } = require('./obs-websocket');

test('OBS status reports remembered credentials without exposing the password', () => {
  const client = new ObsWebSocketClient({ url: 'ws://127.0.0.1:4455', password: 'secret' });
  const status = client.status();
  assert.equal(status.url, 'ws://127.0.0.1:4455');
  assert.equal(status.passwordSaved, true);
  assert.equal('password' in status, false);
});
