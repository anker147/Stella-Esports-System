const fs = require('node:fs');
const path = require('node:path');

const INSTALL_ROOT = path.resolve(__dirname, '..');
const INSTALL_DATA_ROOT = path.join(INSTALL_ROOT, 'data');
const DEFAULTS_ROOT = path.resolve(process.env.STELLA_DEFAULTS_DIR || path.join(INSTALL_ROOT, 'defaults', 'data'));
const DATA_ROOT = path.resolve(process.env.STELLA_DATA_DIR || INSTALL_DATA_ROOT);

function copyInitialFile(targetPath, candidates, fallbackContent) {
  if (fs.existsSync(targetPath)) return targetPath;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const source = candidates.find(candidate => fs.existsSync(candidate));
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  if (source) fs.copyFileSync(source, tempPath);
  else fs.writeFileSync(tempPath, fallbackContent, 'utf8');
  fs.renameSync(tempPath, targetPath);
  return targetPath;
}

function mutableDataPath(fileName, fallbackContent = '{}\n') {
  const targetPath = path.join(DATA_ROOT, fileName);
  if (DATA_ROOT === INSTALL_DATA_ROOT) return targetPath;
  return copyInitialFile(targetPath, [
    path.join(DEFAULTS_ROOT, fileName),
    path.join(INSTALL_DATA_ROOT, fileName)
  ], fallbackContent);
}

function installDataPath(fileName) {
  return path.join(INSTALL_DATA_ROOT, fileName);
}

function parseJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

module.exports = {
  DATA_ROOT,
  DEFAULTS_ROOT,
  INSTALL_DATA_ROOT,
  INSTALL_ROOT,
  copyInitialFile,
  installDataPath,
  mutableDataPath,
  parseJsonFile
};
