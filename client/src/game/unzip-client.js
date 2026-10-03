// A tiny zip reader for the browser, so a forged bundle can be previewed before
// it's ever sent to the server. Reads the central directory and inflates
// stored (0) or deflated (8) entries with the platform's own DecompressionStream
// — no dependency. The server opens the same bundle in overrides.py.

const EOCD = 0x06054b50;
const CEN = 0x02014b50;

export async function unzipClient(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 22 - 65536; i--) {
    if (view.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no EOCD');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== CEN) throw new Error('bad central entry');
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const lho = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lNameLen = view.getUint16(lho + 26, true);
    const lExtraLen = view.getUint16(lho + 28, true);
    const start = lho + 30 + lNameLen + lExtraLen;
    const comp = bytes.subarray(start, start + compSize);
    let data;
    if (method === 0) data = comp.slice();
    else if (method === 8) {
      const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error('unsupported compression');
    const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
    out.set(base, data);
    out.set(name, data);
  }
  return out;
}
