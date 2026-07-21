import type { Header } from "./header.ts";
import type { Memory } from "./memory.ts";
import { AlphabetTable } from "./alphabet.ts";

export interface DecodeFlags {
  /** Allow Z-chars 1..3 to expand abbreviations (false inside an abbreviation). */
  allowAbbreviations: boolean;
  /** Tolerate a string that ends mid multi-byte ZSCII char (e.g. dictionary). */
  allowIncompleteMultibyte: boolean;
}

const DEFAULT_FLAGS: DecodeFlags = {
  allowAbbreviations: true,
  allowIncompleteMultibyte: false,
};

/**
 * Decodes Z-Machine text: packed 16-bit "Z-words" → readable strings.
 *
 * Each Z-word packs three 5-bit Z-characters; the top bit of the last word
 * marks the end of the string. Z-characters drive an alphabet state machine
 * (shifts, shift-locks), expand abbreviations, and can form multi-byte ZSCII
 * characters. See the Z-Machine Standards Document 1.1, section 3.
 */
export class ZText {
  private readonly memory: Memory;
  private readonly version: number;
  private readonly abbreviationsTableAddress: number;
  private readonly alphabetTableAddress: number;

  constructor(memory: Memory, header: Header) {
    this.memory = memory;
    this.version = header.version;
    this.abbreviationsTableAddress = header.abbreviationsTableAddress;
    this.alphabetTableAddress = header.alphabetTableAddress;
  }

  /** Unpack Z-words into their constituent 5-bit Z-characters. */
  static zWordsToZChars(zwords: number[]): number[] {
    const chars: number[] = [];

    for (const zword of zwords) {
      chars.push((zword & 0x7c00) >> 10);
      chars.push((zword & 0x03e0) >> 5);
      chars.push(zword & 0x001f);
    }

    return chars;
  }

  private readAbbreviation(index: number): number[] {
    if (index < 0 || index > 95) {
      throw new RangeError(`abbreviation index out of range: ${index}`);
    }

    const pointer = this.memory.readWord(this.abbreviationsTableAddress + index * 2);

    return this.readZWords(2 * pointer);
  }

  /**
   * Z-chars 1-3: early-version control codes (v1 newline, v1/v2 single
   * shifts), or in later versions an abbreviation selector (§3.3).
   */
  private decodeShiftGroup(
    zchars: number[],
    i: number,
    zchar: number,
    flags: DecodeFlags,
    alphabet: AlphabetTable,
  ): { text: string; consumed: number } {
    if (this.version === 1 || (this.version === 2 && zchar >= 2)) {
      if (zchar === 1) return { text: "\n", consumed: 0 };
      if (zchar === 2) alphabet.shift();
      else alphabet.doubleShift();

      return { text: "", consumed: 0 };
    }

    return this.decodeAbbreviation(zchars, i, zchar, flags);
  }

  private decodeAbbreviation(
    zchars: number[],
    i: number,
    zchar: number,
    flags: DecodeFlags,
  ): { text: string; consumed: number } {
    if (!flags.allowAbbreviations) {
      throw new Error("Encountered an illegal abbreviation code.");
    }

    if (i + 1 >= zchars.length) {
      return { text: "", consumed: 0 };
    }

    const code = zchars[i + 1];
    const index = 32 * (zchar - 1) + code;
    const text = this.decode(this.readAbbreviation(index), {
      allowAbbreviations: false,
      allowIncompleteMultibyte: false,
    });

    return { text, consumed: 1 };
  }

  /** Z-chars 4/5: v1/v2 lock the alphabet; v3+ shift it for one character only. */
  private applyShiftOrLock(zchar: number, alphabet: AlphabetTable): void {
    const double = zchar === 5;

    if (this.version <= 2) {
      if (double) alphabet.doubleShiftLock();
      else alphabet.shiftLock();
    } else {
      if (double) alphabet.doubleShift();
      else alphabet.shift();
    }
  }

  /** A2 code 6 begins a 10-bit ZSCII character split over the next two Z-chars. */
  private decodeMultibyteZscii(
    zchars: number[],
    i: number,
    flags: DecodeFlags,
  ): { text: string; consumed: number } {
    if (i + 2 >= zchars.length) {
      if (!flags.allowIncompleteMultibyte) {
        throw new Error("Incomplete multi-byte ZSCII character.");
      }

      return { text: "", consumed: 0 };
    }

    const hi = zchars[i + 1];
    const lo = zchars[i + 2];
    const zscii = ((hi & 0x1f) << 5) | lo;

    return { text: String.fromCharCode(zscii), consumed: 2 };
  }

  private newAlphabet(): AlphabetTable {
    return new AlphabetTable(this.version, this.memory, this.alphabetTableAddress);
  }

  /** Decode the Z-string stored at `address`. */
  decodeAtAddress(address: number, flags: DecodeFlags = DEFAULT_FLAGS): string {
    return this.decode(this.readZWords(address), flags);
  }

  /** Decode a sequence of Z-words already read from memory. */
  decode(zwords: number[], flags: DecodeFlags = DEFAULT_FLAGS): string {
    const zchars = ZText.zWordsToZChars(zwords);
    const alphabet = this.newAlphabet();

    alphabet.fullReset();

    let out = "";
    let i = 0;

    while (i < zchars.length) {
      const zchar = zchars[i];

      if (zchar === 0) {
        out += " ";
      } else if (zchar >= 1 && zchar <= 3) {
        const result = this.decodeShiftGroup(zchars, i, zchar, flags, alphabet);

        out += result.text;
        i += result.consumed;
      } else if (zchar === 4 || zchar === 5) {
        this.applyShiftOrLock(zchar, alphabet);
      } else if (zchar === 6 && alphabet.current === 2) {
        alphabet.reset();

        const result = this.decodeMultibyteZscii(zchars, i, flags);

        out += result.text;
        i += result.consumed;
      } else if (zchar > 31) {
        throw new Error(`Unexpected Z-character value: ${zchar}`);
      } else {
        out += alphabet.readChar(zchar);
      }

      i++;
    }

    return out;
  }

  /** Read the sequence of Z-words at `address`, up to and including the terminator. */
  readZWords(address: number): number[] {
    const words: number[] = [];
    let addr = address;

    for (;;) {
      const zword = this.memory.readWord(addr);

      words.push(zword);
      addr += 2;

      if ((zword & 0x8000) !== 0) break;
    }

    return words;
  }
}
