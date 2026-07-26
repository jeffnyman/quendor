import { computeChecksum, readHeader, type Header } from "./header.ts";
import { Memory } from "./memory.ts";
import { ZText } from "./text.ts";

/**
 * Throw a clear error if `bytes` don't look like a Z-code story image: shorter
 * than the 64-byte header, or a version byte outside 1-8. Guards the load path
 * so a non-story file (a text file, a truncated download) fails with a readable
 * message instead of a low-level out-of-range read while parsing the header.
 * `label` names the source (e.g. a file path) in the message.
 */
export function assertStoryImage(bytes: Uint8Array, label = "input"): void {
  const version = bytes.at(0) ?? 0;

  if (bytes.length < 64 || version < 1 || version > 8) {
    const hex = version.toString(16).padStart(2, "0");

    throw new Error(
      `${label} is not a Z-code story file (version byte 0x${hex}, ${bytes.length} bytes); ` +
        `expected a .z1-.z8 game or a Blorb`,
    );
  }
}

export class Story {
  readonly memory: Memory;
  readonly header: Header;
  readonly text: ZText;

  constructor(bytes: Uint8Array) {
    this.memory = new Memory(bytes);
    this.header = readHeader(this.memory);
    this.text = new ZText(this.memory, this.header);
  }

  /**
   * Decode the abbreviation table (32 * 3 = 96 entries). Each
   * header pointer is a word address that must be doubled to
   * get the byte address.
   */
  readAbbreviations(): string[] {
    const base = this.header.abbreviationsTableAddress;
    const result: string[] = [];

    for (let i = 0; i < 96; i++) {
      const pointer = this.memory.readWord(base + i * 2);
      result.push(this.text.decodeAtAddress(2 * pointer));
    }

    return result;
  }

  /** The checksum computed over the story image (compare to header.checksum). */
  computedChecksum(): number {
    return computeChecksum(this.memory, this.header);
  }
}
