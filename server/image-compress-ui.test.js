const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('image-compress exposes the shared compressor api without ui text coupling', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'image-compress.js'), 'utf8');

  assert.match(source, /window\.ImageCompress = \{ compress \}/);
  assert.match(source, /toDataURL\('image\/webp'/);
  assert.match(source, /bytes: base64Bytes\(dataUrl\)/);
  assert.doesNotMatch(source, /\bt\(|\btext\(/);
  assert.doesNotMatch(source, /\p{Script=Han}/u);
  assert.doesNotMatch(source, /\b(alert|confirm|prompt)\(/);
});

test('oversized originals compress instead of being rejected by raw file size', () => {
  const characterStats = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'character-stats.js'), 'utf8');

  assert.match(characterStats, /window\.ImageCompress\.compress\(source, compressOptions\)/);
  assert.match(characterStats, /compressed\.bytes > maximumBytes/);
  assert.doesNotMatch(characterStats, /if \(file\.size > maximumBytes\) \{\s*\n\s*return Promise\.reject/);
});

test('channel avatar and event image uploads route through the compressor', () => {
  const communications = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'communications.js'), 'utf8');
  assert.match(communications, /window\.ImageCompress\.compress\(source, \{ maxEdge: 256, quality: 0\.85 \}\)/);
  assert.match(communications, /compressed\.bytes > 512 \* 1024/);

  const eventManagement = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'event-management.js'), 'utf8');
  assert.match(eventManagement, /qr \? null : \{ maxEdge: logo \? 512 : 1600, quality: 0\.85 \}/);
});

test('control page loads image-compress before its consumers', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');

  const compressorTag = html.indexOf('assets/js/image-compress.js');
  assert.ok(compressorTag !== -1, 'control.html must reference assets/js/image-compress.js');

  for (const consumer of ['character-stats.js', 'communications.js', 'event-management.js']) {
    const consumerTag = html.indexOf(`assets/js/${consumer}`);
    assert.ok(consumerTag > compressorTag, `${consumer} must load after image-compress.js`);
  }
});

test('ui-text preload version matches TEXT_DATA_VERSION on every page', () => {
  const textSource = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'text.js'), 'utf8');
  const version = textSource.match(/const TEXT_DATA_VERSION = (\d+);/)?.[1];
  assert.ok(version, 'TEXT_DATA_VERSION must be declared');

  for (const page of ['control.html', 'overlay.html', 'login.html', 'bp-overlay.html', 'bp-animation-design.html', 'match-intro-concept.html']) {
    const html = fs.readFileSync(path.join(root, 'public', page), 'utf8');
    assert.match(html, new RegExp(`/assets/data/ui-text\\.json\\?v=${version}`), `${page} preload must track TEXT_DATA_VERSION`);
  }
});
