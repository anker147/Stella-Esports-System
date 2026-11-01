// 电脑名解析：NBNS 节点状态响应解析器的手工缓冲测试（不发真实网络请求）。
const assert = require('node:assert/strict');
const test = require('node:test');
const { parseNetbiosNodeStatus, buildNetbiosQuery, isPrivateIPv4 } = require('./lan-hostname');

// 构造 NBNS 节点状态响应：12 字节头 + length 前缀的编码名段 + RR 固定段 + RDATA
function buildResponse(entries, { rdLengthOverride = null } = {}) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8000, 2); // response flag
  header.writeUInt16BE(1, 6); // ANCOUNT
  const name = Buffer.alloc(34);
  name[0] = 32;
  Buffer.from('A'.repeat(32), 'ascii').copy(name, 1);
  const rdata = Buffer.concat([
    Buffer.from([entries.length]),
    ...entries.map(([nameText, suffix, flags]) => {
      const entry = Buffer.alloc(18);
      entry.write(nameText.slice(0, 15).padEnd(15, ' '), 0, 'ascii');
      entry[15] = suffix;
      entry.writeUInt16BE(flags, 16);
      return entry;
    })
  ]);
  const rr = Buffer.alloc(10);
  rr.writeUInt16BE(0x21, 0); // TYPE NBSTAT
  rr.writeUInt16BE(0x01, 2); // CLASS IN
  rr.writeUInt32BE(0, 4); // TTL
  rr.writeUInt16BE(rdLengthOverride ?? rdata.length, 8);
  return Buffer.concat([header, name, rr, rdata]);
}

test('NBNS 解析：提取第一个 <00> UNIQUE 条目作为电脑名', () => {
  const response = buildResponse([
    ['STUDIO-01', 0x00, 0x0000],
    ['WORKGROUP', 0x00, 0x8000],
    ['SERVER-01', 0x20, 0x0000]
  ]);
  assert.equal(parseNetbiosNodeStatus(response), 'STUDIO-01');
});

test('NBNS 解析：group 标志的工作组名与非 0x00 后缀都被跳过', () => {
  const response = buildResponse([
    ['WORKGROUP', 0x00, 0x8000],
    ['IS~SERVER', 0x20, 0x0000]
  ]);
  assert.equal(parseNetbiosNodeStatus(response), '', '没有 unique 工作站名返回空');
});

test('NBNS 解析：畸形数据容错', () => {
  assert.equal(parseNetbiosNodeStatus(Buffer.alloc(0)), '');
  assert.equal(parseNetbiosNodeStatus(Buffer.alloc(12)), '');
  assert.equal(parseNetbiosNodeStatus(Buffer.from('not-a-buffer-string')), '');
  // RDLENGTH 谎报超界
  const lying = buildResponse([['X', 0x00, 0x0000]], { rdLengthOverride: 4000 });
  assert.equal(parseNetbiosNodeStatus(lying), '');
  // count 虚高
  const greedy = buildResponse([['X', 0x00, 0x0000]]);
  greedy[55] = 250;
  assert.equal(parseNetbiosNodeStatus(greedy), '');
  // 名称含不可见字符
  const binary = buildResponse([['BAD\x01NAME', 0x00, 0x0000]]);
  assert.equal(parseNetbiosNodeStatus(binary), '');
});

test('NBNS 查询包：包含 NBSTAT 问题与通配名', () => {
  const query = buildNetbiosQuery(0x1234);
  assert.equal(query.readUInt16BE(0), 0x1234);
  assert.equal(query.readUInt16BE(4), 1, 'QDCOUNT = 1');
  assert.equal(query[12], 32, '编码名长度');
  const qtype = query.readUInt16BE(12 + 1 + 32 + 1);
  assert.equal(qtype, 0x21, 'QTYPE NBSTAT');
});

test('私网判定', () => {
  assert.equal(isPrivateIPv4('192.168.1.5'), true);
  assert.equal(isPrivateIPv4('10.0.0.2'), true);
  assert.equal(isPrivateIPv4('172.16.0.1'), true);
  assert.equal(isPrivateIPv4('172.32.0.1'), false);
  assert.equal(isPrivateIPv4('8.8.8.8'), false);
  assert.equal(isPrivateIPv4('::ffff:192.168.1.5'), false, 'IPv6 串不参与 IPv4 判定');
});
