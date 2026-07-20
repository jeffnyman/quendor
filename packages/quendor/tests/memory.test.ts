import { expect, test, vi } from "vite-plus/test";
import { Memory } from "../src/memory.ts";

test("stores the given bytes", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const memory = new Memory(bytes);

  expect(memory.bytes).toBe(bytes);
});

test("size reflects the byte length", () => {
  const memory = new Memory(new Uint8Array(42));

  expect(memory.size).toBe(42);
});

test("size is zero for empty memory", () => {
  const memory = new Memory(new Uint8Array(0));

  expect(memory.size).toBe(0);
});

test("readByte reads the byte at the given address", () => {
  const memory = new Memory(new Uint8Array([10, 20, 30]));

  expect(memory.readByte(1)).toBe(20);
});

test("readByte throws when the address is out of range", () => {
  const memory = new Memory(new Uint8Array(3));

  expect(() => memory.readByte(3)).toThrow(RangeError);
});

test("readBytes reads a slice starting at the given address", () => {
  const memory = new Memory(new Uint8Array([1, 2, 3, 4, 5]));

  expect(memory.readBytes(1, 3)).toEqual(new Uint8Array([2, 3, 4]));
});

test("readBytes throws when the range extends past the end", () => {
  const memory = new Memory(new Uint8Array(3));

  expect(() => memory.readBytes(1, 3)).toThrow(RangeError);
});

test("readWord reads a big-endian 16-bit value", () => {
  const memory = new Memory(new Uint8Array([0x01, 0x02]));

  expect(memory.readWord(0)).toBe(0x0102);
});

test("readWord throws when the address is out of range", () => {
  const memory = new Memory(new Uint8Array(1));

  expect(() => memory.readWord(0)).toThrow(RangeError);
});

test("writeByte stores the value at the given address", () => {
  const memory = new Memory(new Uint8Array(3));

  memory.writeByte(1, 20);

  expect(memory.readByte(1)).toBe(20);
});

test("writeByte masks the value to 8 bits", () => {
  const memory = new Memory(new Uint8Array(1));

  memory.writeByte(0, 0x1ff);

  expect(memory.readByte(0)).toBe(0xff);
});

test("writeByte throws when the address is out of range", () => {
  const memory = new Memory(new Uint8Array(3));

  expect(() => memory.writeByte(3, 1)).toThrow(RangeError);
});

test("writeByte notifies onWrite with the address and byte size", () => {
  const memory = new Memory(new Uint8Array(3));
  const onWrite = vi.fn<(address: number, size: number) => void>();

  memory.onWrite = onWrite;
  memory.writeByte(1, 20);

  expect(onWrite).toHaveBeenCalledWith(1, 1);
});

test("writeByte does not require onWrite to be set", () => {
  const memory = new Memory(new Uint8Array(3));

  expect(() => memory.writeByte(1, 20)).not.toThrow();
});
