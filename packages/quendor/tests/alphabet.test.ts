import { expect, test } from "vite-plus/test";
import { Memory } from "../src/memory.ts";
import { AlphabetTable } from "../src/alphabet.ts";

test("version 1 uses the A2_V1 alphabet (digit, not newline, at index 7)", () => {
  const alphabet = new AlphabetTable(1, new Memory(new Uint8Array(0)), 0);

  alphabet.doubleShift();

  expect(alphabet.readChar(7)).toBe("0");
});

test("version 2+ uses the standard A2 alphabet (newline at index 7)", () => {
  const alphabet = new AlphabetTable(2, new Memory(new Uint8Array(0)), 0);

  alphabet.doubleShift();

  expect(alphabet.readChar(7)).toBe("\n");
});

test("version 5-8 uses the standard alphabet when alphabetTableAddress is 0", () => {
  const alphabet = new AlphabetTable(5, new Memory(new Uint8Array(0)), 0);

  expect(alphabet.readChar(6)).toBe("a");
});

test("version 5-8 reads a custom alphabet table when alphabetTableAddress is set", () => {
  const tableAddress = 10;
  const bytes = new Uint8Array(tableAddress + 78);

  bytes[tableAddress] = "Q".charCodeAt(0); // custom A0[6]
  bytes[tableAddress + 26] = "q".charCodeAt(0); // custom A1[6]
  bytes[tableAddress + 53] = 0x5e; // custom A2[7]: '^' maps to newline

  const alphabet = new AlphabetTable(5, new Memory(bytes), tableAddress);

  expect(alphabet.readChar(6)).toBe("Q");

  alphabet.shift();
  expect(alphabet.readChar(6)).toBe("q");

  alphabet.doubleShift();
  expect(alphabet.readChar(7)).toBe("\n");
});

test("throws for a version outside 1-8", () => {
  expect(() => new AlphabetTable(0, new Memory(new Uint8Array(0)), 0)).toThrow(/Invalid version/);
});

test("shift temporarily selects the next alphabet, then resets after a char read", () => {
  const alphabet = new AlphabetTable(3, new Memory(new Uint8Array(0)), 0);

  alphabet.shift();
  expect(alphabet.current).toBe(1);

  alphabet.readChar(6);
  expect(alphabet.current).toBe(0);
});

test("doubleShift temporarily selects the alphabet two ahead", () => {
  const alphabet = new AlphabetTable(3, new Memory(new Uint8Array(0)), 0);

  alphabet.doubleShift();

  expect(alphabet.current).toBe(2);
});

test("shiftLock changes the base alphabet permanently", () => {
  const alphabet = new AlphabetTable(3, new Memory(new Uint8Array(0)), 0);

  alphabet.shiftLock();
  expect(alphabet.current).toBe(1);

  alphabet.readChar(6); // does not reset past a lock
  expect(alphabet.current).toBe(1);
});

test("doubleShiftLock changes the base alphabet by two, permanently", () => {
  const alphabet = new AlphabetTable(3, new Memory(new Uint8Array(0)), 0);

  alphabet.doubleShiftLock();
  expect(alphabet.current).toBe(2);

  alphabet.readChar(6);
  expect(alphabet.current).toBe(2);
});

test("fullReset clears both the base and current alphabet", () => {
  const alphabet = new AlphabetTable(3, new Memory(new Uint8Array(0)), 0);

  alphabet.shiftLock();
  alphabet.fullReset();

  expect(alphabet.current).toBe(0);

  alphabet.readChar(6);
  expect(alphabet.current).toBe(0);
});

test("findChar locates a character's alphabet set and index", () => {
  const alphabet = new AlphabetTable(3, new Memory(new Uint8Array(0)), 0);

  expect(alphabet.findChar("a")).toEqual({ set: 0, index: 6 });
  expect(alphabet.findChar("A")).toEqual({ set: 1, index: 6 });
});

test("findChar returns null for a character in no alphabet", () => {
  const alphabet = new AlphabetTable(3, new Memory(new Uint8Array(0)), 0);

  expect(alphabet.findChar("@")).toBeNull();
});

test("readChar throws for a zchar outside the printable range", () => {
  const alphabet = new AlphabetTable(3, new Memory(new Uint8Array(0)), 0);

  expect(() => alphabet.readChar(5)).toThrow(RangeError);
  expect(() => alphabet.readChar(32)).toThrow(RangeError);
});
