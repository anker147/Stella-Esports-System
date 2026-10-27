'use strict';
// StoreZipWriter 结构测试：产物流式收集后手动解析（本地头/数据描述符/中央目录/EOCD），
// 断言 store 方法、bit-3 数据描述符、CRC 与字节守恒——零依赖，不借助外部解压工具。
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { StoreZipWriter } = require('./zip-store-writer');

function collectWriter() {
  const chunks = [];
  return {
    write: async chunk => { chunks.push(chunk); },
    async buffer() { return Buffer.concat(chunks); }
  };
}

// 解析中央目录（EOCD 无注释固定尾 22 字节）
function parseCentralDirectory(buffer) {
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocdOffset > 0, 'EOCD signature must exist');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  assert.equal(cdOffset + cdSize, eocdOffset, 'central directory must sit directly before EOCD');
  const entries = [];
  let cursor = cdOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50, `entry ${index} central signature`);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const byteSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    entries.push({ flags, method, crc, byteSize, name, localHeaderOffset });
    cursor += 46 + nameLength;
  }
  return entries;
}

function entryData(buffer, entry) {
  assert.equal(buffer.readUInt32LE(entry.localHeaderOffset), 0x04034b50, 'local header signature');
  const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const start = entry.localHeaderOffset + 30 + nameLength + extraLength;
  return buffer.subarray(start, start + entry.byteSize);
}

test('zip writer streams store-mode entries whose bytes round-trip exactly', async () => {
  const sink = collectWriter();
  const zip = new StoreZipWriter(sink.write);
  const manifest = Buffer.from(JSON.stringify({ channel: 'global', messageCount: 2 }), 'utf8');
  await zip.addBuffer('messages.json', manifest);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-zip-'));
  const mediaBytes = crypto.randomBytes(64 * 1024);
  const mediaPath = path.join(directory, '1.webm');
  fs.writeFileSync(mediaPath, mediaBytes);
  await zip.addFile('media/1.webm', mediaPath, mediaBytes.length);
  const total = await zip.finalize();
  const buffer = await sink.buffer();
  assert.equal(total, buffer.length);
  fs.rmSync(directory, { recursive: true, force: true });

  const entries = parseCentralDirectory(buffer);
  assert.deepEqual(entries.map(entry => entry.name), ['messages.json', 'media/1.webm']);
  for (const entry of entries) {
    assert.equal(entry.method, 0, 'store mode: no compression');
    assert.equal(entry.flags & 0x0008, 0x0008, 'data-descriptor flag must be set');
  }
  const jsonEntry = entries[0];
  assert.deepEqual(entryData(buffer, jsonEntry), manifest);
  assert.equal(jsonEntry.crc, zlib.crc32(manifest));
  const mediaEntry = entries[1];
  assert.deepEqual(entryData(buffer, mediaEntry), mediaBytes);
  assert.equal(mediaEntry.crc, zlib.crc32(mediaBytes));
});

test('zip writer rejects size mismatches instead of writing a corrupt archive', async () => {
  const sink = collectWriter();
  const zip = new StoreZipWriter(sink.write);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-zip-bad-'));
  const filePath = path.join(directory, 'short.bin');
  fs.writeFileSync(filePath, Buffer.from([1, 2, 3]));
  await assert.rejects(
    () => zip.addFile('media/9.bin', filePath, 99),
    /size mismatch/
  );
  fs.rmSync(directory, { recursive: true, force: true });
});
