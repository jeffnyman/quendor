import { expect, test } from "vite-plus/test";
import { Story } from "../src/story.ts";
import { HeaderOffset } from "../src/header.ts";
import {
  dumpAbbreviations,
  dumpAll,
  dumpDictionary,
  dumpHeader,
  dumpObjects,
} from "../src/dump.ts";

/** "a", as a single terminated Z-word (zchar 6 in the default A0 alphabet). */
const A_ZWORD = (6 << 10) | (5 << 5) | 5 | 0x8000;

function buildStory(fill: (bytes: Uint8Array) => void): Story {
  const bytes = new Uint8Array(80);

  bytes[HeaderOffset.Version] = 3; // scale 2
  bytes[HeaderOffset.FileLength + 1] = 40; // 40 * 2 = 80

  for (let i = 0x40; i < 80; i++) {
    bytes[i] = 1;
  }

  fill(bytes);

  return new Story(bytes);
}

test("dumpHeader reports version, release, and serial number", () => {
  const story = buildStory((bytes) => {
    bytes[HeaderOffset.Release + 1] = 3;

    const serial = "861222";

    for (let i = 0; i < serial.length; i++) {
      bytes[HeaderOffset.SerialNumber + i] = serial.charCodeAt(i);
    }
  });

  const output = dumpHeader(story);

  expect(output).toMatch(/Z-code version\s+3/);
  expect(output).toMatch(/Release number\s+3/);
  expect(output).toContain("861222");
});

test("dumpHeader marks a matching checksum", () => {
  const story = buildStory((bytes) => {
    bytes[HeaderOffset.Checksum + 1] = 80 - 0x40; // 16 bytes of value 1
  });

  expect(dumpHeader(story)).toContain("✓ match");
});

test("dumpHeader marks a mismatched checksum", () => {
  const story = buildStory((bytes) => {
    bytes[HeaderOffset.Checksum + 1] = 99; // deliberately wrong
  });

  expect(dumpHeader(story)).toContain("✗ MISMATCH");
});

/**
 * All 96 abbreviation-table entries point at the same shared, single-word
 * string, so the tests below can check the entry count and slicing logic
 * without decoding 96 distinct strings.
 */
function buildAbbreviationStory(version: number, tableAddress: number): Story {
  const bytes = new Uint8Array(310);
  const sharedWordAddress = 150; // word address -> byte address 300

  bytes[HeaderOffset.Version] = version;
  bytes[HeaderOffset.AbbreviationsTableAddress] = (tableAddress >> 8) & 0xff;
  bytes[HeaderOffset.AbbreviationsTableAddress + 1] = tableAddress & 0xff;

  for (let i = 0; i < 96; i++) {
    bytes[tableAddress + i * 2] = (sharedWordAddress >> 8) & 0xff;
    bytes[tableAddress + i * 2 + 1] = sharedWordAddress & 0xff;
  }

  bytes[300] = (A_ZWORD >> 8) & 0xff;
  bytes[301] = A_ZWORD & 0xff;

  return new Story(bytes);
}

test("dumpAbbreviations reports none for v1 (the format has no abbreviations)", () => {
  const story = buildAbbreviationStory(1, 64);

  expect(dumpAbbreviations(story)).toBe("Abbreviations: none");
});

test("dumpAbbreviations reports none when the table address is zero", () => {
  const bytes = new Uint8Array(42);

  bytes[HeaderOffset.Version] = 3;

  expect(dumpAbbreviations(new Story(bytes))).toBe("Abbreviations: none");
});

test("dumpAbbreviations lists all 96 decoded entries for v3+", () => {
  const story = buildAbbreviationStory(3, 64);
  const output = dumpAbbreviations(story);

  expect(output).toContain("Abbreviations: 96");
  expect(output).toContain('[ 0] "a"');
  expect(output).toContain('[95] "a"');
});

test("dumpAbbreviations keeps only the first 32 entries for v2", () => {
  const story = buildAbbreviationStory(2, 64);
  const output = dumpAbbreviations(story);

  expect(output).toContain("Abbreviations: 32");
  expect(output).toContain("[31]");
  expect(output).not.toContain("[32]");
});

/**
 * A v3 object table with two objects: object 1 has a short name, one set
 * attribute, and one property; object 2 has neither a name nor properties.
 * Object 2's property table sits right where a third entry would begin, so
 * dumpObjects (via ObjectTable.getObjectCount) stops after two objects.
 */
function buildObjectsStory(): Story {
  const bytes = new Uint8Array(220);

  bytes[HeaderOffset.Version] = 3;
  bytes[HeaderOffset.ObjectTableAddress + 1] = 64;

  // Object 1 @126: attribute 0 set, sibling 2, property table @200.
  bytes[126] = 0x80;
  bytes[130] = 0; // parent
  bytes[131] = 2; // sibling
  bytes[132] = 0; // child
  bytes[134] = 200; // property table address

  // Object 2 @135: no attributes, parent 1, property table @144 (boundary).
  bytes[139] = 1; // parent
  bytes[140] = 0; // sibling
  bytes[141] = 0; // child
  bytes[143] = 144; // property table address

  // Object 2's property table @144: no name, no properties.
  bytes[144] = 0;
  bytes[145] = 0;

  // Object 1's property table @200: 1-word name "a", one property.
  bytes[200] = 1; // short-name length (words)
  bytes[201] = (A_ZWORD >> 8) & 0xff;
  bytes[202] = A_ZWORD & 0xff;
  bytes[203] = ((2 - 1) << 5) | 7; // property 7, length 2
  bytes[204] = 0xab;
  bytes[205] = 0xcd;
  bytes[206] = 0; // terminator

  return new Story(bytes);
}

test("dumpObjects reports a named object's attributes, tree links, and properties", () => {
  const output = dumpObjects(buildObjectsStory());

  expect(output).toContain('[1] "a"');
  expect(output).toContain("Attributes: 0");
  expect(output).toContain("Parent: 0  Sibling: 2  Child: 0");
  expect(output).toContain("[7] ab cd");
});

test("dumpObjects reports 'none' for an object with no name, attributes, or properties", () => {
  const output = dumpObjects(buildObjectsStory());

  expect(output).toContain('[2] ""');
  expect(output).toContain("Attributes: none");
  expect(output).toContain("Parent: 1  Sibling: 0  Child: 0");
  expect(output).toContain("Properties: none");
});

/** A v3 dictionary with one word separator and two entries, each with 2 trailing data bytes. */
function buildDictionaryStory(count: number): Story {
  const bytes = new Uint8Array(90);

  bytes[HeaderOffset.Version] = 3;
  bytes[HeaderOffset.DictionaryAddress + 1] = 64;

  bytes[64] = 1; // separator count
  bytes[65] = ".".charCodeAt(0);
  bytes[66] = 6; // entry length: 4 word bytes + 2 data bytes
  bytes[67] = (count >> 8) & 0xff;
  bytes[68] = count & 0xff;

  for (const [entryAddr, data] of [
    [69, [0x01, 0x02]],
    [75, [0x03, 0x04]],
  ] as const) {
    bytes[entryAddr] = (A_ZWORD >> 8) & 0xff;
    bytes[entryAddr + 1] = A_ZWORD & 0xff;
    bytes[entryAddr + 4] = data[0];
    bytes[entryAddr + 5] = data[1];
  }

  return new Story(bytes);
}

test("dumpDictionary reports separators, entry metadata, and decoded entries", () => {
  const output = dumpDictionary(buildDictionaryStory(2));

  expect(output).toContain("Dictionary: 2 entries");
  expect(output).toContain('Word separators: "."');
  expect(output).toContain("Entry length: 6 bytes (sorted)");
  expect(output).toContain('"a"  01 02');
  expect(output).toContain('"a"  03 04');
});

test("dumpDictionary reports 'unsorted' for a negatively-encoded entry count", () => {
  const output = dumpDictionary(buildDictionaryStory(0x10000 - 2));

  expect(output).toContain("Dictionary: 2 entries");
  expect(output).toContain("(unsorted)");
});

test("dumpDictionary reads trailing data after a 6-byte encoded word for v4+", () => {
  const bytes = new Uint8Array(90);

  bytes[HeaderOffset.Version] = 4;
  bytes[HeaderOffset.DictionaryAddress + 1] = 64;

  bytes[64] = 0; // separator count
  bytes[65] = 8; // entry length: 6 word bytes + 2 data bytes
  bytes[67] = 1; // entry count (sorted)

  bytes[68] = (A_ZWORD >> 8) & 0xff;
  bytes[69] = A_ZWORD & 0xff;
  // bytes 70-73 are the rest of the 6-byte encoded-word slot, unused by "a"
  bytes[74] = 0xaa;
  bytes[75] = 0xbb;

  expect(dumpDictionary(new Story(bytes))).toContain('"a"  aa bb');
});

test("dumpDictionary falls back to '<?>' when an entry fails to decode", () => {
  const bytes = new Uint8Array(80);
  // An incomplete 10-bit ZSCII character (double-shift to A2, then the
  // multi-byte marker, with no room left for its two data Z-chars).
  const brokenZword = (5 << 10) | (6 << 5) | 5 | 0x8000;

  bytes[HeaderOffset.Version] = 3;
  bytes[HeaderOffset.DictionaryAddress + 1] = 64;

  bytes[64] = 0; // separator count
  bytes[65] = 4; // entry length: 4 word bytes, no data
  bytes[67] = 1; // entry count (sorted)
  bytes[68] = (brokenZword >> 8) & 0xff;
  bytes[69] = brokenZword & 0xff;

  expect(dumpDictionary(new Story(bytes))).toContain('"<?>"');
});

test("dumpAll composes header, abbreviations, objects, and dictionary sections in order", () => {
  const bytes = new Uint8Array(320);

  bytes[HeaderOffset.Version] = 3;
  bytes[HeaderOffset.ObjectTableAddress + 1] = 64;
  bytes[HeaderOffset.DictionaryAddress + 1] = 150; // fits in one byte

  // Abbreviations table address left at 0 -> "Abbreviations: none".

  // A single object with a short name, reusing the same layout as
  // buildObjectsStory's object 1 (property table right at the boundary).
  bytes[126] = 0x80;
  bytes[134] = 89; // property table address, right after the one entry
  bytes[89] = 1; // short-name length (words)
  bytes[90] = (A_ZWORD >> 8) & 0xff;
  bytes[91] = A_ZWORD & 0xff;
  bytes[92] = 0; // terminator (no properties)

  // A single-entry dictionary at byte address 150.
  bytes[150] = 0; // separator count
  bytes[151] = 4; // entry length
  bytes[153] = 1; // entry count (sorted)
  bytes[154] = (A_ZWORD >> 8) & 0xff;
  bytes[155] = A_ZWORD & 0xff;

  const output = dumpAll(new Story(bytes));

  const headerAt = output.indexOf("=== HEADER ===");
  const abbrevsAt = output.indexOf("=== ABBREVIATIONS ===");
  const objectsAt = output.indexOf("=== OBJECTS ===");
  const dictionaryAt = output.indexOf("=== DICTIONARY ===");

  expect(headerAt).toBeGreaterThanOrEqual(0);
  expect(abbrevsAt).toBeGreaterThan(headerAt);
  expect(objectsAt).toBeGreaterThan(abbrevsAt);
  expect(dictionaryAt).toBeGreaterThan(objectsAt);

  expect(output).toContain("Abbreviations: none");
  expect(output).toContain('[1] "a"');
  expect(output).toContain('"a"');
});
