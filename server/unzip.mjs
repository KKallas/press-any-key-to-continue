// A tiny zip reader — just enough to open a forge bundle, with no dependency.
// Reads the central directory, then inflates stored (0) or deflated (8)
// entries with Node's own zlib. Not a general zip library: it ignores
// encryption, zip64 and spanning, and caps what it will expand.

import zlib from 'node:zlib';

const EOCD = 0x06054b50; // end of central directory
const CEN = 0x02014b50; // central directory entry
const MAX_ENTRY = 8 * 1024 * 1024;

// Returns Map<filename, Buffer> of the entries (files only).
export function unzip(buf) {
  // Find the end-of-central-directory record, scanning back from the tail.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no EOCD');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset of central directory

  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CEN) throw new Error('bad central entry');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42); // local header offset
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // a directory
    if (uncompSize > MAX_ENTRY || compSize > MAX_ENTRY) throw new Error('entry too big');
    // Jump to the local header to find where the data actually starts.
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(start, start + compSize);
    let data;
    if (method === 0) data = Buffer.from(comp);
    else if (method === 8) data = zlib.inflateRawSync(comp);
    else throw new Error('unsupported compression');
    out.set(path_basename(name), data);
    out.set(name, data);
  }
  return out;
}

function path_basename(name) {
  const i = name.lastIndexOf('/');
  return i < 0 ? name : name.slice(i + 1);
}
