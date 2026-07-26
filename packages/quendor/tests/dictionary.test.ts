import { expect, test } from "vite-plus/test";
import { Story } from "../src/story.ts";
import { HeaderOffset } from "../src/header.ts";
import { Machine } from "../src/machine.ts";

// The first (only) dictionary entry sits after: separator-count byte,
// entry-length byte, and the 2-byte entry count.
const DICT_ADDR = 0x40;
const ENTRY_ADDR = DICT_ADDR + 4; // 0x44

/**
 * A v3 story whose dictionary holds a single entry: the encoded word "abcdef".
 * z-chars 6..11 map to a..f in the default alphabet and need no shift or
 * padding characters, so the two-word encoding is unambiguous.
 */
function storyWithDictionary(): Story {
  const bytes = new Uint8Array(128);
  bytes[HeaderOffset.Version] = 3;

  // Dictionary pointer at 0x08 (word) -> DICT_ADDR.
  bytes[0x08] = (DICT_ADDR >> 8) & 0xff;
  bytes[0x09] = DICT_ADDR & 0xff;

  let a = DICT_ADDR;
  bytes[a++] = 0; // separator count
  bytes[a++] = 4; // entry length (v3: 4 bytes)
  bytes[a++] = 0x00; // entry count (word, big-endian) ...
  bytes[a++] = 0x01; // ... = 1 entry

  // "abcdef": word1 = a,b,c; word2 = d,e,f with the end-bit (0x8000) set.
  bytes[a++] = 0x18;
  bytes[a++] = 0xe8;
  bytes[a++] = 0xa5;
  bytes[a++] = 0x4b;

  return new Story(bytes);
}

test("decodes the word at a dictionary entry address", () => {
  const machine = new Machine(storyWithDictionary());
  expect(machine.getDictionaryWord(ENTRY_ADDR)).toBe("abcdef");
});

test("returns null for an address that is not an entry", () => {
  const machine = new Machine(storyWithDictionary());
  expect(machine.getDictionaryWord(DICT_ADDR)).toBeNull(); // the header byte
  expect(machine.getDictionaryWord(ENTRY_ADDR + 1)).toBeNull(); // mid-entry
});

test("returns a stable result across calls (the index is cached)", () => {
  const machine = new Machine(storyWithDictionary());
  const first = machine.getDictionaryWord(ENTRY_ADDR);
  expect(machine.getDictionaryWord(ENTRY_ADDR)).toBe(first);
  expect(first).toBe("abcdef");
});
