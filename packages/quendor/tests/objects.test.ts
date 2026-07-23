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

// --- mutation: attributes, links, and tree surgery -------------------------

/**
 * A small, valid v1-3 object tree for exercising mutation:
 *
 *     1 (root)
 *     └── 2 ── 3 ── 4   (a sibling chain; 2 is the first child)
 *
 * Only the parent/sibling/child link bytes are set — mutation never reads
 * property tables — which keeps the fixture focused on tree shape.
 */
/** Build a v1-3 object table from [object, parent, sibling, child] link rows. */
function tree(links: readonly [number, number, number, number][]): ObjectTable {
  const bytes = new Uint8Array(128);

  for (const [obj, parent, sibling, child] of links) {
    const addr = 62 + (obj - 1) * 9; // entries start at 62 (31 default words); parent/sibling/child at +4/+5/+6
    bytes[addr + 4] = parent;
    bytes[addr + 5] = sibling;
    bytes[addr + 6] = child;
  }

  return new ObjectTable(new Memory(bytes), 3, 0);
}

function buildTree(): ObjectTable {
  return tree([
    [1, 0, 0, 2], // root, first child 2
    [2, 1, 3, 0], // 2 → sibling 3
    [3, 1, 4, 0], // 3 → sibling 4
    [4, 1, 0, 0], // 4, end of the chain
  ]);
}

test("setAttribute sets then clears a bit, round-tripping with hasAttribute", () => {
  const objects = buildV3Table();

  expect(objects.hasAttribute(1, 5)).toBe(false);

  objects.setAttribute(1, 5, true);
  expect(objects.hasAttribute(1, 5)).toBe(true);

  objects.setAttribute(1, 5, false);
  expect(objects.hasAttribute(1, 5)).toBe(false);
});

test("setAttribute leaves neighbouring attributes untouched", () => {
  const objects = buildV3Table();

  objects.setAttribute(1, 5, true); // object 1 already has attribute 3

  expect(objects.getSetAttributes(1)).toEqual([3, 5]);
});

test("setAttribute rejects out-of-range attribute numbers", () => {
  const objects = buildV3Table();

  expect(() => objects.setAttribute(1, 32, true)).toThrow(RangeError);
});

test("setParent/setSibling/setChild write the links (v1-3, single byte)", () => {
  const objects = buildV3Table();

  objects.setParent(1, 7);
  objects.setSibling(1, 8);
  objects.setChild(1, 9);

  expect([objects.getParent(1), objects.getSibling(1), objects.getChild(1)]).toEqual([7, 8, 9]);
});

test("setParent writes a 2-byte object number (v4+)", () => {
  const objects = buildV4Table();

  objects.setParent(1, 500);

  expect(objects.getParent(1)).toBe(500);
});

test("readPropertyDefault reads a property's default word from the table header", () => {
  const bytes = new Uint8Array(260);

  bytes[0] = 0x12; // property 1's default word = 0x1234
  bytes[1] = 0x34;
  bytes[4] = 0xab; // property 3's default word (at (3-1)*2 = offset 4) = 0xabcd
  bytes[5] = 0xcd;

  const objects = new ObjectTable(new Memory(bytes), 3, 0);

  expect(objects.readPropertyDefault(1)).toBe(0x1234);
  expect(objects.readPropertyDefault(3)).toBe(0xabcd);
});

test("removeObject unlinks a middle child, relinking its left sibling across the gap", () => {
  const objects = buildTree(); // 1 → 2 → 3 → 4

  objects.removeObject(3);

  expect(objects.getParent(3)).toBe(0); // detached from the tree
  expect(objects.getSibling(3)).toBe(0);
  expect(objects.getSibling(2)).toBe(4); // 2 now skips the removed 3, pointing at 4
  expect(objects.getChild(1)).toBe(2); // the parent's first child is unaffected
});

test("removeObject unlinks the first child, advancing the parent's child pointer", () => {
  const objects = buildTree();

  objects.removeObject(2);

  expect(objects.getParent(2)).toBe(0);
  expect(objects.getChild(1)).toBe(3); // parent's child now points at the old second child
});

test("moveObject makes the object the destination's first child, pushing the old child aside", () => {
  const objects = buildTree();

  objects.moveObject(4, 1); // detach 4 from the chain, re-insert at the front of 1's children

  expect(objects.getParent(4)).toBe(1);
  expect(objects.getChild(1)).toBe(4); // 4 is now the first child
  expect(objects.getSibling(4)).toBe(2); // the old first child becomes 4's sibling
  expect(objects.getSibling(3)).toBe(0); // and 4 was cleanly removed from its old position
});

test("moveObject to 0 detaches the object and gives it no new parent", () => {
  const objects = buildTree();

  objects.moveObject(2, 0);

  expect(objects.getParent(2)).toBe(0);
  expect(objects.getChild(1)).toBe(3); // 1's first child advances to the old second child
});

test("removeObject degrades gracefully when an object isn't in its parent's child chain", () => {
  // A malformed tree: object 2 claims parent 1, but 1's real children are just 3.
  const objects = tree([
    [1, 0, 0, 3], // 1's only child is 3
    [2, 1, 0, 0], // 2 claims parent 1 — but 1 doesn't list it
    [3, 1, 0, 0], // 3 is 1's actual child
  ]);

  objects.removeObject(2); // no left sibling can be found for 2 in 1's chain

  expect(objects.getParent(2)).toBe(0); // 2 is still detached
  expect(objects.getChild(1)).toBe(3); // the real child chain is left intact
});

test("removeObject on a parentless object is a safe no-op", () => {
  const objects = tree([[1, 0, 0, 0]]); // object 1: no parent, no siblings, no children

  expect(() => objects.removeObject(1)).not.toThrow();
  expect(objects.getParent(1)).toBe(0);
});
