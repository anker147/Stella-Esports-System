// 局域网设备电脑名解析：浏览器拿不到主机名（隐私沙箱），由服务端主动解析。
// 同机（loopback）直接读 os.hostname()；局域网 IPv4 走 NetBIOS 节点状态查询（UDP 137，
// 等价于 nbtstat -A <ip>），失败退 DNS 反解取首段；公网/IPv6 不解析。
// 全部 Node 内置模块，结果按 IP 缓存 10 分钟（电脑名极少变更）。
const dgram = require('node:dgram');
const dns = require('node:dns');
const os = require('node:os');

const NBNS_PORT = 137;
const NBNS_TIMEOUT_MS = 400;
const DNS_TIMEOUT_MS = 400;
const CACHE_TTL_MS = 10 * 60 * 1000;
// 名称条目：15 字节空格补位名 + 1 字节后缀 + 2 字节名称标志（含 group 位）
const NBSTAT_ENTRY_SIZE = 18;
const SUFFIX_WORKSTATION = 0x00;
const FLAG_GROUP = 0x8000;

const hostnameCache = new Map();

function isPrivateIPv4(ip) {
  const match = String(ip || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function normalizeClientIp(ip) {
  const value = String(ip || '').trim();
  // IPv4-mapped IPv6（::ffff:192.168.1.5）还原为点分十进制
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1];
  return value;
}

function isLoopback(ip) {
  return ip === '::1' || ip === '127.0.0.1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

// NBNS 名称第一级编码：每字节拆高低 nibble 各加 'A'，'*' 补位到 16 字节后编码为 32 字符
function encodeNetbiosName(name) {
  const padded = String(name).slice(0, 15).padEnd(15, ' ') + String.fromCharCode(0);
  let encoded = '';
  for (const char of padded) {
    const code = char.charCodeAt(0);
    encoded += String.fromCharCode(0x41 + (code >> 4)) + String.fromCharCode(0x41 + (code & 0x0f));
  }
  return encoded;
}

function buildNetbiosQuery(transactionId) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(transactionId & 0xffff, 0);
  head.writeUInt16BE(0x0000, 2); // flags: unicast node status request
  head.writeUInt16BE(1, 4); // QDCOUNT
  const question = Buffer.alloc(38);
  question[0] = 32;
  Buffer.from(encodeNetbiosName('*'), 'ascii').copy(question, 1);
  question[33] = 0; // 根标签结束
  question.writeUInt16BE(0x21, 34); // QTYPE = NBSTAT
  question.writeUInt16BE(0x01, 36); // QCLASS = IN
  return Buffer.concat([head, question]);
}

// 解析 NBNS 节点状态响应，取第一个 <00> UNIQUE 条目（工作站名 = 电脑名）。
// workgroup 名同为 <00> 但带 group 标志，服务器服务为 <20>，均跳过。任何越界/畸形返回 ''。
function parseNetbiosNodeStatus(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
    // 跳过 12 字节头与问题/应答名段（length 前缀编码，0 结尾；0xC0 开头为压缩指针占 2 字节）
    let offset = 12;
    for (let hops = 0; hops < 4 && offset < buffer.length; hops += 1) {
      const length = buffer[offset];
      if (length === 0) {
        offset += 1;
        break;
      }
      if ((length & 0xc0) === 0xc0) {
        offset += 2;
        break;
      }
      offset += 1 + length;
    }
    if (offset + 10 > buffer.length) return '';
    const type = buffer.readUInt16BE(offset);
    const rdLength = buffer.readUInt16BE(offset + 8);
    if (type !== 0x21 || rdLength <= 0) return '';
    const rdataStart = offset + 10;
    if (rdataStart + rdLength > buffer.length) return '';
    const count = buffer[rdataStart];
    if (count === 0 || count > 255) return '';
    for (let index = 0; index < count; index += 1) {
      const entryStart = rdataStart + 1 + index * NBSTAT_ENTRY_SIZE;
      if (entryStart + NBSTAT_ENTRY_SIZE > rdataStart + rdLength) return '';
      const suffix = buffer[entryStart + 15];
      const flags = buffer.readUInt16BE(entryStart + 16);
      if (suffix !== SUFFIX_WORKSTATION || (flags & FLAG_GROUP) !== 0) continue;
      const name = buffer.toString('ascii', entryStart, entryStart + 15)
        .replace(/[\s\u0000]+$/g, '')
        .trim();
      // 可见 ASCII 校验，过滤二进制噪声
      if (name && /^[\x20-\x7e]{1,15}$/.test(name)) return name;
    }
    return '';
  } catch {
    return '';
  }
}

function queryNetbiosName(ip, timeoutMs = NBNS_TIMEOUT_MS) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* 已关闭 */ }
      resolve(value);
    };
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => finish(''), timeoutMs);
    socket.on('message', message => {
      const name = parseNetbiosNodeStatus(message);
      if (name) finish(name);
    });
    socket.on('error', () => finish(''));
    const transactionId = Math.floor(Math.random() * 0xffff) + 1;
    socket.send(buildNetbiosQuery(transactionId), NBNS_PORT, ip, error => {
      if (error) finish('');
    });
  });
}

function reverseDnsLabel(ip, timeoutMs = DNS_TIMEOUT_MS) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve('');
      }
    }, timeoutMs);
    timer.unref?.();
    dns.reverse(ip).then(records => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const first = String(records?.[0] || '').split('.')[0].trim();
      resolve(/^[\x20-\x7e]{1,64}$/.test(first) ? first : '');
    }).catch(() => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve('');
      }
    });
  });
}

// 对外入口：返回电脑名（可能为空字符串），永不抛错
async function resolveClientHostname(ip) {
  const normalized = normalizeClientIp(ip);
  if (!normalized || normalized === 'unknown') return '';
  const cached = hostnameCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let value = '';
  if (isLoopback(normalized)) {
    try { value = os.hostname(); } catch { value = ''; }
  } else if (isPrivateIPv4(normalized)) {
    value = await queryNetbiosName(normalized);
    if (!value) value = await reverseDnsLabel(normalized);
  }
  value = String(value || '').trim().slice(0, 64);
  hostnameCache.set(normalized, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function clearHostnameCache() {
  hostnameCache.clear();
}

module.exports = {
  parseNetbiosNodeStatus,
  resolveClientHostname,
  buildNetbiosQuery,
  isPrivateIPv4,
  clearHostnameCache
};
