import { expect, test } from "vite-plus/test";
import { describeBlorb, extractBlorb, parseBlorb, unwrapStory } from "../src/blorb.ts";

function writeFourCC(bytes: Uint8Array, offset: number, code: string): void {
  for (let i = 0; i < 4; i++) {
    bytes[offset + i] = code.charCodeAt(i);
  }
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2;
  const chunk = new Uint8Array(8 + data.length + pad);

  writeFourCC(chunk, 0, type);
  new DataView(chunk.buffer).setUint32(4, data.length);
  chunk.set(data, 8);

  return chunk;
}

function buildBlorb(chunks: { type: string; data: Uint8Array }[]): Uint8Array {
  const built = chunks.map(({ type, data }) => buildChunk(type, data));
  const length = built.reduce((total, chunk) => total + chunk.length, 0);
  const form = new Uint8Array(12 + length);

  writeFourCC(form, 0, "FORM");
  new DataView(form.buffer).setUint32(4, 4 + length);
  writeFourCC(form, 8, "IFRS");

  let offset = 12;

  for (const chunk of built) {
    form.set(chunk, offset);
    offset += chunk.length;
  }

  return form;
}

const ZCODE_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

test("parseBlorb returns null for bytes too short to be a Blorb", () => {
  expect(parseBlorb(new Uint8Array(4))).toBeNull();
});

test("parseBlorb returns null for non-Blorb bytes", () => {
  const bareStory = new Uint8Array(20).fill(0x42);

  expect(parseBlorb(bareStory)).toBeNull();
});

test("parseBlorb finds the ZCOD chunk", () => {
  const blorb = buildBlorb([
    { type: "RIdx", data: new Uint8Array(4) },
    { type: "ZCOD", data: ZCODE_BYTES },
  ]);

  expect(parseBlorb(blorb)?.story).toEqual(ZCODE_BYTES);
});

test("parseBlorb finds ZCOD after an odd-length chunk (padding)", () => {
  const blorb = buildBlorb([
    { type: "TEST", data: new Uint8Array(3) },
    { type: "ZCOD", data: ZCODE_BYTES },
  ]);

  expect(parseBlorb(blorb)?.story).toEqual(ZCODE_BYTES);
});

test("parseBlorb returns an undefined story when there is no ZCOD chunk", () => {
  const blorb = buildBlorb([{ type: "RIdx", data: new Uint8Array(4) }]);

  expect(parseBlorb(blorb)?.story).toBeUndefined();
});

test("unwrapStory returns the bytes unchanged for a non-Blorb file", () => {
  const bareStory = new Uint8Array(20).fill(0x42);

  expect(unwrapStory(bareStory)).toBe(bareStory);
});

test("unwrapStory extracts the ZCOD chunk from a Blorb file", () => {
  const blorb = buildBlorb([{ type: "ZCOD", data: ZCODE_BYTES }]);

  expect(unwrapStory(blorb)).toEqual(ZCODE_BYTES);
});

test("unwrapStory throws when a Blorb file has no ZCOD chunk", () => {
  const blorb = buildBlorb([{ type: "RIdx", data: new Uint8Array(4) }]);

  expect(() => unwrapStory(blorb)).toThrow("no ZCOD");
});

// --- resource index (RIdx) --------------------------------------------------
//
// Each RIdx entry (usage, number, start) points at the byte offset of a resource
// chunk. This builder lays the RIdx chunk first, then the resource chunks right
// after it, and fills each entry's `start` with the resulting offset.

interface IndexedResource {
  /** Normally "Pict" / "Snd " / "Exec"; widened to string so tests can inject a malformed usage. */
  usage: string;
  number: number;
  type: string;
  data: Uint8Array;
}

function buildIndexedBlorb(
  resources: IndexedResource[],
  extras: { type: string; data: Uint8Array }[] = [],
): Uint8Array {
  const ridxDataLen = 4 + resources.length * 12;
  const ridxChunkLen = 8 + ridxDataLen + (ridxDataLen % 2);

  // Resource chunks are placed immediately after the RIdx chunk (at offset 12).
  let offset = 12 + ridxChunkLen;
  const offsets = resources.map((r) => {
    const at = offset;
    offset += buildChunk(r.type, r.data).length;
    return at;
  });

  const ridxData = new Uint8Array(ridxDataLen);
  const view = new DataView(ridxData.buffer);
  view.setUint32(0, resources.length);
  resources.forEach((r, i) => {
    const e = 4 + i * 12;
    writeFourCC(ridxData, e, r.usage);
    view.setUint32(e + 4, r.number);
    view.setUint32(e + 8, offsets[i]);
  });

  return buildBlorb([
    { type: "RIdx", data: ridxData },
    ...resources.map((r) => ({ type: r.type, data: r.data })),
    ...extras,
  ]);
}

// Minimal PNG payload: 8-byte signature, then an IHDR carrying width/height.
function pngData(width: number, height: number): Uint8Array {
  const d = new Uint8Array(24);
  const v = new DataView(d.buffer);

  writeFourCC(d, 12, "IHDR");
  v.setUint32(16, width);
  v.setUint32(20, height);

  return d;
}

function u32Pair(a: number, b: number): Uint8Array {
  const d = new Uint8Array(8);
  const v = new DataView(d.buffer);
  v.setUint32(0, a);
  v.setUint32(4, b);
  return d;
}

test("parseBlorb reads a PNG picture resource with its dimensions", () => {
  const blorb = buildIndexedBlorb([
    { usage: "Pict", number: 1, type: "PNG ", data: pngData(320, 200) },
  ]);
  const pic = parseBlorb(blorb)?.pictures.get(1);

  expect(pic?.format).toBe("png");
  expect(pic?.width).toBe(320);
  expect(pic?.height).toBe(200);
});

// Minimal JPEG: SOI, an APP0 segment to skip, then an SOF0 carrying dimensions.
function jpegData(width: number, height: number): Uint8Array {
  const d = new Uint8Array(20);
  const v = new DataView(d.buffer);

  d.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  v.setUint16(11, height); // SOF0: precision(1), then height, then width
  v.setUint16(13, width);

  return d;
}

test("parseBlorb reads a JPEG picture resource with its dimensions", () => {
  const blorb = buildIndexedBlorb([
    { usage: "Pict", number: 3, type: "JPEG", data: jpegData(400, 300) },
  ]);
  const pic = parseBlorb(blorb)?.pictures.get(3);

  expect(pic?.format).toBe("jpeg");
  expect(pic?.width).toBe(400);
  expect(pic?.height).toBe(300);
});

test("parseBlorb reads a Rect placeholder picture (dimensions only, no data)", () => {
  const blorb = buildIndexedBlorb([
    { usage: "Pict", number: 2, type: "Rect", data: u32Pair(640, 400) },
  ]);
  const pic = parseBlorb(blorb)?.pictures.get(2);

  expect(pic?.format).toBe("rect");
  expect(pic?.width).toBe(640);
  expect(pic?.height).toBe(400);
  expect(pic?.data.length).toBe(0);
});

test("parseBlorb tags a FORM sound resource as aiff", () => {
  const blorb = buildIndexedBlorb([
    { usage: "Snd ", number: 1, type: "FORM", data: new Uint8Array([1, 2, 3, 4]) },
  ]);

  expect(parseBlorb(blorb)?.sounds.get(1)?.format).toBe("aiff");
});

test("parseBlorb reads RelN, Reso, Loop, and IFhd metadata", () => {
  const reln = new Uint8Array(2);
  new DataView(reln.buffer).setUint16(0, 42);

  const ifhd = new Uint8Array(8); // release 12, serial "860725"
  new DataView(ifhd.buffer).setUint16(0, 12);
  for (let i = 0; i < 6; i++) ifhd[2 + i] = "860725".charCodeAt(i);

  const res = parseBlorb(
    buildBlorb([
      { type: "RelN", data: reln },
      { type: "Reso", data: u32Pair(800, 600) },
      { type: "Loop", data: u32Pair(3, 0) }, // sound #3 loops forever (count 0)
      { type: "IFhd", data: ifhd },
    ]),
  );

  expect(res?.pictureRelease).toBe(42);
  expect(res?.stdWidth).toBe(800);
  expect(res?.stdHeight).toBe(600);
  expect(res?.soundLoops.get(3)).toBe(0);
  expect(res?.ident).toEqual({ release: 12, serial: "860725" });
});

// --- describeBlorb ----------------------------------------------------------

test("describeBlorb reports a non-Blorb file", () => {
  expect(describeBlorb(new Uint8Array(20).fill(0x42))).toContain("Not a Blorb");
});

test("describeBlorb summarizes the container, story, and resources", () => {
  const blorb = buildIndexedBlorb(
    [{ usage: "Pict", number: 1, type: "PNG ", data: pngData(96, 96) }],
    [{ type: "ZCOD", data: new Uint8Array([5, 0, 0]) }], // v5 story
  );
  const out = describeBlorb(blorb);

  expect(out).toContain("Container: FORM/IFRS");
  expect(out).toContain("ZCOD present");
  expect(out).toContain("Z-code v5");
  expect(out).toContain("Pictures (1)");
});

// --- extractBlorb -----------------------------------------------------------

test("extractBlorb returns an empty list for a non-Blorb file", () => {
  expect(extractBlorb(new Uint8Array(20).fill(0x42))).toEqual([]);
});

test("extractBlorb names the story and picture and skips Rect placeholders", () => {
  const blorb = buildIndexedBlorb(
    [
      { usage: "Pict", number: 1, type: "PNG ", data: pngData(96, 96) },
      { usage: "Pict", number: 2, type: "Rect", data: u32Pair(10, 10) },
    ],
    [{ type: "ZCOD", data: new Uint8Array([3, 0]) }], // v3 story
  );
  const names = extractBlorb(blorb).map((f) => f.name);

  expect(names).toContain("pic-001.png");
  expect(names).toContain("story.z3");
  expect(names).not.toContain("pic-002.png"); // the Rect placeholder is skipped
});

function u16(n: number): Uint8Array {
  const d = new Uint8Array(2);
  new DataView(d.buffer).setUint16(0, n);
  return d;
}

function u32(n: number): Uint8Array {
  const d = new Uint8Array(4);
  new DataView(d.buffer).setUint32(0, n);
  return d;
}

function ascii(s: string): Uint8Array {
  return new Uint8Array(Array.from(s, (c) => c.charCodeAt(0)));
}

// SNam stores the story name as big-endian UTF-16 code units.
function utf16be(s: string): Uint8Array {
  const d = new Uint8Array(s.length * 2);
  const v = new DataView(d.buffer);
  for (let i = 0; i < s.length; i++) v.setUint16(i * 2, s.charCodeAt(i));
  return d;
}

test("describeBlorb renders the metadata block, sound loops, and the executable listing", () => {
  const blorb = buildIndexedBlorb(
    [
      { usage: "Pict", number: 1, type: "PNG ", data: pngData(96, 96) },
      // A FORM that isn't a decodable AIFF, so the listing falls back to the type.
      { usage: "Snd ", number: 1, type: "FORM", data: new Uint8Array([0, 0, 0, 0]) },
      { usage: "Exec", number: 0, type: "ZCOD", data: new Uint8Array([5, 0, 0]) },
    ],
    [
      { type: "AUTH", data: ascii("Ada") },
      { type: "(c) ", data: ascii("1986") },
      { type: "ANNO", data: ascii("note") },
      { type: "SNam", data: utf16be("Zork") },
      { type: "Fspc", data: u32(1) },
      { type: "IFmd", data: ascii("<x/>") },
      { type: "Loop", data: u32Pair(1, 0) }, // sound #1 loops forever
      { type: "RelN", data: u16(2) },
      { type: "Reso", data: u32Pair(800, 600) },
    ],
  );
  const out = describeBlorb(blorb);

  expect(out).toContain('Author (AUTH): "Ada"');
  expect(out).toContain('Copyright ((c)): "1986"');
  expect(out).toContain('Annotation (ANNO): "note"');
  expect(out).toContain('Story name (SNam): "Zork"');
  expect(out).toContain("Frontispiece (Fspc): picture #1");
  expect(out).toContain("Release (RelN): 2");
  expect(out).toContain("Resolution (Reso): standard 800 x 600 px");
  expect(out).toContain("iFiction metadata (IFmd):");
  expect(out).toContain("Resources (3 indexed):");
  expect(out).toContain("Sounds (1):");
  expect(out).toContain("[loops forever]");
  expect(out).toContain("Executable:");
});

// --- edge cases: malformed images, unknown types, resource-only Blorbs ------

test("parseBlorb yields zero dimensions for a malformed PNG and a JPEG with no SOF", () => {
  const notPng = new Uint8Array(24); // no "IHDR" 4CC at offset 12
  const noSof = new Uint8Array([0xff, 0xd8, ...Array<number>(12).fill(0)]); // SOI then no marker byte

  const blorb = buildIndexedBlorb([
    { usage: "Pict", number: 1, type: "PNG ", data: notPng },
    { usage: "Pict", number: 2, type: "JPEG", data: noSof },
  ]);
  const res = parseBlorb(blorb);

  expect(res?.pictures.get(1)).toMatchObject({ width: 0, height: 0 }); // pngDimensions: not IHDR
  expect(res?.pictures.get(2)).toMatchObject({ width: 0, height: 0 }); // jpegDimensions: no SOF found
});

test("parseBlorb skips an unknown picture type and tags an unknown sound as 'other'", () => {
  const blorb = buildIndexedBlorb([
    { usage: "Pict", number: 1, type: "GIF ", data: new Uint8Array(8) }, // unrecognized picture
    { usage: "Snd ", number: 2, type: "WAVE", data: new Uint8Array(4) }, // unrecognized sound
  ]);
  const res = parseBlorb(blorb);

  expect(res?.pictures.has(1)).toBe(false); // parsePicture returned undefined -> not stored
  expect(res?.sounds.get(2)?.format).toBe("other"); // no SOUND_FORMATS entry -> "other"
});

test("extractBlorb names a JPEG and sounds, omitting the story for a resource-only Blorb", () => {
  const blorb = buildIndexedBlorb([
    { usage: "Pict", number: 1, type: "JPEG", data: jpegData(10, 10) },
    { usage: "Snd ", number: 2, type: "FORM", data: new Uint8Array([0, 0, 0, 0]) }, // aiff -> .aiff
    { usage: "Snd ", number: 3, type: "SONG", data: new Uint8Array(4) }, // song -> .snd fallback
  ]);
  const names = extractBlorb(blorb).map((f) => f.name);

  expect(names).toContain("pic-001.jpg");
  expect(names).toContain("snd-002.aiff");
  expect(names).toContain("snd-003.snd");
  expect(names.some((n) => n.startsWith("story"))).toBe(false); // no ZCOD -> no story file
});

test("extractBlorb uses a .dat extension for a story with no valid version byte", () => {
  const blorb = buildIndexedBlorb([], [{ type: "ZCOD", data: new Uint8Array(0) }]);

  expect(extractBlorb(blorb).map((f) => f.name)).toContain("story.dat");
});

test("describeBlorb reports a resource-only Blorb, labels unknown chunks, and lists no resources", () => {
  const blorb = buildBlorb([
    { type: "RIdx", data: new Uint8Array(4) }, // resource count 0
    { type: "ZZZZ", data: new Uint8Array(2) }, // chunk type with no known description
  ]);
  const out = describeBlorb(blorb);

  expect(out).toContain("none (resource-only"); // storyLine, no ZCOD
  expect(out).toContain('"ZZZZ"'); // listed with no "— description" suffix
  expect(out).toContain("(none)"); // empty resource listing
});

test("describeBlorb omits the resource section for a Blorb with no RIdx", () => {
  const blorb = buildBlorb([{ type: "ZCOD", data: new Uint8Array([5, 0, 0]) }]);
  const out = describeBlorb(blorb);

  expect(out).toContain("ZCOD present");
  expect(out).not.toContain("Resources (");
});

// An AIFF FORM *body* ("AIFF" + COMM + SSND) that buildChunk("FORM", …) wraps into
// a decodable FORM/AIFF sound chunk (8-bit PCM at 8000 Hz).
const RATE_8000 = [0x40, 0x0b, 0xfa, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];

function aiffBody(channels: number, frames: number): Uint8Array {
  const comm = new Uint8Array(18);
  const cv = new DataView(comm.buffer);
  cv.setUint16(0, channels);
  cv.setUint32(2, frames);
  cv.setUint16(6, 8); // 8-bit
  comm.set(RATE_8000, 8);

  const ssnd = new Uint8Array(8 + channels * frames); // offset(4) + blockSize(4) + samples
  const commChunk = buildChunk("COMM", comm);
  const ssndChunk = buildChunk("SSND", ssnd);

  const body = new Uint8Array(4 + commChunk.length + ssndChunk.length);
  writeFourCC(body, 0, "AIFF");
  body.set(commChunk, 4);
  body.set(ssndChunk, 4 + commChunk.length);

  return body;
}

test("describeBlorb decodes AIFF sounds (mono and stereo) and annotates a repeating loop count", () => {
  const blorb = buildIndexedBlorb(
    [
      { usage: "Snd ", number: 2, type: "FORM", data: aiffBody(2, 1) }, // stereo, decodable
      { usage: "Snd ", number: 4, type: "FORM", data: aiffBody(1, 1) }, // mono, decodable
    ],
    [{ type: "Loop", data: u32Pair(2, 5) }], // sound #2 loops x5
  );
  const out = describeBlorb(blorb);

  expect(out).toContain("stereo"); // decodeAiff succeeded: channels === 2
  expect(out).toContain("mono"); // channels === 1
  expect(out).toContain("8000Hz");
  expect(out).toContain("[loops x5]"); // non-zero repeat count
});

test("describeBlorb falls back to the raw type for a non-AIFF sound and marks an unparsed picture", () => {
  const blorb = buildIndexedBlorb([
    { usage: "Pict", number: 1, type: "GIF ", data: new Uint8Array(4) }, // unparsed -> "?" dimensions
    { usage: "Snd ", number: 3, type: "OGGV", data: new Uint8Array(4) }, // not FORM -> raw type, no loop
  ]);
  const out = describeBlorb(blorb);

  expect(out).toMatch(/GIF\s+\?/); // picture not in the parsed map -> "?"
  expect(out).toContain("OGGV"); // sound shown by its raw type (soundInfo returned it verbatim)
});

test("describeBlorb trims text at a NUL and skips an unknown resource usage", () => {
  const blorb = buildIndexedBlorb(
    [{ usage: "Xtra", number: 9, type: "ZCOD", data: new Uint8Array(2) }], // usage neither Pict/Snd/Exec
    [
      { type: "AUTH", data: ascii("A\0B") }, // embedded NUL -> readText stops at "A"
      { type: "SNam", data: new Uint8Array([0, 0x5a, 0, 0, 0, 0x6b]) }, // "Z", NUL unit, "k" -> "Zk"
    ],
  );
  const out = describeBlorb(blorb);

  expect(out).toContain('Author (AUTH): "A"'); // readText broke at the NUL
  expect(out).toContain('Story name (SNam): "Zk"'); // storyName skipped the zero code unit
});
