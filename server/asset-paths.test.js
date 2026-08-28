const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('packaged asset paths resolve only below the synchronized material root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-assets-'));
  const data = path.join(root, 'data');
  const assets = path.join(root, 'assets');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(data, 'obs-path-migration.json'), JSON.stringify({
    schemaVersion: 1,
    canonicalRoot: 'E:\\2026追风杯',
    lastSuccessfulSync: { targetRoot: assets, rolledBackAt: null }
  }));
  const previous = process.env.STELLA_DATA_DIR;
  process.env.STELLA_DATA_DIR = data;
  const modulePath = require.resolve('./asset-paths');
  delete require.cache[modulePath];
  const assetPaths = require('./asset-paths');
  try {
    assert.equal(assetPaths.resolveAssetPath('场景底图/晋级图/a.png'), path.join(assets, '场景底图', '晋级图', 'a.png'));
    assert.throws(() => assetPaths.resolveAssetPath('../outside.png'), /相对路径无效|越界/);
    assert.throws(() => assetPaths.resolveAssetPath('C:\\outside.png'), /不属于当前素材包/);
  } finally {
    if (previous === undefined) delete process.env.STELLA_DATA_DIR;
    else process.env.STELLA_DATA_DIR = previous;
    delete require.cache[modulePath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('packaged asset paths fail closed before a successful synchronization', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-assets-empty-'));
  fs.writeFileSync(path.join(root, 'obs-path-migration.json'), '{"schemaVersion":1}');
  const previous = process.env.STELLA_DATA_DIR;
  process.env.STELLA_DATA_DIR = root;
  const modulePath = require.resolve('./asset-paths');
  delete require.cache[modulePath];
  try { assert.throws(() => require('./asset-paths').resolveAssetPath('角色/Pick/占位.png'), /尚未确认素材包路径/); }
  finally {
    if (previous === undefined) delete process.env.STELLA_DATA_DIR;
    else process.env.STELLA_DATA_DIR = previous;
    delete require.cache[modulePath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});
