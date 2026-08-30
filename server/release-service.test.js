const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { readReleaseData } = require('./release-service');

test('project update log has a valid current version and ordered releases', () => {
  const data = readReleaseData();
  assert.equal(data.currentVersion, '1.9.3');
  assert.equal(data.releases[0].version, data.currentVersion);
  assert.equal(data.releases.length >= 10, true);
});

test('update log rejects a current version missing from the first release', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-release-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'update-log.json');
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 1,
    product: 'Test',
    currentVersion: '2.0.0',
    releases: [{ version: '1.0.0', title: 'Initial', changes: { Added: ['A'] } }]
  }));
  assert.throws(() => readReleaseData(filePath), /首项/);
});
