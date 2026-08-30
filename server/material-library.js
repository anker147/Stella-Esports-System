const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { db, withTransaction } = require('./db');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pathKey(filePath) {
  return path.resolve(filePath).toLocaleLowerCase('en-US');
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isFilesystemRoot(inputPath) {
  const resolved = path.resolve(inputPath);
  return pathKey(resolved) === pathKey(path.parse(resolved).root);
}

function validName(name) {
  const value = String(name || '').trim();
  assert(value.length > 0 && value.length <= 255, '名称必须为1到255个字符');
  assert(!/[<>:"/\\|?*\u0000-\u001f]/.test(value), '名称包含Windows不允许的字符');
  assert(value !== '.' && value !== '..' && !/[. ]$/.test(value), '名称不能以点或空格结尾');
  return value;
}

class MaterialLibrary {
  constructor({ storePath = null } = {}) {
    this.lastSyncAt = 0;
    this.store = this.loadStore();
    if (this.migrated) this.persist();
  }

  emptyStore() {
    return { schemaVersion: 2, entries: {}, watchedFolders: [], excludedPaths: [] };
  }

  loadStore() {
    try {
      const entryRows = db.prepare('SELECT * FROM material_entries').all();
      const entries = {};
      for (const row of entryRows) {
        entries[row.id] = { id: row.id, path: row.path, kind: row.kind, addedAt: row.added_at };
      }
      const store = {
        schemaVersion: 2,
        entries,
        watchedFolders: db.prepare('SELECT path FROM material_watched_folders').all().map(row => row.path),
        excludedPaths: db.prepare('SELECT path FROM material_excluded_paths').all().map(row => row.path)
      };
      store.watchedFolders = Array.isArray(store.watchedFolders) ? store.watchedFolders : [];
      store.excludedPaths = Array.isArray(store.excludedPaths) ? store.excludedPaths : [];
      return this.removeUnsafeWatchedRoots(store);
    } catch (error) {
      throw new Error(`素材库索引读取失败: ${error.message}`);
    }
  }

  removeUnsafeWatchedRoots(store) {
    const unsafeRoots = store.watchedFolders.filter(isFilesystemRoot);
    if (!unsafeRoots.length) return store;
    store.watchedFolders = store.watchedFolders.filter(root => !isFilesystemRoot(root));
    for (const [id, entry] of Object.entries(store.entries)) {
      if (unsafeRoots.some(root => isInside(entry.path, root))) delete store.entries[id];
    }
    store.excludedPaths = store.excludedPaths.filter(excluded => (
      !unsafeRoots.some(root => isInside(excluded, root))
    ));
    this.migrated = true;
    return store;
  }

  persist() {
    withTransaction(() => {
      db.prepare('DELETE FROM material_entries').run();
      db.prepare('DELETE FROM material_watched_folders').run();
      db.prepare('DELETE FROM material_excluded_paths').run();
      const insertEntry = db.prepare('INSERT INTO material_entries (id, path, kind, added_at) VALUES (?, ?, ?, ?)');
      for (const entry of Object.values(this.store.entries)) {
        insertEntry.run(entry.id, entry.path, entry.kind, entry.addedAt ?? 0);
      }
      const insertFolder = db.prepare('INSERT INTO material_watched_folders (path) VALUES (?)');
      for (const folder of this.store.watchedFolders) insertFolder.run(folder);
      const insertExcluded = db.prepare('INSERT INTO material_excluded_paths (path) VALUES (?)');
      for (const excluded of this.store.excludedPaths) insertExcluded.run(excluded);
    });
  }

  entry(id) {
    const entry = this.store.entries[id];
    assert(entry, '素材不存在或已从索引移除');
    return entry;
  }

  describe(entry) {
    let stat = null;
    try {
      stat = fs.statSync(entry.path);
    } catch {}
    const kind = stat?.isDirectory() ? 'directory' : entry.kind;
    return {
      ...clone(entry),
      name: path.basename(entry.path),
      extension: kind === 'file' ? path.extname(entry.path).slice(1).toLocaleLowerCase('en-US') : '',
      kind,
      exists: Boolean(stat),
      size: stat?.isFile() ? stat.size : null,
      modifiedAt: stat?.mtimeMs || null
    };
  }

  list({ forceSync = false } = {}) {
    this.syncWatchedFolders({ force: forceSync });
    return Object.values(this.store.entries)
      .map(entry => this.describe(entry))
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
        return left.path.localeCompare(right.path, 'zh-CN', { numeric: true });
      });
  }

  walk(inputPath) {
    const root = path.resolve(inputPath);
    const rootStat = fs.statSync(root);
    const result = [{ path: root, kind: rootStat.isDirectory() ? 'directory' : 'file' }];
    if (!rootStat.isDirectory()) return result;
    const pending = [root];
    while (pending.length) {
      const directory = pending.pop();
      let children;
      try {
        children = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const item of children) {
        const itemPath = path.join(directory, item.name);
        if (item.isSymbolicLink()) continue;
        if (item.isDirectory()) {
          result.push({ path: itemPath, kind: 'directory' });
          pending.push(itemPath);
        } else if (item.isFile()) {
          result.push({ path: itemPath, kind: 'file' });
        }
      }
    }
    return result;
  }

  isExcluded(candidatePath) {
    return this.store.excludedPaths.some(excludedPath => isInside(candidatePath, excludedPath));
  }

  syncWatchedFolders({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - this.lastSyncAt < 1500) return false;
    this.lastSyncAt = now;
    const activeRoots = this.store.watchedFolders.filter(root => {
      if (isFilesystemRoot(root)) return false;
      try {
        return fs.statSync(root).isDirectory();
      } catch {
        return false;
      }
    });
    if (!activeRoots.length) return false;

    const actual = new Map();
    for (const root of activeRoots) {
      for (const item of this.walk(root)) {
        if (!this.isExcluded(item.path)) actual.set(pathKey(item.path), item);
      }
    }

    const existing = new Map(Object.values(this.store.entries).map(entry => [pathKey(entry.path), entry]));
    let changed = false;
    for (const [key, item] of actual) {
      const entry = existing.get(key);
      if (entry) {
        if (entry.kind !== item.kind) {
          entry.kind = item.kind;
          changed = true;
        }
        continue;
      }
      const next = { id: crypto.randomUUID(), path: item.path, kind: item.kind, addedAt: now };
      this.store.entries[next.id] = next;
      changed = true;
    }

    for (const entry of Object.values(this.store.entries)) {
      if (!activeRoots.some(root => isInside(entry.path, root))) continue;
      if (actual.has(pathKey(entry.path))) continue;
      delete this.store.entries[entry.id];
      changed = true;
    }
    if (changed) this.persist();
    return changed;
  }

  addPaths(inputPaths) {
    const paths = [...new Set((inputPaths || []).filter(Boolean).map(item => path.resolve(item)))];
    assert(paths.length > 0, '没有选择文件或文件夹');
    const existing = new Map(Object.values(this.store.entries).map(entry => [pathKey(entry.path), entry]));
    let added = 0;
    let skipped = 0;
    let changed = false;
    const roots = [];
    for (const inputPath of paths) {
      assert(fs.existsSync(inputPath), `路径不存在: ${inputPath}`);
      const inputStat = fs.statSync(inputPath);
      assert(!(inputStat.isDirectory() && isFilesystemRoot(inputPath)), '不能导入整个磁盘，请选择具体的素材包文件夹');
      roots.push(inputPath);
      if (inputStat.isDirectory()) {
        this.store.watchedFolders = this.store.watchedFolders
          .filter(root => !isInside(root, inputPath));
        if (!this.store.watchedFolders.some(root => isInside(inputPath, root))) {
          this.store.watchedFolders.push(inputPath);
        }
        changed = true;
      }
      const exclusionsBefore = this.store.excludedPaths.length;
      this.store.excludedPaths = this.store.excludedPaths.filter(excluded => (
        !isInside(inputPath, excluded) && !isInside(excluded, inputPath)
      ));
      changed ||= exclusionsBefore !== this.store.excludedPaths.length;
      for (const item of this.walk(inputPath)) {
        const key = pathKey(item.path);
        if (existing.has(key)) {
          skipped += 1;
          continue;
        }
        const entry = {
          id: crypto.randomUUID(),
          path: item.path,
          kind: item.kind,
          addedAt: Date.now()
        };
        this.store.entries[entry.id] = entry;
        existing.set(key, entry);
        added += 1;
        changed = true;
      }
    }
    if (changed) this.persist();
    return { added, skipped, roots, entries: this.list() };
  }

  createDocument(directoryPath, name) {
    const rawDirectory = String(directoryPath || '').trim();
    assert(rawDirectory.length > 0, '请选择保存文件夹');
    const directory = path.resolve(rawDirectory);
    assert(path.isAbsolute(directory) && fs.statSync(directory).isDirectory(), '请选择有效的保存文件夹');
    const fileName = validName(name);
    const filePath = path.join(directory, fileName);
    assert(!fs.existsSync(filePath), '同名文件已经存在');
    const handle = fs.openSync(filePath, 'wx');
    fs.closeSync(handle);
    const result = this.addPaths([filePath]);
    return { entry: result.entries.find(entry => pathKey(entry.path) === pathKey(filePath)), entries: result.entries };
  }

  rename(id, nextName) {
    const entry = this.entry(id);
    assert(fs.existsSync(entry.path), '文件或文件夹已经不存在');
    const name = validName(nextName);
    const oldPath = entry.path;
    const nextPath = path.join(path.dirname(oldPath), name);
    assert(pathKey(nextPath) !== pathKey(oldPath), '新名称与当前名称相同');
    assert(!fs.existsSync(nextPath), '目标名称已经存在');
    fs.renameSync(oldPath, nextPath);
    for (const candidate of Object.values(this.store.entries)) {
      if (!isInside(candidate.path, oldPath)) continue;
      const relative = path.relative(oldPath, candidate.path);
      candidate.path = relative ? path.join(nextPath, relative) : nextPath;
    }
    this.store.watchedFolders = this.store.watchedFolders.map(root => {
      if (!isInside(root, oldPath)) return root;
      const relative = path.relative(oldPath, root);
      return relative ? path.join(nextPath, relative) : nextPath;
    });
    this.store.excludedPaths = this.store.excludedPaths.map(excluded => {
      if (!isInside(excluded, oldPath)) return excluded;
      const relative = path.relative(oldPath, excluded);
      return relative ? path.join(nextPath, relative) : nextPath;
    });
    this.persist();
    return { entry: this.describe(this.entry(id)), entries: this.list() };
  }

  remove(id, mode) {
    return this.removeMany([id], mode);
  }

  removeMany(ids, mode) {
    assert(mode === 'index' || mode === 'filesystem', '删除方式无效');
    const selected = [...new Set(ids || [])].map(id => this.entry(id));
    assert(selected.length > 0, '请选择要删除的素材');
    const roots = selected.filter(entry => !selected.some(candidate => (
      candidate.id !== entry.id && isInside(entry.path, candidate.path)
    )));
    const affected = Object.values(this.store.entries)
      .filter(candidate => roots.some(root => isInside(candidate.path, root.path)));
    if (mode === 'filesystem') {
      for (const root of roots) {
        if (!fs.existsSync(root.path)) continue;
        const stat = fs.statSync(root.path);
        if (stat.isDirectory()) fs.rmSync(root.path, { recursive: true, force: false });
        else fs.unlinkSync(root.path);
      }
    }
    this.store.watchedFolders = this.store.watchedFolders
      .filter(watched => !roots.some(root => isInside(watched, root.path)));
    if (mode === 'index') {
      for (const root of roots) {
        const stillWatched = this.store.watchedFolders.some(watched => isInside(root.path, watched));
        if (stillWatched && !this.store.excludedPaths.some(excluded => pathKey(excluded) === pathKey(root.path))) {
          this.store.excludedPaths.push(root.path);
        }
      }
    }
    for (const candidate of affected) delete this.store.entries[candidate.id];
    this.persist();
    return { removed: affected.length, selected: selected.length, mode, entries: this.list() };
  }
}

module.exports = { MaterialLibrary, isFilesystemRoot, isInside, validName };
