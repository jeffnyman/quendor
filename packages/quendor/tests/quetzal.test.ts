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
