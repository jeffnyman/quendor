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
    stringsOffset: 0,
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

// --- dictionary encoding / lookup / tokenizing ---

/** A ZText whose memory holds only a word-separator header at address 0. */
function withSeparators(seps: string[], version = 3): { text: ZText; dictAddress: number } {
  const bytes = new Uint8Array(1 + seps.length);

  bytes[0] = seps.length;
  seps.forEach((s, i) => {
    bytes[1 + i] = s.charCodeAt(0);
  });

  return { text: newText(version, {}, new Memory(bytes)), dictAddress: 0 };
}

/**
 * A ZText whose memory holds a real dictionary at address 0, its entries built
 * from `encodeWord(word)` (no data bytes). `words` must be in ascending encoded
 * order when `sorted` (for lowercase words that matches alphabetical order).
 */
function buildDictionary(
  words: string[],
  version = 3,
  sorted = true,
): { text: ZText; dictAddress: number; base: number; entryLength: number } {
  const encoder = newText(version); // encodeWord is memory-independent
  const resolution = version <= 3 ? 2 : 3;
  const entryLength = resolution * 2;
  const base = 4;
  const bytes = new Uint8Array(base + words.length * entryLength);

  bytes[0] = 0; // no word separators
  bytes[1] = entryLength;

  const count = sorted ? words.length : 0x10000 - words.length; // negative => unsorted
  bytes[2] = (count >> 8) & 0xff;
  bytes[3] = count & 0xff;

  words.forEach((word, i) => {
    let p = base + i * entryLength;

    for (const w of encoder.encodeWord(word)) {
      bytes[p++] = (w >> 8) & 0xff;
      bytes[p++] = w & 0xff;
    }
  });

  return { text: newText(version, {}, new Memory(bytes)), dictAddress: 0, base, entryLength };
}

test("encodeWord round-trips a lowercase word through decode", () => {
  const text = newText(3);

  expect(text.decode(text.encodeWord("north"))).toBe("north");
});

test("encodeWord round-trips a character from a shifted alphabet", () => {
  const text = newText(3);

  expect(text.decode(text.encodeWord("1"))).toBe("1");
});

test("encodeWord truncates a word longer than the dictionary resolution", () => {
  const text = newText(3); // resolution 2 -> at most 6 Z-characters

  expect(text.decode(text.encodeWord("abcdefghij"))).toBe("abcdef");
});

test("encodeWord packs into `resolution` words and sets the terminator bit", () => {
  const words = newText(3).encodeWord("north");

  expect(words).toHaveLength(2);
  expect(words[words.length - 1] & 0x8000).not.toBe(0);
});

test("encodeWord uses three words for version 4 and later", () => {
  expect(newText(5).encodeWord("north")).toHaveLength(3);
});

test("lookupWord finds a word in a sorted dictionary and returns its entry address", () => {
  const { text, dictAddress, base, entryLength } = buildDictionary(["north", "south"]);

  expect(text.lookupWord("north", dictAddress)).toBe(base);
  expect(text.lookupWord("south", dictAddress)).toBe(base + entryLength);
});

test("lookupWord returns 0 for a word not in the dictionary", () => {
  const { text, dictAddress } = buildDictionary(["north", "south"]);

  expect(text.lookupWord("east", dictAddress)).toBe(0);
});

test("lookupWord scans an unsorted dictionary (negative entry count)", () => {
  const { text, dictAddress, base, entryLength } = buildDictionary(["south", "north"], 3, false);

  expect(text.lookupWord("north", dictAddress)).toBe(base + entryLength);
  expect(text.lookupWord("zzz", dictAddress)).toBe(0);
});

test("tokenizeCommand splits on spaces, tracking start and length", () => {
  const { text, dictAddress } = withSeparators([]);

  expect(text.tokenizeCommand("go north", dictAddress)).toEqual([
    { start: 0, length: 2, text: "go" },
    { start: 3, length: 5, text: "north" },
  ]);
});

test("tokenizeCommand emits a separator as its own single-character token", () => {
  const { text, dictAddress } = withSeparators(["."]);

  expect(text.tokenizeCommand("wait.", dictAddress)).toEqual([
    { start: 0, length: 4, text: "wait" },
    { start: 4, length: 1, text: "." },
  ]);
});

test("tokenizeCommand handles a separator that opens the input", () => {
  const { text, dictAddress } = withSeparators([","]);

  expect(text.tokenizeCommand(",x", dictAddress)).toEqual([
    { start: 0, length: 1, text: "," },
    { start: 1, length: 1, text: "x" },
  ]);
});

test("encodeWord escapes a character outside the alphabets as a 10-bit ZSCII sequence", () => {
  const text = newText(3);

  // '@' is in none of the alphabets (A0/A1/A2), so it encodes as the 5,6,hi,lo
  // ZSCII escape — and must survive a decode round-trip.
  expect(text.decode(text.encodeWord("@"))).toBe("@");
});
