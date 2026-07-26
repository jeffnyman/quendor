/**
 *
 * with its resources (images, sounds, metadata). For the Z-Machine, the
 * executable lives in a `ZCOD` chunk and pictures in `PNG `/`JPEG`/`Rect`
 * chunks indexed by the `RIdx` resource map.
 *
 * A v6 game like Zork Zero ships its code in a bare `.z6` file and its images
 * in a *separate* graphics-only Blorb (`.blb`) with no `ZCOD` chunk; the two
 * are paired at load time. This module parses both shapes.
 *
 * See https://www.eblong.com/zarf/blorb/Blorb-Spec.html
 */

import { decodeAiff } from "./aiff.ts";

/**
 * A picture resource: raw image bytes plus its intrinsic pixel dimensions.
 */
export interface BlorbPicture {
  number: number;
  /** `png`/`jpeg` carry image bytes in `data`; `rect` is a sizing placeholder. */
  format: "png" | "jpeg" | "rect";
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * A sound resource: the raw resource-chunk bytes plus a coarse format tag.
 */
export interface BlorbSound {
  number: number;
  /** `aiff` (FORM/AIFF or AIFC), `ogg`, `mod`, or `song`; `data` is the raw chunk. */
  format: "aiff" | "ogg" | "mod" | "song" | "other";
  data: Uint8Array;
}

export interface BlorbResources {
  /** The `ZCOD` executable, if this Blorb bundles one (absent for `.blb`). */
  story: Uint8Array | undefined;
  /** Picture number → resource. */
  pictures: Map<number, BlorbPicture>;
  /** Sound number → resource. */
  sounds: Map<number, BlorbSound>;
  /** Legacy `Loop` chunk: sound number → repeat count (0 = forever). */
  soundLoops: Map<number, number>;
  /** Release number of the picture set (`RelN` chunk), or 0. */
  pictureRelease: number;
  /** Standard window size from the `Reso` chunk, in pixels (0 if absent). */
  stdWidth: number;
  stdHeight: number;
  /** The story this Blorb pairs with, from its `IFhd` chunk (release + serial),
   *  or undefined if absent. Used to match a Blorb to a loaded story by identity. */
  ident: { release: number; serial: string } | undefined;
}

interface Chunk {
  type: string;
  /** Offset of the chunk header (the 4CC). */
  offset: number;
  /** Offset of the chunk's data (header + 8). */
  data: number;
  length: number;
}

/** File extension for a sound resource's format tag. */
const SOUND_EXTENSIONS: Record<string, string> = { aiff: "aiff", ogg: "ogg", mod: "mod" };

// One-line descriptions for the chunk types a Z-Machine Blorb can carry.
const CHUNK_DESCRIPTIONS: Record<string, string> = {
  RIdx: "resource index",
  IFhd: "game identifier (matches a story file)",
  ZCOD: "Z-code story",
  "PNG ": "PNG image",
  JPEG: "JPEG image",
  Rect: "placeholder rectangle (size only)",
  FORM: "AIFF sound",
  OGGV: "Ogg Vorbis sound",
  "MOD ": "MOD music",
  RelN: "picture-set release number",
  Reso: "resolution / scaling",
  Loop: "sound looping table",
  Fspc: "frontispiece (cover picture number)",
  Plte: "palette",
  APal: "adaptive palette",
  AUTH: "author",
  "(c) ": "copyright",
  ANNO: "annotation",
  SNam: "story name (Unicode)",
  IFmd: "iFiction metadata (XML)",
};

// Blorb spec §15 "The IFF Format": chunk type IDs are stored as four
// ASCII bytes, e.g. 'FORM', 'IFRS', 'ZCOD'.
function fourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function walkChunks(bytes: Uint8Array, view: DataView): Chunk[] {
  const chunks: Chunk[] = [];

  // skip FORM + length + IFRS
  let pos = 12;

  while (pos + 8 <= bytes.length) {
    const type = fourCC(bytes, pos);
    const length = view.getUint32(pos + 4);

    chunks.push({ type, offset: pos, data: pos + 8, length });

    // skip data + odd-length pad byte (spec §15: odd-length chunks are
    // padded to keep every chunk on an even byte boundary)
    pos += 8 + length + (length % 2);
  }

  return chunks;
}

// Blorb spec §0 "Overall Structure": Blorb is an IFF FORM of type 'IFRS'.
function isBlorb(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && fourCC(bytes, 0) === "FORM" && fourCC(bytes, 8) === "IFRS";
}

function readText(bytes: Uint8Array, start: number, len: number): string {
  let s = "";

  for (let i = 0; i < len && start + i < bytes.length; i++) {
    const c = bytes[start + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }

  return s.trim();
}

/** File extension for the Z-code version byte (`.z3`, `.z5`, …). */
function storyExtension(story: Uint8Array): string {
  const v = story.length ? story[0] : 0;

  return v >= 1 && v <= 8 ? `z${v}` : "dat";
}

/**
 * Read a PNG's IHDR width/height; returns [0,0] if it doesn't look like a PNG.
 */
function pngDimensions(bytes: Uint8Array, view: DataView, data: number): [number, number] {
  // PNG signature (8 bytes) then IHDR: length(4) "IHDR"(4) width(4) height(4).
  if (fourCC(bytes, data + 12) !== "IHDR") return [0, 0];
  return [view.getUint32(data + 16), view.getUint32(data + 20)];
}

/**
 * Read a JPEG's frame width/height by scanning for an SOF marker.
 */
function jpegDimensions(
  bytes: Uint8Array,
  view: DataView,
  data: number,
  len: number,
): [number, number] {
  let p = data + 2; // skip SOI (0xFFD8)
  const end = data + len;

  while (p + 9 < end) {
    if (bytes[p] !== 0xff) {
      p++;
      continue;
    }

    const marker = bytes[p + 1];

    // SOF0..SOF15 carry the frame dimensions (excluding the non-SOF markers).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [view.getUint16(p + 7), view.getUint16(p + 5)]; // width, height
    }

    p += 2 + view.getUint16(p + 2); // skip marker + its segment
  }

  return [0, 0];
}

/** Coarse sound-format tag keyed by a resource chunk's type. */
const SOUND_FORMATS: Record<string, BlorbSound["format"]> = {
  FORM: "aiff", // AIFF / AIFF-C
  OGGV: "ogg",
  "MOD ": "mod",
  SONG: "song",
};

/** Build a picture resource from its chunk, or undefined for an unknown type. */
function parsePicture(
  bytes: Uint8Array,
  view: DataView,
  number: number,
  type: string,
  data: number,
  len: number,
): BlorbPicture | undefined {
  if (type === "PNG ") {
    const [width, height] = pngDimensions(bytes, view, data);
    return { number, format: "png", data: bytes.slice(data, data + len), width, height };
  }

  if (type === "JPEG") {
    const [width, height] = jpegDimensions(bytes, view, data, len);
    return { number, format: "jpeg", data: bytes.slice(data, data + len), width, height };
  }

  if (type === "Rect") {
    // A placeholder rectangle: dimensions only, no image data.
    return {
      number,
      format: "rect",
      data: new Uint8Array(0),
      width: view.getUint32(data),
      height: view.getUint32(data + 4),
    };
  }

  return undefined;
}

/** Walk the RIdx resource map, collecting pictures and sounds keyed by number. */
function parseResourceIndex(
  bytes: Uint8Array,
  view: DataView,
  ridx: Chunk | undefined,
): { pictures: Map<number, BlorbPicture>; sounds: Map<number, BlorbSound> } {
  const pictures = new Map<number, BlorbPicture>();
  const sounds = new Map<number, BlorbSound>();

  if (!ridx) return { pictures, sounds };

  const count = view.getUint32(ridx.data);

  for (let i = 0; i < count; i++) {
    const entry = ridx.data + 4 + i * 12;
    const usage = fourCC(bytes, entry);
    const number = view.getUint32(entry + 4);
    const start = view.getUint32(entry + 8); // offset of the resource chunk
    const type = fourCC(bytes, start);
    const len = view.getUint32(start + 4);

    if (usage === "Snd ") {
      // Keep the whole chunk (usually FORM/AIFF) intact for standalone decoding.
      const raw = bytes.slice(start, start + 8 + len + (len % 2));
      sounds.set(number, { number, format: SOUND_FORMATS[type] ?? "other", data: raw });
    } else if (usage === "Pict") {
      const pic = parsePicture(bytes, view, number, type, start + 8, len);
      if (pic) pictures.set(number, pic);
    }
  }

  return { pictures, sounds };
}

/** Legacy `Loop` chunk: 8-byte (sound number, repeat count) entries; 0 = forever. */
function parseLoops(view: DataView, loop: Chunk | undefined): Map<number, number> {
  const soundLoops = new Map<number, number>();

  if (loop) {
    for (let p = loop.data; p + 8 <= loop.data + loop.length; p += 8) {
      soundLoops.set(view.getUint32(p), view.getUint32(p + 4));
    }
  }

  return soundLoops;
}

/** IFhd game identifier: release number (2 bytes) then the 6-byte serial. */
function parseIdent(
  bytes: Uint8Array,
  view: DataView,
  ifhd: Chunk | undefined,
): { release: number; serial: string } | undefined {
  if (ifhd && ifhd.length >= 8) {
    return { release: view.getUint16(ifhd.data), serial: readText(bytes, ifhd.data + 2, 6) };
  }

  return undefined;
}

/**
 * Parse a Blorb container into its resources. Returns `null` if
 * `bytes` is not a Blorb (e.g. a bare story file).
 */
export function parseBlorb(bytes: Uint8Array): BlorbResources | null {
  if (!isBlorb(bytes)) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = walkChunks(bytes, view);
  const byType = (t: string): Chunk | undefined => chunks.find((c) => c.type === t);

  const zcod = byType("ZCOD");
  const reln = byType("RelN");
  const reso = byType("Reso");
  const { pictures, sounds } = parseResourceIndex(bytes, view, byType("RIdx"));

  return {
    story: zcod ? bytes.slice(zcod.data, zcod.data + zcod.length) : undefined,
    pictures,
    sounds,
    soundLoops: parseLoops(view, byType("Loop")),
    pictureRelease: reln ? view.getUint16(reln.data) : 0,
    stdWidth: reso ? view.getUint32(reso.data) : 0,
    stdHeight: reso ? view.getUint32(reso.data + 4) : 0,
    ident: parseIdent(bytes, view, byType("IFhd")),
  };
}

/**
 * Return the raw Z-code story bytes. If `bytes` is a Blorb
 * (`FORM`/`IFRS`), extract its `ZCOD` chunk; otherwise assume
 * it's already a bare story file.
 */
export function unwrapStory(bytes: Uint8Array): Uint8Array {
  const blorb = parseBlorb(bytes);

  if (!blorb) {
    return bytes;
  }

  if (!blorb.story) {
    throw new Error("Blorb file contains no ZCOD (Z-code) executable");
  }

  return blorb.story;
}

/**
 * Extract a Blorb's resources as named byte blobs (pictures, sounds, and the
 * embedded story if any), ready to write to disk. `Rect` placeholders have no
 * data and are skipped. For `zexp blorb <file> --extract <dir>`.
 */
export function extractBlorb(bytes: Uint8Array): { name: string; data: Uint8Array }[] {
  const res = parseBlorb(bytes);

  if (!res) return [];

  const files: { name: string; data: Uint8Array }[] = [];
  const pad = (n: number): string => String(n).padStart(3, "0");

  for (const [n, p] of res.pictures) {
    if (p.format === "rect") continue;
    files.push({ name: `pic-${pad(n)}.${p.format === "jpeg" ? "jpg" : "png"}`, data: p.data });
  }

  for (const [n, s] of res.sounds) {
    files.push({ name: `snd-${pad(n)}.${SOUND_EXTENSIONS[s.format] ?? "snd"}`, data: s.data });
  }

  if (res.story) files.push({ name: `story.${storyExtension(res.story)}`, data: res.story });

  return files;
}

function chunkMapLines(chunks: Chunk[]): string[] {
  const lines = [`Chunks (${chunks.length}):`];

  for (const c of chunks) {
    const desc = CHUNK_DESCRIPTIONS[c.type] ?? "";

    lines.push(
      `  ${JSON.stringify(c.type).padEnd(8)} ${String(c.length).padStart(8)} bytes` +
        `  @0x${c.offset.toString(16)}${desc ? `  — ${desc}` : ""}`,
    );
  }

  return lines;
}

function storyLine(res: BlorbResources): string {
  return res.story
    ? `  ZCOD present — ${res.story.length} bytes (Z-code v${res.story[0]})`
    : "  none (resource-only Blorb — pair it with a matching story file)";
}

/** Decode an SNam chunk (big-endian UTF-16 code units) to the story name. */
function storyName(view: DataView, snam: Chunk): string {
  let name = "";

  for (let p = snam.data; p + 2 <= snam.data + snam.length; p += 2) {
    const u = view.getUint16(p);
    if (u) name += String.fromCharCode(u);
  }

  return name.trim();
}

function metadataLines(
  bytes: Uint8Array,
  view: DataView,
  res: BlorbResources,
  byType: (t: string) => Chunk | undefined,
): string[] {
  const meta: string[] = [];

  if (res.pictureRelease) meta.push(`  Release (RelN): ${res.pictureRelease}`);

  if (res.stdWidth || res.stdHeight) {
    meta.push(`  Resolution (Reso): standard ${res.stdWidth} x ${res.stdHeight} px`);
  }

  const fspc = byType("Fspc");
  if (fspc) meta.push(`  Frontispiece (Fspc): picture #${view.getUint32(fspc.data)}`);

  for (const [type, label] of [
    ["AUTH", "Author"],
    ["(c) ", "Copyright"],
    ["ANNO", "Annotation"],
  ] as const) {
    const ch = byType(type);
    if (ch) {
      meta.push(
        `  ${label} (${type.trim()}): ${JSON.stringify(readText(bytes, ch.data, ch.length))}`,
      );
    }
  }

  const snam = byType("SNam");
  if (snam) meta.push(`  Story name (SNam): ${JSON.stringify(storyName(view, snam))}`);

  const ifmd = byType("IFmd");
  if (ifmd) meta.push(`  iFiction metadata (IFmd): ${ifmd.length} bytes of XML`);

  return meta;
}

/** A sound resource's decoded audio details, or its raw type if not decodable. */
function soundInfo(bytes: Uint8Array, start: number, type: string, len: number): string {
  const dec = type === "FORM" ? decodeAiff(bytes.slice(start, start + 8 + len)) : null;

  if (!dec) return type;

  return `${dec.channels === 1 ? "mono" : "stereo"} ${Math.round(dec.sampleRate)}Hz ${(dec.frames / dec.sampleRate).toFixed(2)}s`;
}

/** A `[loops …]` annotation for a sound number, or "" when it doesn't loop. */
function loopNote(res: BlorbResources, number: number): string {
  if (!res.soundLoops.has(number)) return "";

  const count = res.soundLoops.get(number);
  return count === 0 ? "  [loops forever]" : `  [loops x${count}]`;
}

function resourceIndexLines(
  bytes: Uint8Array,
  view: DataView,
  res: BlorbResources,
  ridx: Chunk,
): string[] {
  const count = view.getUint32(ridx.data);
  const pics: string[] = [];
  const snds: string[] = [];
  const execs: string[] = [];

  for (let i = 0; i < count; i++) {
    const e = ridx.data + 4 + i * 12;
    const usage = fourCC(bytes, e);
    const number = view.getUint32(e + 4);
    const start = view.getUint32(e + 8);
    const type = fourCC(bytes, start);
    const len = view.getUint32(start + 4);
    const at = `@0x${start.toString(16)}`;
    const head = `  #${String(number).padStart(3)}  ${type.trim().padEnd(4)}`;

    if (usage === "Pict") {
      const p = res.pictures.get(number);
      const dims = p ? `${p.width}x${p.height}` : "?";
      pics.push(`${head} ${dims.padEnd(9)} ${String(len).padStart(7)} bytes  ${at}`);
    } else if (usage === "Snd ") {
      const info = soundInfo(bytes, start, type, len);
      snds.push(
        `${head} ${info.padEnd(22)} ${String(len).padStart(7)} bytes  ${at}${loopNote(res, number)}`,
      );
    } else if (usage === "Exec") {
      execs.push(
        `  #${String(number).padStart(3)}  ${type.trim()}  ${String(len).padStart(7)} bytes  ${at}`,
      );
    }
  }

  const lines = ["", `Resources (${count} indexed):`];

  if (pics.length) lines.push(`  Pictures (${pics.length}):`, ...pics.map((s) => "  " + s));
  if (snds.length) lines.push(`  Sounds (${snds.length}):`, ...snds.map((s) => "  " + s));
  if (execs.length) lines.push(`  Executable:`, ...execs.map((s) => "  " + s));
  if (!pics.length && !snds.length && !execs.length) lines.push("  (none)");

  return lines;
}

/**
 * A human-readable report of a Blorb's structure: its container, chunk map,
 * embedded story, metadata, and every indexed picture/sound resource (with
 * decoded dimensions / audio details). For `zexp blorb`.
 */
export function describeBlorb(bytes: Uint8Array): string {
  // parseBlorb already performs the isBlorb check and returns null when it
  // fails, so a single guard on its result both reports the non-Blorb case and
  // narrows `res` to non-null for the rest of the function.
  const res = parseBlorb(bytes);

  if (!res) {
    return "Not a Blorb (no FORM/IFRS header). A bare story file has no resources.";
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = walkChunks(bytes, view);
  const byType = (t: string): Chunk | undefined => chunks.find((c) => c.type === t);

  const out: string[] = [
    `Container: FORM/${fourCC(bytes, 8)}, ${bytes.length} bytes`,
    "",
    ...chunkMapLines(chunks),
    "",
    "Story:",
    storyLine(res),
  ];

  const meta = metadataLines(bytes, view, res, byType);
  if (meta.length) out.push("", "Metadata:", ...meta);

  const ridx = byType("RIdx");
  if (ridx) out.push(...resourceIndexLines(bytes, view, res, ridx));

  return out.join("\n");
}
