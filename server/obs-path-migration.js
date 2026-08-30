const fs = require('node:fs');
const path = require('node:path');
const { db, withTransaction } = require('./db');
const { invalidateAssetRootCache } = require('./asset-paths');

const DEFAULT_CANONICAL_ROOT = 'E:\\2026追风杯';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readSetting(key, fallback = null) {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value_json); } catch { return fallback; }
}

function writeSetting(key, value) {
  db.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json')
    .run(key, JSON.stringify(value));
}

function pathKey(value) {
  return path.win32.resolve(String(value || '').replaceAll('/', '\\')).toLocaleLowerCase('en-US');
}

function pathEqual(left, right) {
  return pathKey(left) === pathKey(right);
}

function relativeFromRoot(value, root) {
  if (typeof value !== 'string' || !/^[a-z]:[\\/]/i.test(value)) return null;
  const relative = path.win32.relative(path.win32.resolve(root), path.win32.resolve(value.replaceAll('/', '\\')));
  if (relative === '' || (!relative.startsWith('..') && !path.win32.isAbsolute(relative))) return relative;
  return null;
}

function settingPath(tokens) {
  return tokens.map(token => typeof token === 'number' ? `[${token}]` : String(token).replaceAll('.', '\\.'))
    .reduce((result, token) => token.startsWith('[') ? `${result}${token}` : (result ? `${result}.${token}` : token), '');
}

function findRootedPaths(value, root, tokens = [], result = []) {
  if (typeof value === 'string') {
    const relative = relativeFromRoot(value, root);
    if (relative !== null) result.push({ tokens, settingPath: settingPath(tokens), value, relative });
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findRootedPaths(item, root, [...tokens, index], result));
    return result;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => findRootedPaths(item, root, [...tokens, key], result));
  }
  return result;
}

function getAt(target, tokens) {
  return tokens.reduce((value, token) => value?.[token], target);
}

function setAt(target, tokens, value) {
  assert(tokens.length > 0, 'OBS 设置字段路径无效');
  let cursor = target;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    cursor = cursor[tokens[index]];
    assert(cursor && typeof cursor === 'object', 'OBS 设置结构已经改变');
  }
  cursor[tokens.at(-1)] = value;
}

function transactionId(prefix) {
  return `${prefix}-${new Date().toISOString()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function mapLimit(items, limit, task) {
  const pending = [...items];
  const workers = Array.from({ length: Math.min(limit, pending.length) }, async () => {
    while (pending.length) await task(pending.shift());
  });
  await Promise.all(workers);
}

class ObsPathMigration {
  constructor({ client, obsController, materialLibrary, canonicalRoot = DEFAULT_CANONICAL_ROOT } = {}) {
    assert(client && obsController && materialLibrary, 'OBS 路径迁移服务缺少依赖');
    this.client = client;
    this.obsController = obsController;
    this.materialLibrary = materialLibrary;
    this.canonicalRoot = path.win32.resolve(canonicalRoot);
    this.state = this.loadState();
  }

  emptyState() {
    return {
      schemaVersion: 1,
      canonicalRoot: this.canonicalRoot,
      lastSelectedFolderId: null,
      lastValidation: null,
      lastSuccessfulSync: null,
      lastRollback: null,
      updatedAt: null
    };
  }

  loadState() {
    const state = this.emptyState();
    state.lastSelectedFolderId = readSetting('assetPaths.lastSelectedFolderId');
    state.lastRollback = readSetting('assetPaths.lastRollback');
    const validationRow = db.prepare(
      'SELECT * FROM asset_path_validation WHERE id = 1'
    ).get();
    if (validationRow) {
      state.lastValidation = {
        valid: Boolean(validationRow.valid),
        folderId: validationRow.folder_id,
        targetRoot: validationRow.target_root,
        canonicalRoot: validationRow.canonical_root,
        referenceCount: validationRow.reference_count,
        objectCount: validationRow.object_count,
        missingCount: validationRow.missing_count,
        records: JSON.parse(validationRow.records_json || '[]'),
        missing: JSON.parse(validationRow.missing_json || '[]'),
        checkedAt: validationRow.checked_at
      };
    }
    const syncRow = db.prepare(
      'SELECT * FROM asset_path_syncs ORDER BY rowid DESC LIMIT 1'
    ).get();
    if (syncRow) {
      const records = db.prepare(
        'SELECT * FROM asset_path_sync_records WHERE sync_id = ? ORDER BY rowid'
      ).all(syncRow.id).map(row => ({
        objectType: row.object_type,
        sourceName: row.source_name,
        ...(row.filter_name ? { filterName: row.filter_name } : {}),
        settingPath: row.setting_path,
        settingTokens: JSON.parse(row.setting_tokens_json || '[]'),
        before: row.before,
        after: row.after
      }));
      state.lastSuccessfulSync = {
        id: syncRow.id,
        folderId: syncRow.folder_id,
        targetRoot: syncRow.target_root,
        canonicalRoot: syncRow.canonical_root,
        records,
        syncedAt: syncRow.synced_at,
        rolledBackAt: syncRow.rolled_back_at
      };
    }
    return state;
  }

  persist() {
    this.state.updatedAt = new Date().toISOString();
    withTransaction(() => {
      writeSetting('assetPaths.canonicalRoot', this.canonicalRoot);
      writeSetting('assetPaths.lastSelectedFolderId', this.state.lastSelectedFolderId);
      writeSetting('assetPaths.lastRollback', this.state.lastRollback);
      db.prepare('DELETE FROM asset_path_validation').run();
      const validation = this.state.lastValidation;
      if (validation) {
        db.prepare(`INSERT INTO asset_path_validation
          (id, valid, folder_id, target_root, canonical_root, reference_count, object_count, missing_count, records_json, missing_json, checked_at)
          VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(validation.valid ? 1 : 0, validation.folderId || null, validation.targetRoot || null,
            validation.canonicalRoot || null, validation.referenceCount ?? 0, validation.objectCount ?? 0,
            validation.missingCount ?? 0, JSON.stringify(validation.records || []),
            JSON.stringify(validation.missing || []), validation.checkedAt || null);
      }
      const transaction = this.state.lastSuccessfulSync;
      if (transaction) {
        db.prepare(`INSERT INTO asset_path_syncs
          (id, folder_id, target_root, canonical_root, synced_at, rolled_back_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET
            folder_id = excluded.folder_id, target_root = excluded.target_root,
            canonical_root = excluded.canonical_root, synced_at = excluded.synced_at,
            rolled_back_at = excluded.rolled_back_at`)
          .run(transaction.id, transaction.folderId || null, transaction.targetRoot || '',
            transaction.canonicalRoot || '', transaction.syncedAt || new Date().toISOString(),
            transaction.rolledBackAt || null);
        db.prepare('DELETE FROM asset_path_sync_records WHERE sync_id = ?').run(transaction.id);
        const insertRecord = db.prepare(`INSERT INTO asset_path_sync_records
          (sync_id, object_type, source_name, filter_name, setting_path, setting_tokens_json, before, after)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const record of transaction.records || []) {
          insertRecord.run(transaction.id, record.objectType, record.sourceName,
            record.filterName || null, record.settingPath, JSON.stringify(record.settingTokens || []),
            record.before ?? null, record.after ?? null);
        }
      }
    });
    invalidateAssetRootCache();
  }

  indexedFolders() {
    return this.materialLibrary.list({ forceSync: true })
      .filter(entry => entry.kind === 'directory' && entry.exists)
      .map(entry => ({ id: entry.id, name: entry.name, path: entry.path }))
      .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN', { numeric: true }));
  }

  selectedFolder(folderId) {
    const entry = this.materialLibrary.entry(folderId);
    assert(entry.kind === 'directory', '请选择素材库中的文件夹');
    assert(fs.existsSync(entry.path) && fs.statSync(entry.path).isDirectory(), '所选素材文件夹不存在');
    return entry;
  }

  async readObjects() {
    const inputList = await this.client.request('GetInputList');
    const inputs = inputList.inputs || [];
    const objects = [];
    await mapLimit(inputs, 8, async input => {
      const response = await this.client.request('GetInputSettings', { inputName: input.inputName });
      objects.push({
        objectType: 'input',
        sourceName: input.inputName,
        inputKind: response.inputKind || input.inputKind,
        settings: response.inputSettings || {}
      });
      try {
        const filterList = await this.client.request('GetSourceFilterList', { sourceName: input.inputName });
        for (const filter of filterList.filters || []) {
          let settings = filter.filterSettings;
          if (!settings) {
            const response = await this.client.request('GetSourceFilter', {
              sourceName: input.inputName,
              filterName: filter.filterName
            });
            settings = response.filterSettings || {};
          }
          objects.push({
            objectType: 'filter',
            sourceName: input.inputName,
            filterName: filter.filterName,
            filterKind: filter.filterKind,
            settings
          });
        }
      } catch {
        // Some OBS input kinds do not expose filters. Their input settings are still scanned.
      }
    });
    return objects.sort((left, right) => `${left.sourceName}\n${left.filterName || ''}`.localeCompare(`${right.sourceName}\n${right.filterName || ''}`, 'zh-CN'));
  }

  recordsFor(objects, targetRoot) {
    const records = [];
    for (const object of objects) {
      for (const field of findRootedPaths(object.settings, this.canonicalRoot)) {
        const after = path.win32.join(targetRoot, field.relative);
        records.push({
          objectType: object.objectType,
          sourceName: object.sourceName,
          ...(object.filterName ? { filterName: object.filterName } : {}),
          settingPath: field.settingPath,
          settingTokens: field.tokens,
          before: field.value,
          after,
          exists: fs.existsSync(after)
        });
      }
    }
    return records;
  }

  validationPayload(folder, records) {
    const missing = records.filter(record => !record.exists);
    return {
      valid: records.length > 0 && missing.length === 0,
      folderId: folder.id,
      targetRoot: folder.path,
      canonicalRoot: this.canonicalRoot,
      referenceCount: records.length,
      objectCount: new Set(records.map(record => `${record.objectType}\n${record.sourceName}\n${record.filterName || ''}`)).size,
      missingCount: missing.length,
      records,
      missing,
      checkedAt: new Date().toISOString()
    };
  }

  async validate(folderId) {
    assert(this.client.connected, 'OBS 尚未连接');
    const folder = this.selectedFolder(folderId);
    const records = this.recordsFor(await this.readObjects(), folder.path);
    const validation = this.validationPayload(folder, records);
    this.state.lastSelectedFolderId = folder.id;
    this.state.lastValidation = validation;
    this.persist();
    return validation;
  }

  objectKey(record) {
    return `${record.objectType}\n${record.sourceName}\n${record.filterName || ''}`;
  }

  groupRecords(records) {
    const groups = new Map();
    for (const record of records) {
      const key = this.objectKey(record);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
    return [...groups.values()];
  }

  async readObject(record) {
    if (record.objectType === 'input') {
      const response = await this.client.request('GetInputSettings', { inputName: record.sourceName });
      return response.inputSettings || {};
    }
    const response = await this.client.request('GetSourceFilter', {
      sourceName: record.sourceName,
      filterName: record.filterName
    });
    return response.filterSettings || {};
  }

  async writeObject(record, settings) {
    if (record.objectType === 'input') {
      await this.client.request('SetInputSettings', { inputName: record.sourceName, inputSettings: settings, overlay: true });
      return;
    }
    await this.client.request('SetSourceFilterSettings', {
      sourceName: record.sourceName,
      filterName: record.filterName,
      filterSettings: settings,
      overlay: true
    });
  }

  async applyGroups(records, fromField, toField) {
    const changed = [];
    try {
      for (const group of this.groupRecords(records)) {
        const object = group[0];
        const current = await this.readObject(object);
        for (const record of group) {
          assert(pathEqual(getAt(current, record.settingTokens), record[fromField]), `OBS 设置已变化: ${record.sourceName} / ${record.settingPath}`);
        }
        const patched = clone(current);
        group.forEach(record => setAt(patched, record.settingTokens, record[toField]));
        await this.writeObject(object, patched);
        changed.push({ object, before: current });
        const verified = await this.readObject(object);
        for (const record of group) {
          assert(pathEqual(getAt(verified, record.settingTokens), record[toField]), `OBS 写入校验失败: ${record.sourceName} / ${record.settingPath}`);
        }
      }
    } catch (error) {
      const restoreErrors = [];
      for (const item of changed.reverse()) {
        try { await this.writeObject(item.object, item.before); } catch (restoreError) { restoreErrors.push(restoreError.message); }
      }
      if (restoreErrors.length) throw new Error(`${error.message}；自动恢复失败: ${restoreErrors.join('；')}`);
      throw new Error(`${error.message}；本次已修改内容已自动恢复`);
    }
  }

  async sync(folderId) {
    return this.obsController.runOperation('material-path-sync', async () => {
      const validation = await this.validate(folderId);
      assert(validation.referenceCount > 0, `OBS 中没有发现位于 ${this.canonicalRoot} 下的素材路径`);
      assert(validation.missingCount === 0, `目标文件夹缺少 ${validation.missingCount} 个 OBS 素材，不能同步`);
      await this.applyGroups(validation.records, 'before', 'after');
      const transaction = {
        id: transactionId('sync'),
        folderId: validation.folderId,
        targetRoot: validation.targetRoot,
        canonicalRoot: this.canonicalRoot,
        records: validation.records.map(({ exists, ...record }) => record),
        syncedAt: new Date().toISOString(),
        rolledBackAt: null
      };
      this.state.lastSuccessfulSync = transaction;
      this.state.lastRollback = null;
      this.state.lastValidation = null;
      this.persist();
      return { synced: true, transaction, changedCount: transaction.records.length };
    });
  }

  async rollbackCheck() {
    const transaction = this.state.lastSuccessfulSync;
    if (!transaction || transaction.rolledBackAt) return { available: false, conflicts: [], reason: '没有可撤销的同步记录' };
    if (!this.client.connected) return { available: false, conflicts: [], reason: 'OBS 尚未连接' };
    const conflicts = [];
    const missingBefore = [];
    for (const group of this.groupRecords(transaction.records)) {
      let current;
      try { current = await this.readObject(group[0]); } catch (error) {
        conflicts.push({ sourceName: group[0].sourceName, settingPath: '', reason: error.message });
        continue;
      }
      for (const record of group) {
        if (!pathEqual(getAt(current, record.settingTokens), record.after)) {
          conflicts.push({ sourceName: record.sourceName, filterName: record.filterName, settingPath: record.settingPath });
        }
        if (!fs.existsSync(record.before)) missingBefore.push(record.before);
      }
    }
    return {
      available: conflicts.length === 0 && missingBefore.length === 0,
      conflicts,
      missingBefore: [...new Set(missingBefore)],
      reason: conflicts.length ? 'OBS 路径在同步后被其他操作修改' : (missingBefore.length ? '原路径中的素材已不存在' : null),
      transactionId: transaction.id,
      changedCount: transaction.records.length
    };
  }

  async rollback() {
    return this.obsController.runOperation('material-path-rollback', async () => {
      const check = await this.rollbackCheck();
      assert(check.available, check.reason || '上次同步当前不可撤销');
      const transaction = this.state.lastSuccessfulSync;
      await this.applyGroups(transaction.records, 'after', 'before');
      const rolledBackAt = new Date().toISOString();
      transaction.rolledBackAt = rolledBackAt;
      this.state.lastRollback = {
        id: transactionId('rollback'),
        syncTransactionId: transaction.id,
        records: transaction.records,
        rolledBackAt
      };
      this.state.lastValidation = null;
      this.persist();
      return { rolledBack: true, changedCount: transaction.records.length, rolledBackAt };
    });
  }

  async status({ inspectRollback = true } = {}) {
    const folders = this.indexedFolders();
    const selectedExists = folders.some(folder => folder.id === this.state.lastSelectedFolderId);
    const rollback = inspectRollback ? await this.rollbackCheck() : { available: false, conflicts: [] };
    return {
      canonicalRoot: this.canonicalRoot,
      obsConnected: Boolean(this.client.connected),
      folders,
      selectedFolderId: selectedExists ? this.state.lastSelectedFolderId : null,
      lastValidation: selectedExists ? this.state.lastValidation : null,
      lastSuccessfulSync: this.state.lastSuccessfulSync,
      lastRollback: this.state.lastRollback,
      rollback
    };
  }
}

module.exports = {
  DEFAULT_CANONICAL_ROOT,
  ObsPathMigration,
  findRootedPaths,
  pathEqual,
  relativeFromRoot
};
