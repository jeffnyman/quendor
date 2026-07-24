/**
 * Quetzal save-file format (the standard Z-Machine save format).
 *
 * A Quetzal file is an IFF FORM of type "IFZS" containing:
 *  - IFhd: story identity (release, serial, checksum) + the saved PC.
 *  - CMem / UMem: the dynamic memory (compressed via XOR-against-original +
 *    run-length-encoded zeros, or uncompressed).
 *  - Stks: the call stack — one frame per active routine, oldest first.
 *
 * See https://www.inform-fiction.org/zmachine/standards/quetzal/
 */

export interface QuetzalFrame {
  returnPC: number;
  locals: number[];
  /** Store variable number, or -1 if the call discards its result. */
  storeVariable: number;
  argumentCount: number;
  evalStack: number[];
}

export interface QuetzalState {
  release: number;
  serial: string; // exactly 6 characters
  checksum: number;
  /** Saved PC — points at the save/restore instruction's result operand. */
  pc: number;
  /** Current dynamic memory (bytes 0 .. static base). */
  dynamicMemory: Uint8Array;
  frames: QuetzalFrame[];
}

export interface DecodedQuetzal {
  release: number;
  serial: string;
  checksum: number;
  pc: number;
  dynamicMemory: Uint8Array;
  frames: QuetzalFrame[];
}

interface ParsedChunk {
  type: string;
  data: Uint8Array;
}

// --- little IFF writer over a growable byte array ---

class ByteWriter {
  readonly bytes: number[] = [];

  u8(v: number): void {
    this.bytes.push(v & 0xff);
  }

  u16(v: number): void {
    this.u8(v >> 8);
    this.u8(v);
  }

  u24(v: number): void {
    this.u8(v >> 16);
    this.u8(v >> 8);
    this.u8(v);
  }

  u32(v: number): void {
    this.u8(v >>> 24);
    this.u8(v >> 16);
    this.u8(v >> 8);
    this.u8(v);
  }

  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }

  raw(data: number[] | Uint8Array): void {
    for (const b of data) this.u8(b);
  }
}

export function encodeQuetzal(state: QuetzalState, originalDynamic: Uint8Array): Uint8Array {
  // IFhd
  const ifhd = new ByteWriter();

  ifhd.u16(state.release);

  for (let i = 0; i < 6; i++) {
    ifhd.u8(state.serial.charCodeAt(i) || 0);
  }

  ifhd.u16(state.checksum);
  ifhd.u24(state.pc);

  // CMem
  const cmem = compressMemory(state.dynamicMemory, originalDynamic);

  // Stks
  const stks = new ByteWriter();

  for (const frame of state.frames) {
    stks.u24(frame.returnPC);

    const discard = frame.storeVariable < 0;

    stks.u8((frame.locals.length & 0x0f) | (discard ? 0x10 : 0));
    stks.u8(discard ? 0 : frame.storeVariable);
    stks.u8((1 << Math.min(frame.argumentCount, 7)) - 1);
    stks.u16(frame.evalStack.length);

    for (const local of frame.locals) stks.u16(local);
    for (const word of frame.evalStack) stks.u16(word);
  }

  const body = [...chunk("IFhd", ifhd.bytes), ...chunk("CMem", cmem), ...chunk("Stks", stks.bytes)];

  const form = new ByteWriter();

  form.ascii("FORM");
  form.u32(body.length + 4); // + "IFZS"
  form.ascii("IFZS");
  form.raw(body);

  return new Uint8Array(form.bytes);
}

export function decodeQuetzal(
  bytes: Uint8Array,
  originalDynamic: Uint8Array,
  dynamicLength: number,
): DecodedQuetzal {
  const chunks = parseChunks(bytes);
  const find = (t: string): ParsedChunk | undefined => chunks.find((c) => c.type === t);
  const ifhd = find("IFhd");

  if (!ifhd) {
    throw new Error("Quetzal: missing IFhd chunk");
  }

  const h = new DataView(ifhd.data.buffer, ifhd.data.byteOffset, ifhd.data.byteLength);
  const release = h.getUint16(0);
  let serial = "";

  for (let i = 0; i < 6; i++) {
    serial += String.fromCharCode(ifhd.data[2 + i]);
  }

  const checksum = h.getUint16(8);
  const pc = (ifhd.data[10] << 16) | (ifhd.data[11] << 8) | ifhd.data[12];

  let dynamicMemory: Uint8Array;
  const cmem = find("CMem");
  const umem = find("UMem");

  if (cmem) {
    dynamicMemory = decompressMemory(cmem.data, originalDynamic, dynamicLength);
  } else if (umem) {
    dynamicMemory = umem.data.slice(0, dynamicLength);
  } else {
    throw new Error("Quetzal: missing CMem/UMem chunk");
  }

  const stks = find("Stks");

  if (!stks) {
    throw new Error("Quetzal: missing Stks chunk");
  }

  const frames: QuetzalFrame[] = [];
  const s = new DataView(stks.data.buffer, stks.data.byteOffset, stks.data.byteLength);
  let p = 0;

  while (p + 8 <= stks.data.length) {
    const returnPC = (stks.data[p] << 16) | (stks.data[p + 1] << 8) | stks.data[p + 2];
    const flags = stks.data[p + 3];
    const localCount = flags & 0x0f;
    const discard = (flags & 0x10) !== 0;
    const resultVar = stks.data[p + 4];

    let argsByte = stks.data[p + 5];
    let argumentCount = 0;

    while (argsByte & 1) {
      argumentCount++;
      argsByte >>= 1;
    }

    const evalCount = s.getUint16(p + 6);

    p += 8;

    const locals: number[] = [];

    for (let i = 0; i < localCount; i++) {
      locals.push(s.getUint16(p));
      p += 2;
    }

    const evalStack: number[] = [];

    for (let i = 0; i < evalCount; i++) {
      evalStack.push(s.getUint16(p));
      p += 2;
    }

    frames.push({
      returnPC,
      locals,
      storeVariable: discard ? -1 : resultVar,
      argumentCount,
      evalStack,
    });
  }

  return { release, serial, checksum, pc, dynamicMemory, frames };
}

/** XOR against original, then run-length-encode runs of zero (0x00, n-1 => n zeros). */
function compressMemory(current: Uint8Array, original: Uint8Array): number[] {
  const out: number[] = [];
  const len = current.length;
  let i = 0;

  while (i < len) {
    const delta = current[i] ^ (original[i] ?? 0);

    if (delta !== 0) {
      out.push(delta);
      i++;
    } else {
      let run = 0;

      while (i < len && run < 256 && (current[i] ^ (original[i] ?? 0)) === 0) {
        run++;
        i++;
      }

      out.push(0, run - 1);
    }
  }

  return out;
}

function chunk(type: string, data: number[]): number[] {
  const w = new ByteWriter();

  w.ascii(type);
  w.u32(data.length);
  w.raw(data);

  if (data.length % 2 === 1) w.u8(0); // pad to even

  return w.bytes;
}

function parseChunks(bytes: Uint8Array): ParsedChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (o: number): string =>
    String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);

  if (ascii(0) !== "FORM" || ascii(8) !== "IFZS") {
    throw new Error("not a Quetzal (IFZS) save file");
  }

  const chunks: ParsedChunk[] = [];
  let pos = 12;

  while (pos + 8 <= bytes.length) {
    const type = ascii(pos);
    const len = view.getUint32(pos + 4);
    const data = bytes.subarray(pos + 8, pos + 8 + len);

    chunks.push({ type, data });
    pos += 8 + len + (len % 2); // skip data + pad
  }

  return chunks;
}

function decompressMemory(
  data: Uint8Array,
  original: Uint8Array,
  dynamicLength: number,
): Uint8Array {
  const out = new Uint8Array(dynamicLength);
  let i = 0;
  let o = 0;

  while (i < data.length && o < dynamicLength) {
    const b = data[i++];

    if (b !== 0) {
      out[o] = b ^ (original[o] ?? 0);
      o++;
    } else {
      const run = (data[i++] ?? 0) + 1;

      for (let k = 0; k < run && o < dynamicLength; k++) {
        out[o] = original[o] ?? 0;
        o++;
      }
    }
  }

  // Any remainder matches the original (delta 0).
  for (; o < dynamicLength; o++) {
    out[o] = original[o] ?? 0;
  }

  return out;
}
