const fs = require('node:fs');
const path = require('node:path');
const { installDataPath, parseJsonFile } = require('./data-paths');

const DEFAULT_RELEASE_PATH = installDataPath('update-log.json');
const SEMVER = /^\d+\.\d+\.\d+$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readReleaseData(filePath = DEFAULT_RELEASE_PATH) {
  const data = parseJsonFile(filePath);
  assert(data.schemaVersion === 1, '更新日志格式版本无效');
  assert(typeof data.product === 'string' && data.product.trim(), '更新日志缺少产品名称');
  assert(SEMVER.test(data.currentVersion), '当前系统版本号无效');
  assert(Array.isArray(data.releases) && data.releases.length > 0, '更新日志不能为空');
  assert(data.releases[0].version === data.currentVersion, '当前版本必须位于更新日志首项');
  const versions = new Set();
  for (const release of data.releases) {
    assert(SEMVER.test(release.version), `版本号无效: ${release.version}`);
    assert(!versions.has(release.version), `版本号重复: ${release.version}`);
    assert(typeof release.title === 'string' && release.title.trim(), `版本 ${release.version} 缺少标题`);
    assert(release.changes && Object.keys(release.changes).length > 0, `版本 ${release.version} 缺少更新内容`);
    versions.add(release.version);
  }
  return data;
}

module.exports = { DEFAULT_RELEASE_PATH, readReleaseData };
