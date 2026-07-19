import { expect, test } from "vite-plus/test";
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
