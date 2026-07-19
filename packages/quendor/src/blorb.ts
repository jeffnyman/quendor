export interface BlorbResources {
  /** The `ZCOD` executable */
  story: Uint8Array | undefined;
}

interface Chunk {
  type: string;
  /** Offset of the chunk header (the 4CC). */
  offset: number;
  /** Offset of the chunk's data (header + 8). */
  data: number;
  length: number;
}

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

/**
 * Parse a Blorb container into its resources. Returns `null` if
 * `bytes` is not a Blorb (e.g. a bare story file).
 *
 * @param bytes
 */
export function parseBlorb(bytes: Uint8Array): BlorbResources | null {
  if (!isBlorb(bytes)) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = walkChunks(bytes, view);
  const byType = (t: string): Chunk | undefined => chunks.find((c) => c.type === t);

  const story = ((): Uint8Array | undefined => {
    const zcod = byType("ZCOD");
    return zcod ? bytes.slice(zcod.data, zcod.data + zcod.length) : undefined;
  })();

  return { story };
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
