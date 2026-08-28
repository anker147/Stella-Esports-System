const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { copyInitialFile } = require('./data-paths');

test('packaged data is initialized once and later upgrades preserve user changes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stella-data-paths-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const template = path.join(root, 'template.json');
  const target = path.join(root, 'user', 'state.json');
  fs.writeFileSync(template, '{"value":"template"}\n');
  copyInitialFile(target, [template], '{}\n');
  assert.equal(fs.readFileSync(target, 'utf8'), '{"value":"template"}\n');
  fs.writeFileSync(target, '{"value":"user"}\n');
  fs.writeFileSync(template, '{"value":"new-template"}\n');
  copyInitialFile(target, [template], '{}\n');
  assert.equal(fs.readFileSync(target, 'utf8'), '{"value":"user"}\n');
});

test('packaged data falls back to valid seed content when no template exists', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stella-data-fallback-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'nested', 'state.json');
  copyInitialFile(target, [], '{"ready":true}\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { ready: true });
});
