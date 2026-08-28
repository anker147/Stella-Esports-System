const fs = require('node:fs');
const path = require('node:path');
const { LEGACY_CANONICAL_ROOT, normalizedRelative, resolveAssetPath } = require('./asset-paths');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);
const MATERIAL_REFERENCE = 'material-library:';

function isImage(entry) {
  return entry.kind === 'file' && entry.exists && IMAGE_EXTENSIONS.has(path.extname(entry.path).toLocaleLowerCase('en-US'));
}

function relativeHint(value) {
  const text = String(value || '');
  if (!text || text.startsWith(MATERIAL_REFERENCE)) return null;
  if (!path.isAbsolute(text)) return normalizedRelative(text);
  const legacyRoot = path.resolve(LEGACY_CANONICAL_ROOT);
  const absolute = path.resolve(text);
  const relative = path.relative(legacyRoot, absolute);
  return !relative.startsWith('..') && !path.isAbsolute(relative) ? normalizedRelative(relative) : null;
}

function normalizedSuffix(value) {
  return String(value || '').replaceAll('\\', '/').toLocaleLowerCase('en-US');
}

function indexedMatch(materialLibrary, value) {
  const hint = relativeHint(value);
  if (!hint) return null;
  const images = materialLibrary.list().filter(isImage);
  const suffix = `/${normalizedSuffix(hint)}`;
  const suffixMatches = images.filter(entry => `/${normalizedSuffix(entry.path)}`.endsWith(suffix));
  if (suffixMatches.length === 1) return suffixMatches[0];
  if (suffixMatches.length > 1) throw new Error(`素材库中有多个路径匹配 ${hint}，请整理重复索引`);
  const fileName = path.basename(hint).toLocaleLowerCase('en-US');
  const nameMatches = images.filter(entry => path.basename(entry.path).toLocaleLowerCase('en-US') === fileName);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) throw new Error(`素材库中有多个同名图片 ${path.basename(hint)}，无法安全选择`);
  return null;
}

function createAssetResolver(materialLibrary, primaryResolver = resolveAssetPath) {
  return value => {
    const text = String(value || '');
    if (text.startsWith(MATERIAL_REFERENCE)) {
      const entry = materialLibrary.entry(text.slice(MATERIAL_REFERENCE.length));
      if (!isImage(materialLibrary.describe(entry))) throw new Error('素材库图片不存在');
      return entry.path;
    }
    let primaryError = null;
    try {
      const resolved = primaryResolver(value);
      if (fs.existsSync(resolved)) return resolved;
      primaryError = new Error(`图片不存在: ${value}`);
    } catch (error) {
      primaryError = error;
    }
    const fallback = indexedMatch(materialLibrary, value);
    if (fallback) return fallback.path;
    throw new Error(`${primaryError?.message || `图片不存在: ${value}`}；素材库中也没有唯一匹配的图片`);
  };
}

function indexedCommentatorImages(materialLibrary) {
  return materialLibrary.list().filter(entry => isImage(entry) && entry.name.includes('组合'))
    .map(entry => ({
      id: `material:${entry.id}`,
      name: path.basename(entry.name, path.extname(entry.name)),
      filePath: `${MATERIAL_REFERENCE}${entry.id}`,
      indexed: true,
      absolutePath: entry.path
    }));
}

module.exports = {
  IMAGE_EXTENSIONS,
  MATERIAL_REFERENCE,
  createAssetResolver,
  indexedCommentatorImages,
  indexedMatch,
  relativeHint
};
