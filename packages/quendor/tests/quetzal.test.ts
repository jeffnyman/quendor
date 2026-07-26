import { expect, test } from "vite-plus/test";
import { decodeQuetzal, encodeQuetzal } from "../src/quetzal.ts";
import type { QuetzalState } from "../src/quetzal.ts";

// The Quetzal codec is a pure byte<->state pair (no file I/O), so the whole
// format round-trips in memory. These cover the save-file structure and the
// two frame shapes that exercise the fiddly encodings (locals + eval stack, and
// a result-discarding frame with neither).

function sampleState(dynamicMemory: Uint8Array): QuetzalState {
  return {
    release: 0x0102,
    serial: "860725", // exactly 6 chars
    checksum: 0xabcd,
    pc: 0x123456, // 24-bit
    dynamicMemory,
    frames: [
      {
        returnPC: 0x1000,
        locals: [0x1111, 0x2222, 0x3333],
        storeVariable: 0x05,
        argumentCount: 2,
        evalStack: [0x00aa, 0x00bb],
      },
      { returnPC: 0x2000, locals: [], storeVariable: -1, argumentCount: 0, evalStack: [] },
    ],
  };
}

test("encode/decode round-trips identity, PC, dirty memory, and frames", () => {
  const original = Uint8Array.from({ length: 64 }, (_, i) => i); // "story-initial" dynamic memory
  const current = original.slice();
  current[10] = 0x99; // a couple of dirty bytes vs the original
  current[11] = 0x88;

  const state = sampleState(current);
  const decoded = decodeQuetzal(encodeQuetzal(state, original), original, current.length);

  expect(decoded.release).toBe(state.release);
  expect(decoded.serial).toBe(state.serial);
  expect(decoded.checksum).toBe(state.checksum);
  expect(decoded.pc).toBe(state.pc);
  expect(Array.from(decoded.dynamicMemory)).toEqual(Array.from(current));
  expect(decoded.frames).toEqual(state.frames);
});

test("CMem compression round-trips unchanged memory (all-zero delta => pure RLE)", () => {
  const original = Uint8Array.from({ length: 64 }, (_, i) => (i * 7) & 0xff);
  const current = original.slice(); // identical to the original

  const decoded = decodeQuetzal(
    encodeQuetzal(sampleState(current), original),
    original,
    current.length,
  );

  expect(Array.from(decoded.dynamicMemory)).toEqual(Array.from(original));
});

test("preserves each frame's discard flag and argument count", () => {
  const mem = new Uint8Array(16);
  const decoded = decodeQuetzal(encodeQuetzal(sampleState(mem), mem), mem, mem.length);

  expect(decoded.frames[0].storeVariable).toBe(0x05); // a real store variable
  expect(decoded.frames[0].argumentCount).toBe(2);
  expect(decoded.frames[1].storeVariable).toBe(-1); // result discarded
  expect(decoded.frames[1].argumentCount).toBe(0);
});

test("rejects bytes that are not an IFZS FORM", () => {
  const notQuetzal = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

  expect(() => decodeQuetzal(notQuetzal, new Uint8Array(16), 16)).toThrow();
});

// --- malformed / partial saves ---------------------------------------------
//
// The round-trips above only ever produce well-formed blobs, so these build
// IFZS FORMs by hand to drive the decoder's chunk-structure error paths and its
// UMem (uncompressed) branch.

function iffChunk(type: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2;
  const c = new Uint8Array(8 + data.length + pad);
  const v = new DataView(c.buffer);

  for (let i = 0; i < 4; i++) c[i] = type.charCodeAt(i);
  v.setUint32(4, data.length);
  c.set(data, 8);

  return c;
}

function ifzs(chunks: { type: string; data: Uint8Array }[]): Uint8Array {
  const built = chunks.map((c) => iffChunk(c.type, c.data));
  const body = built.reduce((n, c) => n + c.length, 0);
  const form = new Uint8Array(12 + body);
  const v = new DataView(form.buffer);

  for (let i = 0; i < 4; i++) form[i] = "FORM".charCodeAt(i);
  v.setUint32(4, 4 + body);
  for (let i = 0; i < 4; i++) form[8 + i] = "IFZS".charCodeAt(i);

  let off = 12;
  for (const c of built) {
    form.set(c, off);
    off += c.length;
  }

  return form;
}

// A valid 13-byte IFhd: release, 6-char serial, checksum, 3-byte PC.
function ifhdData(): Uint8Array {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);

  v.setUint16(0, 0x0102);
  for (let i = 0; i < 6; i++) d[2 + i] = "860725".charCodeAt(i);
  v.setUint16(8, 0xabcd);
  d[10] = 0x12;
  d[11] = 0x34;
  d[12] = 0x56;

  return d;
}

const emptyStks = { type: "Stks", data: new Uint8Array(0) };

test("decodeQuetzal throws when the IFhd chunk is missing", () => {
  const blob = ifzs([{ type: "UMem", data: new Uint8Array(8) }, emptyStks]);

  expect(() => decodeQuetzal(blob, new Uint8Array(8), 8)).toThrow("IFhd");
});

test("decodeQuetzal reads an uncompressed UMem chunk", () => {
  const mem = Uint8Array.from({ length: 8 }, (_, i) => i + 1);
  const blob = ifzs([{ type: "IFhd", data: ifhdData() }, { type: "UMem", data: mem }, emptyStks]);

  const decoded = decodeQuetzal(blob, new Uint8Array(8), 8);

  expect(Array.from(decoded.dynamicMemory)).toEqual(Array.from(mem));
});

test("decodeQuetzal throws when neither CMem nor UMem is present", () => {
  const blob = ifzs([{ type: "IFhd", data: ifhdData() }, emptyStks]);

  expect(() => decodeQuetzal(blob, new Uint8Array(8), 8)).toThrow("CMem/UMem");
});

test("decodeQuetzal throws when the Stks chunk is missing", () => {
  const blob = ifzs([
    { type: "IFhd", data: ifhdData() },
    { type: "UMem", data: new Uint8Array(8) },
  ]);

  expect(() => decodeQuetzal(blob, new Uint8Array(8), 8)).toThrow("Stks");
});

test("encode/decode tolerate a story image longer than the original snapshot", () => {
  // A shorter original snapshot: bytes past its end are treated as 0 (the `?? 0`
  // fallbacks in both compress and decompress). Trailing zeros form an RLE run.
  const original = new Uint8Array(16);
  const current = Uint8Array.from({ length: 64 }, (_, i) => (i < 32 ? (i + 1) & 0xff : 0));

  const decoded = decodeQuetzal(encodeQuetzal(sampleState(current), original), original, 64);

  expect(Array.from(decoded.dynamicMemory)).toEqual(Array.from(current));
});

test("decodeQuetzal fills the remainder from the original when a CMem is truncated", () => {
  // A lone zero-run marker with no length byte, against an empty original: the
  // decoder must fill the rest of the image from the (zero) original, not crash.
  const blob = ifzs([
    { type: "IFhd", data: ifhdData() },
    { type: "CMem", data: new Uint8Array([0x00]) },
    emptyStks,
  ]);

  const decoded = decodeQuetzal(blob, new Uint8Array(0), 4);

  expect(Array.from(decoded.dynamicMemory)).toEqual([0, 0, 0, 0]);
});
