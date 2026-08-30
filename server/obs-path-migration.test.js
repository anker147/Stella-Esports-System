const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-db-obs-path-'));
process.env.STELLA_DB_PATH = path.join(dbDir, 'test.db');
const { ObsPathMigration, findRootedPaths, relativeFromRoot } = require('./obs-path-migration');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeObsClient {
  constructor(inputs) {
    this.connected = true;
    this.inputs = clone(inputs);
    this.filters = {};
    this.failInput = null;
  }

  async request(type, data = {}) {
    if (type === 'GetInputList') {
      return { inputs: Object.keys(this.inputs).map(inputName => ({ inputName, inputKind: 'image_source' })) };
    }
    if (type === 'GetInputSettings') {
      return { inputKind: 'image_source', inputSettings: clone(this.inputs[data.inputName]) };
    }
    if (type === 'SetInputSettings') {
      if (this.failInput === data.inputName) throw new Error('simulated write failure');
      this.inputs[data.inputName] = clone(data.inputSettings);
      return {};
    }
    if (type === 'GetSourceFilterList') return { filters: clone(this.filters[data.sourceName] || []) };
    if (type === 'GetSourceFilter') {
      const filter = (this.filters[data.sourceName] || []).find(item => item.filterName === data.filterName);
      return { filterSettings: clone(filter?.filterSettings || {}) };
    }
    if (type === 'SetSourceFilterSettings') {
      const filter = (this.filters[data.sourceName] || []).find(item => item.filterName === data.filterName);
      filter.filterSettings = clone(data.filterSettings);
      return {};
    }
    throw new Error(`Unexpected OBS request: ${type}`);
  }
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-obs-path-'));
  const canonicalRoot = path.join(directory, 'development-package');
  const targetRoot = path.join(directory, 'portable-package');
  fs.mkdirSync(path.join(canonicalRoot, 'images'), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, 'images'), { recursive: true });
  fs.writeFileSync(path.join(canonicalRoot, 'images', 'board.png'), 'old');
  fs.writeFileSync(path.join(canonicalRoot, 'images', 'stage.png'), 'old');
  fs.writeFileSync(path.join(targetRoot, 'images', 'board.png'), 'new');
  fs.writeFileSync(path.join(targetRoot, 'images', 'stage.png'), 'new');
  const folder = { id: 'folder-1', path: targetRoot, kind: 'directory', name: path.basename(targetRoot), exists: true };
  const materialLibrary = {
    list: () => [folder],
    entry: id => {
      if (id !== folder.id) throw new Error('not found');
      return folder;
    }
  };
  const client = new FakeObsClient({
    Board: { file: path.join(canonicalRoot, 'images', 'board.png'), nested: { untouched: 'value' } },
    Stage: { playlist: [{ value: path.join(canonicalRoot, 'images', 'stage.png') }] }
  });
  const obsController = { runOperation: async (_label, task) => task() };
  const migration = new ObsPathMigration({
    client,
    obsController,
    materialLibrary,
    canonicalRoot,
    storePath: path.join(directory, 'migration.json')
  });
  return { directory, canonicalRoot, targetRoot, folder, client, migration };
}

test('recursive path discovery only includes absolute paths below the canonical root', () => {
  const root = 'E:\\package';
  const found = findRootedPaths({ file: 'E:/package/a.png', values: [{ path: 'D:\\other\\a.png' }] }, root);
  assert.equal(found.length, 1);
  assert.equal(found[0].settingPath, 'file');
  assert.equal(found[0].relative, 'a.png');
  assert.equal(relativeFromRoot('E:\\package-two\\a.png', root), null);
});

test('validation maps every OBS field by relative path and reports no missing files', async t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.directory, { recursive: true, force: true }));
  const result = await fx.migration.validate(fx.folder.id);
  assert.equal(result.valid, true);
  assert.equal(result.referenceCount, 2);
  assert.equal(result.objectCount, 2);
  assert.equal(result.records[0].after.startsWith(fx.targetRoot), true);
});

test('validation blocks synchronization when a relative target is missing', async t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.directory, { recursive: true, force: true }));
  fs.unlinkSync(path.join(fx.targetRoot, 'images', 'stage.png'));
  const result = await fx.migration.validate(fx.folder.id);
  assert.equal(result.valid, false);
  assert.equal(result.missingCount, 1);
  await assert.rejects(() => fx.migration.sync(fx.folder.id), /缺少 1 个/);
});

test('successful synchronization persists changed fields and can be rolled back', async t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.directory, { recursive: true, force: true }));
  const synced = await fx.migration.sync(fx.folder.id);
  assert.equal(synced.changedCount, 2);
  assert.equal(fx.client.inputs.Board.file, path.join(fx.targetRoot, 'images', 'board.png'));
  assert.equal(fx.client.inputs.Board.nested.untouched, 'value');
  assert.equal((await fx.migration.rollbackCheck()).available, true);
  const rolledBack = await fx.migration.rollback();
  assert.equal(rolledBack.changedCount, 2);
  assert.equal(fx.client.inputs.Board.file, path.join(fx.canonicalRoot, 'images', 'board.png'));
  assert.equal(JSON.parse(require('./db').db.prepare("SELECT value_json FROM app_settings WHERE key = 'assetPaths.lastRollback'").get().value_json).syncTransactionId, synced.transaction.id);
});

test('a partial write failure automatically restores objects already changed', async t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.directory, { recursive: true, force: true }));
  fx.client.failInput = 'Stage';
  await assert.rejects(() => fx.migration.sync(fx.folder.id), /已自动恢复/);
  assert.equal(fx.client.inputs.Board.file, path.join(fx.canonicalRoot, 'images', 'board.png'));
  assert.equal(fx.client.inputs.Stage.playlist[0].value, path.join(fx.canonicalRoot, 'images', 'stage.png'));
});

test('rollback is blocked when an OBS setting was changed after synchronization', async t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.directory, { recursive: true, force: true }));
  await fx.migration.sync(fx.folder.id);
  fx.client.inputs.Board.file = 'C:\\manual-change.png';
  const check = await fx.migration.rollbackCheck();
  assert.equal(check.available, false);
  assert.equal(check.conflicts.length, 1);
  await assert.rejects(() => fx.migration.rollback(), /其他操作修改/);
});
