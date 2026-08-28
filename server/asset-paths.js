const fs = require('node:fs');
const path = require('node:path');
const { mutableDataPath, parseJsonFile } = require('./data-paths');

const MIGRATION_STORE = mutableDataPath('obs-path-migration.json');
const LEGACY_CANONICAL_ROOT = 'E:\\2026追风杯';

function inside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function migrationState() {
  try { return parseJsonFile(MIGRATION_STORE); }
  catch { return {}; }
}

function activeAssetRoot() {
  const state = migrationState();
  const transaction = state.lastSuccessfulSync;
  if (transaction?.targetRoot && !transaction.rolledBackAt) {
    const root = path.resolve(transaction.targetRoot);
    if (root === path.parse(root).root) throw new Error('素材包根目录不能是整个磁盘');
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('已确认的素材包根目录不存在，请重新校验');
    return root;
  }
  if (!process.env.STELLA_DATA_DIR) return path.resolve(state.canonicalRoot || LEGACY_CANONICAL_ROOT);
  throw new Error('尚未确认素材包路径，请先在素材库完成路径校验和 OBS 同步');
}

function normalizedRelative(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`素材相对路径无效: ${value}`);
  }
  return normalized;
}

function relativeAssetPath(value) {
  const root = activeAssetRoot();
  if (!path.isAbsolute(value)) return normalizedRelative(value);
  const absolute = path.resolve(value);
  if (inside(absolute, root)) return normalizedRelative(path.relative(root, absolute));
  const legacyRoot = path.resolve(migrationState().canonicalRoot || LEGACY_CANONICAL_ROOT);
  if (inside(absolute, legacyRoot)) return normalizedRelative(path.relative(legacyRoot, absolute));
  throw new Error(`素材路径不属于当前素材包: ${value}`);
}

function resolveAssetPath(value) {
  const root = activeAssetRoot();
  const result = path.resolve(root, relativeAssetPath(value));
  if (!inside(result, root) || result === root) throw new Error(`素材路径越界: ${value}`);
  return result;
}

function assertAssetDirectory(value) {
  const directory = resolveAssetPath(value);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

module.exports = {
  LEGACY_CANONICAL_ROOT,
  activeAssetRoot,
  assertAssetDirectory,
  inside,
  normalizedRelative,
  relativeAssetPath,
  resolveAssetPath
};
