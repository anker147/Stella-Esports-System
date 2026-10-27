'use strict';
// 流式 store 模式 ZIP 写器（零依赖）：条目数据不压缩（媒体文件本就是压缩格式），
// 边生成边写出，整包不驻内存。CRC32 走 Node 自带 zlib.crc32（增量传入上一次值）。
// 本地文件头使用数据描述符（flag bit 3）：流式写入时 CRC 与长度在数据之后补记，
// 中央目录记录真实值——与 Python zipfile / zipstream 的流式输出同一约定。
const { createReadStream } = require('node:fs');
const zlib = require('node:zlib');

const LOCAL_FILE_HEADER = 0x04034b50;
const DATA_DESCRIPTOR = 0x08074b50;
const CENTRAL_DIR_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;
const VERSION = 20;
const FLAG_DATA_DESCRIPTOR = 0x0008;

function dosDateTime(date) {
  const time = ((date.getHours() & 0x1f) << 11)
    | ((date.getMinutes() & 0x3f) << 5)
    | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9)
    | (((date.getMonth() + 1) & 0x0f) << 5)
    | (date.getDate() & 0x1f);
  return { time, day };
}

class StoreZipWriter {
  // write(chunk) 必须返回 Promise，并在底层可写缓冲满时等待 drain（背压感知）。
  constructor(write, options = {}) {
    this.write = write;
    this.timestamp = dosDateTime(options.timestamp || new Date());
    this.entries = [];
    this.offset = 0;
  }

  async writeChunk(buffer) {
    await this.write(buffer);
    this.offset += buffer.length;
  }

  async addEntry(name, byteSize, openStream) {
    if (Buffer.byteLength(name) > 0xffff) throw new Error('ZIP entry name too long');
    const nameBuffer = Buffer.from(name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(FLAG_DATA_DESCRIPTOR, 6);
    header.writeUInt16LE(0, 8); // store：不压缩
    header.writeUInt16LE(this.timestamp.time, 10);
    header.writeUInt16LE(this.timestamp.day, 12);
    header.writeUInt32LE(0, 14); // CRC 流式写完后经数据描述符补记
    header.writeUInt32LE(0, 18);
    header.writeUInt32LE(0, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);
    const localHeaderOffset = this.offset;
    await this.writeChunk(header);
    await this.writeChunk(nameBuffer);
    let crc = 0;
    let written = 0;
    const stream = openStream();
    try {
      for await (const chunk of stream) {
        crc = zlib.crc32(chunk, crc);
        written += chunk.length;
        await this.writeChunk(chunk);
      }
    } finally {
      stream.destroy?.();
    }
    if (written !== byteSize) throw new Error(`ZIP entry "${name}" size mismatch (${written} != ${byteSize})`);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(DATA_DESCRIPTOR, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    descriptor.writeUInt32LE(written, 8);
    descriptor.writeUInt32LE(written, 12);
    await this.writeChunk(descriptor);
    this.entries.push({ nameBuffer, crc: crc >>> 0, byteSize: written, localHeaderOffset });
  }

  async addBuffer(name, buffer) {
    await this.addEntry(name, buffer.length, async function* () { yield buffer; });
  }

  async addFile(name, filePath, byteSize) {
    await this.addEntry(name, byteSize, () => createReadStream(filePath));
  }

  async finalize() {
    const centralDirectoryOffset = this.offset;
    for (const entry of this.entries) {
      const record = Buffer.alloc(46);
      record.writeUInt32LE(CENTRAL_DIR_HEADER, 0);
      record.writeUInt16LE(VERSION, 4); // version made by
      record.writeUInt16LE(VERSION, 6); // version needed
      record.writeUInt16LE(FLAG_DATA_DESCRIPTOR, 8);
      record.writeUInt16LE(0, 10); // store
      record.writeUInt16LE(this.timestamp.time, 12);
      record.writeUInt16LE(this.timestamp.day, 14);
      record.writeUInt32LE(entry.crc, 16);
      record.writeUInt32LE(entry.byteSize, 20);
      record.writeUInt32LE(entry.byteSize, 24);
      record.writeUInt16LE(entry.nameBuffer.length, 28);
      record.writeUInt16LE(0, 30); // extra
      record.writeUInt16LE(0, 32); // comment
      record.writeUInt16LE(0, 34); // disk number
      record.writeUInt16LE(0, 36); // internal attrs
      record.writeUInt32LE(0, 38); // external attrs
      record.writeUInt32LE(entry.localHeaderOffset, 42);
      await this.writeChunk(record);
      await this.writeChunk(entry.nameBuffer);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_CENTRAL_DIR, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - centralDirectoryOffset, 12);
    end.writeUInt32LE(centralDirectoryOffset, 16);
    end.writeUInt16LE(0, 20); // comment
    await this.writeChunk(end);
    return this.offset;
  }
}

module.exports = { StoreZipWriter };
