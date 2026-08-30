const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
process.env.STELLA_DB_PATH = ':memory:';
const { db } = require('./db');
const { invalidateAssetRootCache, resolveAssetPath } = require('./asset-paths');

function seedSync(targetRoot) {
  db.prepare('DELETE FROM asset_path_syncs').run();
  db.prepare(`INSERT INTO asset_path_syncs (id, folder_id, target_root, canonical_root, synced_at, rolled_back_at)
    VALUES ('sync-test', NULL, ?, ?, ?, NULL)`).run(targetRoot, targetRoot, new Date().toISOString());
  invalidateAssetRootCache();
}

test('packaged asset paths resolve only below the synchronized material root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-assets-'));
  const assets = path.join(root, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  seedSync(assets);
  try {
    assert.equal(resolveAssetPath('场景底图/晋级图/a.png'), path.join(assets, '场景底图', '晋级图', 'a.png'));
    assert.throws(() => resolveAssetPath('../outside.png'), /相对路径无效|越界/);
    assert.throws(() => resolveAssetPath('C:\\outside.png'), /不属于当前素材包/);
  } finally {
    invalidateAssetRootCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('packaged asset paths fail closed before a successful synchronization', () => {
  db.prepare('DELETE FROM asset_path_syncs').run();
  invalidateAssetRootCache();
  const previous = process.env.STELLA_DATA_DIR;
  process.env.STELLA_DATA_DIR = path.join(os.tmpdir(), 'zfb-assets-empty');
  try {
    assert.throws(() => resolveAssetPath('角色/Pick/占位.png'), /尚未确认素材包路径/);
  } finally {
    if (previous === undefined) delete process.env.STELLA_DATA_DIR;
    else process.env.STELLA_DATA_DIR = previous;
    invalidateAssetRootCache();
  }
});
