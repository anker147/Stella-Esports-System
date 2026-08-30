const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
process.env.STELLA_DB_PATH = ':memory:';
const { createAssetResolver, indexedCommentatorImages, indexedMatch } = require('./asset-fallback');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-fallback-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entries = [];
  const library = {
    list: () => entries.map((entry, index) => ({ id: String(index), kind: 'file', exists: true, name: path.basename(entry), path: entry })),
    entry: id => ({ id, kind: 'file', path: entries[Number(id)] }),
    describe: entry => ({ ...entry, exists: fs.existsSync(entry.path), name: path.basename(entry.path) })
  };
  return { root, entries, library };
}

test('missing configured images use an indexed relative suffix match', t => {
  const fx = fixture(t);
  const image = path.join(fx.root, '素材包', '场景底图', '解说席', '甲乙组合.png');
  fs.mkdirSync(path.dirname(image), { recursive: true });
  fs.writeFileSync(image, 'image');
  fx.entries.push(image);
  assert.equal(indexedMatch(fx.library, '场景底图/解说席/甲乙组合.png').path, image);
  assert.equal(createAssetResolver(fx.library, () => path.join(fx.root, 'missing.png'))('场景底图/解说席/甲乙组合.png'), image);
  assert.equal(indexedCommentatorImages(fx.library)[0].filePath, 'material-library:0');
});

test('duplicate indexed basenames fail instead of selecting the wrong image', t => {
  const fx = fixture(t);
  for (const folder of ['a', 'b']) {
    const image = path.join(fx.root, folder, '占位.png');
    fs.mkdirSync(path.dirname(image), { recursive: true });
    fs.writeFileSync(image, 'image');
    fx.entries.push(image);
  }
  assert.throws(() => indexedMatch(fx.library, '角色/Pick/占位.png'), /多个同名图片/);
});
