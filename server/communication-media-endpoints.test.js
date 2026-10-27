'use strict';
// 通讯媒体与导出端点的 HTTP 级测试：二进制上传（thumbBytes 切分）、
// ETag/Range 读取、撤回屏蔽与流式 ZIP 导出（administrator 通过、匿名 401）。
const assert = require('node:assert/strict');
const child_process = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

function waitForHealth(baseUrl, child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (child.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`server exited before health check (${child.exitCode})\n${childStderr}`));
        return;
      }
      try {
        const response = await fetch(`${baseUrl}/api/system/health`);
        if (response.ok) { clearInterval(timer); resolve(); return; }
      } catch {}
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`server health check timed out\n${childStderr}`));
      }
    }, 100);
  });
}

let childStderr = '';

async function spawnServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-comm-endpoints-'));
  const dbPath = path.join(directory, 'data', 'app.db');
  const port = 40500 + Math.floor(Math.random() * 1500);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = child_process.spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      STELLA_DATA_DIR: path.join(directory, 'data'),
      STELLA_DB_PATH: dbPath,
      STELLA_DEFAULTS_DIR: path.resolve(__dirname, '..', 'defaults', 'data'),
      STELLA_COMMUNICATION_MEDIA_ROOT: path.join(directory, 'media')
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  childStderr = '';
  child.stderr.on('data', chunk => { childStderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await waitForHealth(baseUrl, child);
  return { directory, baseUrl };
}

async function login(baseUrl, account, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'developer', account, password })
  });
  assert.equal(response.status, 200, `login ${account} failed: ${response.status}`);
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

test('media upload, cached range reads and administrator zip export over HTTP', { timeout: 120000 }, async t => {
  const { baseUrl } = await spawnServer(t);

  const setup = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'comm-endpoint-password' })
  });
  assert.equal(setup.status, 201);
  const adminCookie = await login(baseUrl, 'administrator', 'comm-endpoint-password');

  const seeded = await fetch(`${baseUrl}/api/communications/channels/global/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ content: '媒体端点种子消息' })
  });
  assert.equal(seeded.status, 201);

  // 语音二进制上传（无缩略图）
  const voiceBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5]);
  const voiceUpload = await fetch(
    `${baseUrl}/api/communications/channels/global/media?kind=voice&durationMs=4200`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm', Cookie: adminCookie },
      body: voiceBytes
    });
  assert.equal(voiceUpload.status, 201);
  const voiceMessage = (await voiceUpload.json()).message;
  assert.equal(voiceMessage.kind, 'voice');
  assert.equal(voiceMessage.media.durationMs, 4200);

  // 图片二进制上传：thumbBytes 切分（缩略图在前、主图在后）
  const thumbBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x02]);
  const mainBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa, 0xbb]);
  const imageUpload = await fetch(
    `${baseUrl}/api/communications/channels/global/media?kind=image&thumbBytes=${thumbBytes.length}`
    + `&thumbMime=image/webp&width=640&height=480&thumbWidth=160&thumbHeight=120`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Cookie: adminCookie },
      body: Buffer.concat([thumbBytes, mainBytes])
    });
  assert.equal(imageUpload.status, 201);
  const imageMessage = (await imageUpload.json()).message;
  assert.equal(imageMessage.kind, 'image');
  assert.ok(imageMessage.media.thumbUrl);

  // 主文件读取：字节守恒 + sha256 ETag + immutable 缓存
  const mainUrl = `${baseUrl}${imageMessage.media.url}`;
  const mainRead = await fetch(mainUrl, { headers: { Cookie: adminCookie } });
  assert.equal(mainRead.status, 200);
  assert.deepEqual(Buffer.from(await mainRead.arrayBuffer()), mainBytes);
  const etag = mainRead.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]{64}"$/);
  assert.equal(mainRead.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.equal(mainRead.headers.get('accept-ranges'), 'bytes');
  const conditional = await fetch(mainUrl, { headers: { Cookie: adminCookie, 'If-None-Match': etag } });
  assert.equal(conditional.status, 304);

  // 缩略图 variant 与 Range 单段读取
  const thumbRead = await fetch(`${baseUrl}${imageMessage.media.thumbUrl}`, { headers: { Cookie: adminCookie } });
  assert.equal(thumbRead.status, 200);
  assert.deepEqual(Buffer.from(await thumbRead.arrayBuffer()), thumbBytes);
  const rangeRead = await fetch(mainUrl, {
    headers: { Cookie: adminCookie, Range: `bytes=0-${thumbBytes.length - 1}` }
  });
  assert.equal(rangeRead.status, 206);
  assert.equal(rangeRead.headers.get('content-range'), `bytes 0-${thumbBytes.length - 1}/${mainBytes.length}`);
  assert.equal(rangeRead.headers.get('content-length'), String(thumbBytes.length));

  // 权限与资源缺失：匿名 401、不存在消息 404
  const anonRead = await fetch(mainUrl, { redirect: 'manual' });
  assert.equal(anonRead.status, 401);
  const missingRead = await fetch(`${baseUrl}/api/communications/messages/999999/media`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(missingRead.status, 404);

  // 撤回后媒体对普通会话屏蔽（管理员审计身份仍可读）
  const recall = await fetch(`${baseUrl}/api/communications/messages/${voiceMessage.id}/recall`, {
    method: 'POST', headers: { Cookie: adminCookie }
  });
  assert.equal(recall.status, 200);
  const recalledRead = await fetch(`${baseUrl}/api/communications/messages/${voiceMessage.id}/media`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(recalledRead.status, 200, 'developer identity keeps audit access to recalled media');

  // 管理员导出：流式 ZIP（store 模式），内含 messages.json 与已上传媒体主文件
  const exportResponse = await fetch(`${baseUrl}/api/communications/channels/global/export`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.headers.get('content-type'), 'application/zip');
  assert.match(exportResponse.headers.get('content-disposition'), /attachment/);
  const zip = Buffer.from(await exportResponse.arrayBuffer());
  assert.deepEqual(zip.subarray(0, 4), Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'local header magic PK\x03\x04');
  const eocdOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entryCount = zip.readUInt16LE(eocdOffset + 10);
  assert.equal(entryCount, 3, 'messages.json + voice + image');
  // 逐条走中央目录（条目变长：46 + nameLength）
  const cdOffset = zip.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let cursor = cdOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50);
    const nameLength = zip.readUInt16LE(cursor + 28);
    entries.push({
      name: zip.toString('utf8', cursor + 46, cursor + 46 + nameLength),
      byteSize: zip.readUInt32LE(cursor + 24),
      crc: zip.readUInt32LE(cursor + 16),
      localHeaderOffset: zip.readUInt32LE(cursor + 42)
    });
    cursor += 46 + nameLength;
  }
  assert.equal(entries[0].name, 'messages.json');
  assert.match(entries[1].name, /^media\/\d+\.webm$/);
  assert.match(entries[2].name, /^media\/\d+\.png$/);
  const jsonStart = entries[0].localHeaderOffset + 30
    + zip.readUInt16LE(entries[0].localHeaderOffset + 26);
  const manifest = JSON.parse(zip.toString('utf8', jsonStart, jsonStart + entries[0].byteSize));
  assert.equal(manifest.channel.id, 'global');
  assert.equal(manifest.messageCount, 3);
  assert.deepEqual(manifest.missingMediaMessageIds, []);
  assert.equal(manifest.messages.filter(message => message.media).length, 2);
  assert.equal(manifest.messages.every(message => message.sender !== undefined), true);
  // CRC 与字节守恒抽查：导出包中的图片条目与上传字节一致
  const imageDataStart = entries[2].localHeaderOffset + 30
    + zip.readUInt16LE(entries[2].localHeaderOffset + 26);
  assert.deepEqual(zip.subarray(imageDataStart, imageDataStart + mainBytes.length), mainBytes);
  assert.equal(entries[2].crc, zlib.crc32(mainBytes));

  // 匿名导出被会话门拦截
  const anonExport = await fetch(`${baseUrl}/api/communications/channels/global/export`, { redirect: 'manual' });
  assert.equal(anonExport.status, 401);

  // 整理版聊天记录导出：纯文本、CRLF、头部与消息标注齐全
  const textExport = await fetch(`${baseUrl}/api/communications/channels/global/export-text`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(textExport.status, 200);
  assert.equal(textExport.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.match(textExport.headers.get('content-disposition'), /filename\*=UTF-8''/);
  const digestText = await textExport.text();
  assert.equal(digestText.includes('\r\n'), true);
  assert.match(digestText, /╔═{10,}/);
  assert.match(digestText, /星澜赛事导播系统 · 全局公聊 聊天记录/);
  assert.match(digestText, /导出时间: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(北京时间\)/);
  assert.match(digestText, /消息总数: 3/);
  assert.match(digestText, /媒体端点种子消息/);
  assert.match(digestText, /\[语音 0:04 9B\] 【已撤回】/, 'developer export keeps recalled media annotated');
  assert.match(digestText, /\[语音 0:04/);
  assert.match(digestText, /类型: 全局公聊/);
  const anonTextExport = await fetch(`${baseUrl}/api/communications/channels/global/export-text`, { redirect: 'manual' });
  assert.equal(anonTextExport.status, 401);
});
