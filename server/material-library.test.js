const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-db-material-'));
process.env.STELLA_DB_PATH = path.join(dbDir, 'test.db');
const { db } = require('./db');
const { MaterialLibrary, isFilesystemRoot } = require('./material-library');

function clearMaterialTables() {
  db.exec('DELETE FROM material_entries; DELETE FROM material_watched_folders; DELETE FROM material_excluded_paths;');
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-material-test-'));
  clearMaterialTables();
  const files = path.join(directory, 'files');
  fs.mkdirSync(path.join(files, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(files, 'cover.png'), 'image');
  fs.writeFileSync(path.join(files, 'nested', 'notes.txt'), 'notes');
  const library = new MaterialLibrary();
  return { directory, files, library };
}

test('folder import stores every file and directory by absolute path', t => {
  const { directory, files, library } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = library.addPaths([files]);
  assert.equal(result.added, 4);
  assert.equal(library.list().every(entry => path.isAbsolute(entry.path)), true);
  assert.equal(library.list().filter(entry => entry.kind === 'file').length, 2);
  assert.equal(library.addPaths([files]).added, 0);
});

test('renaming an indexed folder updates every descendant path', t => {
  const { directory, files, library } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  library.addPaths([files]);
  const folder = library.list().find(entry => entry.path === files);
  library.rename(folder.id, 'renamed');
  assert.equal(library.list().every(entry => entry.path.includes(`${path.sep}renamed`)), true);
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

test('material pages return direct children, breadcrumbs, search and pagination metadata', t => {
  const { directory, files, library } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  library.addPaths([files]);

  const rootPage = library.listPage({ limit: 1 });
  assert.equal(rootPage.entries.length, 1);
  assert.equal(rootPage.entries[0].path, files);
  assert.equal(rootPage.entries[0].childCount, 2);
  assert.equal(rootPage.total, 1);
  assert.equal(rootPage.fileTotal, 2);
  assert.equal(rootPage.folderTotal, 2);
  assert.equal(rootPage.hasMore, false);

  const filesPage = library.listPage({ directoryId: rootPage.entries[0].id, limit: 1 });
  assert.equal(filesPage.total, 2);
  assert.equal(filesPage.entries.length, 1);
  assert.equal(filesPage.hasMore, true);
  assert.deepEqual(filesPage.breadcrumbs.map(entry => entry.name), ['files']);

  const secondPage = library.listPage({ directoryId: rootPage.entries[0].id, offset: 1, limit: 1 });
  assert.equal(secondPage.offset, 1);
  assert.equal(secondPage.entries.length, 1);
  assert.equal(secondPage.hasMore, false);

  const nested = library.list().find(entry => entry.name === 'nested');
  const nestedPage = library.listPage({ directoryId: nested.id });
  assert.deepEqual(nestedPage.breadcrumbs.map(entry => entry.name), ['files', 'nested']);
  assert.deepEqual(nestedPage.entries.map(entry => entry.name), ['notes.txt']);

  const searchPage = library.listPage({ query: 'notes', limit: 1 });
  assert.equal(searchPage.total, 1);
  assert.equal(searchPage.entries[0].name, 'notes.txt');
});

test('startup removes unsafe drive watchers and their indexed descendants', t => {
  clearMaterialTables();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-material-root-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const driveRoot = path.parse(directory).root;
  db.prepare('INSERT INTO material_entries (id, path, kind, added_at) VALUES (?, ?, ?, ?)')
    .run('root', driveRoot, 'directory', 1);
  db.prepare('INSERT INTO material_entries (id, path, kind, added_at) VALUES (?, ?, ?, ?)')
    .run('child', path.join(directory, 'asset.png'), 'file', 1);
  db.prepare('INSERT INTO material_watched_folders (path) VALUES (?)').run(driveRoot);
  db.prepare('INSERT INTO material_excluded_paths (path) VALUES (?)').run(path.join(directory, 'excluded'));

  const library = new MaterialLibrary();
  assert.deepEqual(library.store.watchedFolders, []);
  assert.deepEqual(library.store.excludedPaths, []);
  assert.deepEqual(library.store.entries, {});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM material_watched_folders').get().n, 0);
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
