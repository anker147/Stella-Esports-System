'use strict';
// HTTP 响应与请求体工具：路由骨架与各域处理模块共用的纯函数（自 server.js 拆出）。
const zlib = require('node:zlib');

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Accept-Encoding'
  };
  const send = (bodyBuffer, encoding) => {
    headers['Content-Length'] = bodyBuffer.length;
    if (encoding) headers['Content-Encoding'] = encoding;
    res.writeHead(status, headers);
    res.end(bodyBuffer);
  };
  // 文本 JSON 走 gzip 协商（SSE 与二进制不经此函数），1KB 以下不值得压缩
  const acceptsGzip = /\bgzip\b/.test(String(res.req?.headers['accept-encoding'] || ''));
  if (body.length > 1024 && acceptsGzip) {
    zlib.gzip(body, (gzipError, gzipped) => {
      if (gzipError) {
        send(body);
        return;
      }
      send(gzipped, 'gzip');
    });
    return;
  }
  send(body);
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function readBuffer(req, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('图片不能超过20MB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// SSE 写出容错：支持 {res} 包装对象或裸 res，半开连接丢弃本次写入
function sseWrite(target, message) {
  const res = target.res || target;
  try {
    if (!res.destroyed && !res.writableEnded) res.write(message);
  } catch { /* 半开连接：丢弃本次写入，连接由 close 与 error 监听清理 */ }
}

module.exports = { sendJson, readBody, readBuffer, sseWrite };
