const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MaterialLibrary, isFilesystemRoot } = require('./material-library');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-material-test-'));
  const files = path.join(directory, 'files');
  fs.mkdirSync(path.join(files, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(files, 'cover.png'), 'image');
  fs.writeFileSync(path.join(files, 'nested', 'notes.txt'), 'notes');
  const library = new MaterialLibrary({ storePath: path.join(directory, 'index.json') });
  return { directory, files, library };
}

test('folder import stores every file and directory by absolute path', t => {
  const { directory, files, library } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = library.addPaths([files]);
  assert.equal(result.added, 4);
  assert.equal(result.entries.every(entry => path.isAbsolute(entry.path)), true);
  assert.equal(result.entries.filter(entry => entry.kind === 'file').length, 2);
  assert.equal(library.addPaths([files]).added, 0);
});

test('renaming an indexed folder updates every descendant path', t => {
  const { directory, files, library } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  library.addPaths([files]);
  const folder = library.list().find(entry => entry.path === files);
  const result = library.rename(folder.id, 'renamed');
  assert.equal(result.entries.every(entry => entry.path.includes(`${path.sep}renamed`)), true);
  assert.equal(fs.existsSync(path.join(directory, 'renamed', 'nested', 'notes.txt')), true);
});

test('index-only removal keeps files while filesystem removal deletes them', t => {
  const { directory, files, library } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  library.addPaths([files]);
  const image = library.list().find(entry => entry.name === 'cover.png');
  library.remove(image.id, 'index');
  assert.equal(fs.existsSync(image.path), true);

  library.addPaths([image.path]);
  const imported = library.list().find(entry => entry.name === 'cover.png');
  library.remove(imported.id, 'filesystem');
  assert.equal(fs.existsSync(image.path), false);
});

test('new document is created in the selected directory and indexed', t => {
  const { directory, files, library } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = library.createDocument(files, 'runbook.md');
  assert.equal(result.entry.name, 'runbook.md');
  assert.equal(fs.existsSync(path.join(files, 'runbook.md')), true);
  assert.throws(() => library.createDocument(files, '../outside.txt'), /不允许的字符/);
});

test('bulk index removal keeps source files and collapses selected descendants', t => {
  const { directory, files, library } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  library.addPaths([files]);
  const folder = library.list().find(entry => entry.path === files);
  const image = library.list().find(entry => entry.name === 'cover.png');
  const result = library.removeMany([folder.id, image.id], 'index');
  assert.equal(result.selected, 2);
  assert.equal(result.removed, 4);
  assert.equal(library.list().length, 0);
  assert.equal(fs.existsSync(image.path), true);
});

test('watched folders synchronize external additions renames and removals', t => {
  const { directory, files, library } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  library.addPaths([files]);
  const external = path.join(files, 'external.psd');
  fs.writeFileSync(external, 'psd');
  assert.equal(library.list({ forceSync: true }).some(entry => entry.path === external), true);

  const renamed = path.join(files, 'renamed.psd');
  fs.renameSync(external, renamed);
  const afterRename = library.list({ forceSync: true });
  assert.equal(afterRename.some(entry => entry.path === external), false);
  assert.equal(afterRename.some(entry => entry.path === renamed), true);

  fs.unlinkSync(renamed);
  assert.equal(library.list({ forceSync: true }).some(entry => entry.path === renamed), false);
});

test('index-only removal inside a watched folder remains excluded', t => {
  const { directory, files, library } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  library.addPaths([files]);
  const image = library.list().find(entry => entry.name === 'cover.png');
  library.remove(image.id, 'index');
  assert.equal(library.list({ forceSync: true }).some(entry => entry.path === image.path), false);
  assert.equal(fs.existsSync(image.path), true);
});

test('schema version 1 infers top-level imported folders as watched roots', t => {
  const { directory, files } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storePath = path.join(directory, 'legacy.json');
  fs.writeFileSync(storePath, JSON.stringify({
    schemaVersion: 1,
    entries: {
      root: { id: 'root', path: files, kind: 'directory', addedAt: 1 },
      image: { id: 'image', path: path.join(files, 'cover.png'), kind: 'file', addedAt: 1 }
    }
  }));
  const library = new MaterialLibrary({ storePath });
  assert.deepEqual(library.store.watchedFolders, [files]);
  assert.equal(JSON.parse(fs.readFileSync(storePath, 'utf8')).schemaVersion, 2);
});

test('drive root imports are rejected before recursive indexing', t => {
  const { directory, library } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const driveRoot = path.parse(directory).root;
  assert.equal(isFilesystemRoot(driveRoot), true);
  assert.throws(() => library.addPaths([driveRoot]), /不能导入整个磁盘/);
  assert.equal(library.store.watchedFolders.length, 0);
  assert.equal(library.list().length, 0);
});

test('startup removes unsafe drive watchers and their indexed descendants', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-material-root-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const driveRoot = path.parse(directory).root;
  const storePath = path.join(directory, 'unsafe-index.json');
  fs.writeFileSync(storePath, JSON.stringify({
    schemaVersion: 2,
    entries: {
      root: { id: 'root', path: driveRoot, kind: 'directory', addedAt: 1 },
      child: { id: 'child', path: path.join(directory, 'asset.png'), kind: 'file', addedAt: 1 }
    },
    watchedFolders: [driveRoot],
    excludedPaths: [path.join(directory, 'excluded')]
  }));
  const library = new MaterialLibrary({ storePath });
  assert.deepEqual(library.store.watchedFolders, []);
  assert.deepEqual(library.store.excludedPaths, []);
  assert.deepEqual(library.store.entries, {});
  assert.deepEqual(JSON.parse(fs.readFileSync(storePath, 'utf8')).watchedFolders, []);
});
