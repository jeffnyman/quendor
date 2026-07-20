import type { Memory } from "./memory.ts";

/**
 * The three Z-Machine alphabets (A0 lower, A1 upper, A2 punctuation/digits).
 *
 * Each string is indexed by Z-character 0..31; codes 0..5 are control codes,
 * so those slots are placeholders. In A2, index 6 is the multi-byte ZSCII
 * marker (handled by the decoder, never looked up here) and index 7 is newline.
 */
const A0 = "      abcdefghijklmnopqrstuvwxyz";
const A1 = "      ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const A2 = "       \n0123456789.,!?_#'\"/\\-:()";
// v1 replaces A2 with this variant ('<' where v2+ has newline handling differs).
const A2_V1 = "       0123456789.,!?_#'\"/\\<-:()";

/**
 * Tracks the current alphabet during decoding, including temporary shifts
 * (single character) and, in v1/v2, shift-locks (until changed again).
 */
export class AlphabetTable {
  private readonly alphabets: string[];
  private currentAlphabet = 0;
  private baseAlphabet = 0;

  constructor(version: number, memory: Memory, alphabetTableAddress: number) {
    if (version === 1) {
      this.alphabets = [A0, A1, A2_V1];
    } else if (version >= 2 && version <= 4) {
      this.alphabets = [A0, A1, A2];
    } else if (version >= 5 && version <= 8) {
      this.alphabets =
        alphabetTableAddress === 0
          ? [A0, A1, A2]
          : readCustomAlphabets(memory, alphabetTableAddress);
    } else {
      throw new Error(`Invalid version number: ${version}`);
    }
  }

  get current(): number {
    return this.currentAlphabet;
  }

  reset(): void {
    this.currentAlphabet = this.baseAlphabet;
  }

  fullReset(): void {
    this.baseAlphabet = 0;
    this.currentAlphabet = 0;
  }

  shift(): void {
    this.currentAlphabet = (this.baseAlphabet + 1) % 3;
  }

  doubleShift(): void {
    this.currentAlphabet = (this.baseAlphabet + 2) % 3;
  }

  shiftLock(): void {
    this.baseAlphabet = (this.baseAlphabet + 1) % 3;
    this.currentAlphabet = this.baseAlphabet;
  }

  doubleShiftLock(): void {
    this.baseAlphabet = (this.baseAlphabet + 2) % 3;
    this.currentAlphabet = this.baseAlphabet;
  }

  /** Find which alphabet (0..2) and index (6..31) encode `ch`, for encoding. */
  findChar(ch: string): { set: number; index: number } | null {
    for (let set = 0; set < 3; set++) {
      for (let index = 6; index < 32; index++) {
        if (this.alphabets[set][index] === ch) return { set, index };
      }
    }
    return null;
  }

  /** Look up a printable Z-character (6..31), then drop any temporary shift. */
  readChar(zchar: number): string {
    if (zchar < 6 || zchar > 31) {
      throw new RangeError(`zchar out of range: ${zchar}`);
    }
    const ch = this.alphabets[this.currentAlphabet][zchar];
    this.reset();
    return ch;
  }
}

function readCustomAlphabets(memory: Memory, address: number): string[] {
  const conv = (start: number, count: number): string => {
    let s = "";

    for (let i = 0; i < count; i++) {
      s += byteToChar(memory.readByte(start + i));
    }

    return s;
  };

  return [
    "??????" + conv(address, 26),
    "??????" + conv(address + 26, 26),
    // 7-char prefix: index 6 is the multi-byte marker, so the table proper
    // starts at index 7 (address + 53).
    "???????" + conv(address + 53, 25),
  ];
}

/** In a custom alphabet table, byte '^' encodes a newline. */
function byteToChar(b: number): string {
  return b === 0x5e /* '^' */ ? "\n" : String.fromCharCode(b);
}
