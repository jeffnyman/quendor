import { expect, test } from "vite-plus/test";
import { Memory } from "../src/memory.ts";
import { ObjectTable } from "../src/objects.ts";

/**
 * A v1-3 object table: 31 property-default words (62 bytes), then three
 * 9-byte entries. Object 3's property table starts right where a fourth
 * entry would begin, so getObjectCount() should stop at 3. Property-table
 * addresses are deliberately out of order (150, 200, 89) to prove the
 * count walk tracks the minimum seen so far, not just the latest one.
 */
function buildV3Table(): ObjectTable {
  const bytes = new Uint8Array(260);
  const memory = new Memory(bytes);

  // Object 1 @62: attribute 3 set, sibling 2, property table @150.
  bytes[62] = 0x10;
  bytes[66] = 0; // parent
  bytes[67] = 2; // sibling
  bytes[68] = 0; // child
  bytes[69] = 0;
  bytes[70] = 150;

  // Object 2 @71: no attributes, parent 1, child 3, property table @200.
  bytes[75] = 1; // parent
  bytes[76] = 0; // sibling
  bytes[77] = 3; // child
  bytes[78] = 0;
  bytes[79] = 200;

  // Object 3 @80: attribute 31 set, parent 1, property table @89 (boundary).
  bytes[83] = 0x01;
  bytes[84] = 1; // parent
  bytes[85] = 0; // sibling
  bytes[86] = 0; // child
  bytes[87] = 0;
  bytes[88] = 89;

  // Object 3's property table @89: no name, no properties.
  bytes[89] = 0; // short-name length
  bytes[90] = 0; // terminator

  // Object 1's property table @150: 1-word name "a", then two properties.
  const nameZword = (6 << 10) | (5 << 5) | 5 | 0x8000; // "a", terminated

  bytes[150] = 1; // short-name length (words)
  bytes[151] = (nameZword >> 8) & 0xff;
  bytes[152] = nameZword & 0xff;
  bytes[153] = ((3 - 1) << 5) | 20; // property 20, length 3
  bytes[154] = 0x11;
  bytes[155] = 0x22;
  bytes[156] = 0x33;
  bytes[157] = ((1 - 1) << 5) | 5; // property 5, length 1
  bytes[158] = 0x99;
  bytes[159] = 0; // terminator

  // Object 2's property table @200: no name, no properties.
  bytes[200] = 0;
  bytes[201] = 0;

  return new ObjectTable(memory, 3, 0);
}

/**
 * A v4+ object table: 63 property-default words (126 bytes), then one
 * 14-byte entry whose property table starts right at the entries'
 * boundary (140), so getObjectCount() stops at 1. Its properties exercise
 * all three v4+ size-byte encodings, including the "explicit length byte
 * of 0 means 64" special case.
 */
function buildV4Table(): ObjectTable {
  const bytes = new Uint8Array(220);
  const memory = new Memory(bytes);

  bytes[131] = 0x80; // attribute 40 set
  bytes[132] = 0x01; // parent (word) = 300
  bytes[133] = 0x2c;
  bytes[138] = 0; // property table address (word) = 140
  bytes[139] = 140;

  bytes[140] = 0; // short-name length

  // Property @141: bit7=0, bit6=0 -> number=10, length=1.
  bytes[141] = 10;
  bytes[142] = 0xaa;

  // Property @143: bit7=0, bit6=1 -> number=15, length=2.
  bytes[143] = 0x40 | 15;
  bytes[144] = 0x11;
  bytes[145] = 0x22;

  // Property @146: bit7=1, explicit length byte of 0 -> number=20, length=64.
  bytes[146] = 0x80 | 20;
  bytes[147] = 0;
  bytes[212] = 0; // terminator, right after the 64-byte property data

  return new ObjectTable(memory, 5, 0);
}

test("getObjectAddress computes entry offsets and rejects object 0", () => {
  const objects = buildV3Table();

  expect(objects.getObjectAddress(1)).toBe(62);
  expect(objects.getObjectAddress(2)).toBe(71);
  expect(objects.getObjectAddress(3)).toBe(80);
  expect(() => objects.getObjectAddress(0)).toThrow(RangeError);
});

test("getObjectCount stops at the lowest property-table address seen so far (v1-3)", () => {
  expect(buildV3Table().getObjectCount()).toBe(3);
});

test("getObjectCount stops at the property-table boundary (v4+)", () => {
  expect(buildV4Table().getObjectCount()).toBe(1);
});

test("getObjectCount returns the version's max when no property table ever collides with the entries (v1-3)", () => {
  const bytes = new Uint8Array(2400);
  const entriesAddress = 62; // tableAddress(0) + 31 property-default words * 2

  // Every entry's property table address is 0xffff, so `smallest` never
  // drops low enough for `address` to catch up within all 255 entries.
  for (let i = 0; i < 255; i++) {
    const entryAddr = entriesAddress + i * 9;

    bytes[entryAddr + 7] = 0xff;
    bytes[entryAddr + 8] = 0xff;
  }

  const objects = new ObjectTable(new Memory(bytes), 3, 0);

  expect(objects.getObjectCount()).toBe(255);
});

test("getParent/getSibling/getChild read the tree links (v1-3)", () => {
  const objects = buildV3Table();

  expect([objects.getParent(1), objects.getSibling(1), objects.getChild(1)]).toEqual([0, 2, 0]);
  expect([objects.getParent(2), objects.getSibling(2), objects.getChild(2)]).toEqual([1, 0, 3]);
  expect([objects.getParent(3), objects.getSibling(3), objects.getChild(3)]).toEqual([1, 0, 0]);
});

test("getParent reads a 2-byte object number (v4+)", () => {
  expect(buildV4Table().getParent(1)).toBe(300);
});

test("getSetAttributes/hasAttribute report only the bits that are set", () => {
  const objects = buildV3Table();

  expect(objects.getSetAttributes(1)).toEqual([3]);
  expect(objects.getSetAttributes(2)).toEqual([]);
  expect(objects.getSetAttributes(3)).toEqual([31]);
  expect(objects.hasAttribute(1, 3)).toBe(true);
  expect(objects.hasAttribute(1, 4)).toBe(false);
});

test("hasAttribute rejects attribute numbers outside the version's range", () => {
  const objects = buildV3Table();

  expect(() => objects.hasAttribute(1, 32)).toThrow(RangeError);
  expect(() => objects.hasAttribute(1, -1)).toThrow(RangeError);
});

test("getShortNameAddress points at the property table (the short-name length byte)", () => {
  const objects = buildV3Table();

  expect(objects.getShortNameAddress(1)).toBe(150);
  expect(objects.getShortNameAddress(2)).toBe(200);
});

test("getFirstPropertyAddress skips past the short name", () => {
  const objects = buildV3Table();

  expect(objects.getFirstPropertyAddress(1)).toBe(153); // 150 + 1 + 1 word
  expect(objects.getFirstPropertyAddress(2)).toBe(201); // 200 + 1 + 0 words
});

test("readProperties decodes the compact v1-3 size-byte encoding", () => {
  expect(buildV3Table().readProperties(1)).toEqual([
    { number: 20, dataAddress: 154, length: 3 },
    { number: 5, dataAddress: 158, length: 1 },
  ]);
});

test("readProperties returns nothing past the terminator", () => {
  expect(buildV3Table().readProperties(2)).toEqual([]);
});

test("readProperties decodes all three v4+ size-byte forms", () => {
  expect(buildV4Table().readProperties(1)).toEqual([
    { number: 10, dataAddress: 142, length: 1 },
    { number: 15, dataAddress: 144, length: 2 },
    { number: 20, dataAddress: 148, length: 64 },
  ]);
});
