import { expect, test } from "vite-plus/test";
import { Memory } from "../src/memory.ts";
import { readRoutineHeader } from "../src/routine.ts";

/** Build a Memory whose routine header starts at `at`, with trailing padding. */
function memoryWith(at: number, header: number[]): Memory {
  const bytes = new Uint8Array(at + header.length + 8);
  bytes.set(header, at);
  return new Memory(bytes);
}

test("reads a v3 routine header with initial local values", () => {
  // count 2, then two big-endian words: 0x000a and 0x1234, then code.
  const memory = memoryWith(0x40, [0x02, 0x00, 0x0a, 0x12, 0x34, 0xff]);
  const header = readRoutineHeader(memory, 3, 0x40);

  expect(header.address).toBe(0x40);
  expect(header.localCount).toBe(2);
  expect(header.locals).toEqual([0x000a, 0x1234]);
  // header byte (1) + two value words (4) => code begins 5 bytes in.
  expect(header.codeAddress).toBe(0x45);
});

test("v4 still stores initial local values", () => {
  const memory = memoryWith(0, [0x01, 0xab, 0xcd]);
  const header = readRoutineHeader(memory, 4, 0);

  expect(header.locals).toEqual([0xabcd]);
  expect(header.codeAddress).toBe(3);
});

test("v5+ omits local values — locals start at zero", () => {
  // Only the count byte belongs to the header; the following bytes are code.
  const memory = memoryWith(0x10, [0x03, 0xde, 0xad]);
  const header = readRoutineHeader(memory, 5, 0x10);

  expect(header.localCount).toBe(3);
  expect(header.locals).toEqual([0, 0, 0]);
  expect(header.codeAddress).toBe(0x11);
});

test("a routine with zero locals starts its code right after the count byte", () => {
  const memory = memoryWith(0x08, [0x00, 0x01]);

  const v3 = readRoutineHeader(memory, 3, 0x08);
  const v5 = readRoutineHeader(memory, 5, 0x08);

  expect(v3.locals).toEqual([]);
  expect(v3.codeAddress).toBe(0x09);
  expect(v5.codeAddress).toBe(0x09);
});

test("throws on an invalid local count (> 15)", () => {
  const memory = memoryWith(0x20, [0x10]); // 16 locals is out of spec (0..15).
  expect(() => readRoutineHeader(memory, 3, 0x20)).toThrow(/0x20/);
});
