import { expect, test } from "vite-plus/test";
import { Memory } from "../src/memory.ts";
import type { Header } from "../src/header.ts";
import { ZText } from "../src/text.ts";

function buildHeader(version: number, overrides: Partial<Header> = {}): Header {
  return {
    version,
    release: 0,
    highMemoryBase: 0,
    initialProgramCounter: 0,
    dictionaryAddress: 0,
    objectTableAddress: 0,
    globalVariablesTableAddress: 0,
    staticMemoryBase: 0,
    serialNumber: "",
    abbreviationsTableAddress: 0,
    fileLength: 0,
    alphabetTableAddress: 0,
    routinesOffset: 0,
    checksum: 0,
    ...overrides,
  };
}

/** Pack Z-characters into Z-words (3 per word), padding with zchar 5 (a harmless double-shift). */
function packZWords(zchars: number[]): number[] {
  const padded = [...zchars];

  while (padded.length % 3 !== 0) padded.push(5);

  const words: number[] = [];

  for (let i = 0; i < padded.length; i += 3) {
    words.push((padded[i] << 10) | (padded[i + 1] << 5) | padded[i + 2]);
  }

  return words;
}

function newText(
  version: number,
  overrides: Partial<Header> = {},
  memory = new Memory(new Uint8Array(0)),
): ZText {
  return new ZText(memory, buildHeader(version, overrides));
}

test("zWordsToZChars unpacks each Z-word into three 5-bit Z-characters", () => {
  const zword = (17 << 10) | (3 << 5) | 22;

  expect(ZText.zWordsToZChars([zword])).toEqual([17, 3, 22]);
});

test("decodes zchar 0 as a space", () => {
  expect(newText(3).decode(packZWords([6, 0, 9]))).toBe("a d");
});

test("v1: zchar 1 is a literal newline", () => {
  expect(newText(1).decode(packZWords([1, 5, 5]))).toBe("\n");
});

test("v1: zchar 2 is a temporary shift to the next alphabet", () => {
  expect(newText(1).decode(packZWords([2, 6, 5]))).toBe("A");
});

test("v1: zchar 3 is a temporary double-shift to the alphabet after that", () => {
  expect(newText(1).decode(packZWords([3, 8, 5]))).toBe("1");
});

test("v2: zchar 1 already triggers abbreviation expansion, not a newline", () => {
  expect(() =>
    newText(2).decode(packZWords([1, 0, 5]), {
      allowAbbreviations: false,
      allowIncompleteMultibyte: false,
    }),
  ).toThrow(/illegal abbreviation/);
});

test("v1/v2: zchar 4 is a shift-lock that persists across characters", () => {
  expect(newText(2).decode(packZWords([4, 6, 6]))).toBe("AA");
});

test("v3+: zchar 4 is a temporary shift for one character only", () => {
  expect(newText(3).decode(packZWords([4, 6, 6]))).toBe("Aa");
});

test("throws when abbreviations are used but not allowed", () => {
  expect(() =>
    newText(3).decode(packZWords([1, 0]), {
      allowAbbreviations: false,
      allowIncompleteMultibyte: false,
    }),
  ).toThrow(/illegal abbreviation/);
});

test("silently drops an abbreviation selector with no following code", () => {
  expect(newText(3).decode(packZWords([6, 0, 1]))).toBe("a ");
});

test("expands an abbreviation by following its pointer into memory", () => {
  const bytes = new Uint8Array(40);

  // Abbreviation 0's pointer (word address 10 -> byte address 20).
  bytes[0] = 0;
  bytes[1] = 10;

  // Abbreviation text at byte 20: single Z-char 'a', terminated.
  const zword = (6 << 10) | (5 << 5) | 5 | 0x8000;

  bytes[20] = (zword >> 8) & 0xff;
  bytes[21] = zword & 0xff;

  const text = newText(3, { abbreviationsTableAddress: 0 }, new Memory(bytes));

  // zchar 1 (set 1), code 0 -> index 32 * (1 - 1) + 0 = 0.
  expect(text.decode(packZWords([1, 0]))).toBe("a");
});

test("zchar 6 in alphabet A2 begins a 10-bit ZSCII character", () => {
  // doubleShift (zchar 5) to A2, then marker (6), then hi=1 lo=5 -> (1 << 5) | 5 = 37 = '%'.
  expect(newText(3).decode(packZWords([5, 6, 1, 5]))).toBe("%");
});

test("zchar 6 outside A2 is an ordinary character, not the ZSCII marker", () => {
  expect(newText(3).decode(packZWords([6, 5, 5]))).toBe("a");
});

test("throws on an incomplete multi-byte ZSCII character by default", () => {
  expect(() => newText(3).decode(packZWords([5, 6, 1]))).toThrow(/Incomplete multi-byte/);
});

test("tolerates an incomplete multi-byte ZSCII character when allowed", () => {
  expect(
    newText(3).decode(packZWords([5, 6, 1]), {
      allowAbbreviations: true,
      allowIncompleteMultibyte: true,
    }),
  ).toBe("");
});

test("decodeAtAddress reads Z-words from memory until the terminator bit", () => {
  const word1 = (6 << 10) | (0 << 5) | 9; // "a d", not terminated
  const word2 = (5 << 10) | (5 << 5) | 5 | 0x8000; // padding, terminated
  const bytes = new Uint8Array(4);

  bytes[0] = (word1 >> 8) & 0xff;
  bytes[1] = word1 & 0xff;
  bytes[2] = (word2 >> 8) & 0xff;
  bytes[3] = word2 & 0xff;

  const text = newText(3, {}, new Memory(bytes));

  expect(text.decodeAtAddress(0)).toBe("a d");
  expect(text.readZWords(0)).toEqual([word1, word2]);
});
