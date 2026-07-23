import type { Header } from "./header.ts";
import type { Memory } from "./memory.ts";
import { AlphabetTable } from "./alphabet.ts";

export interface DecodeFlags {
  /** Allow Z-chars 1..3 to expand abbreviations (false inside an abbreviation). */
  allowAbbreviations: boolean;
  /** Tolerate a string that ends mid multi-byte ZSCII char (e.g. dictionary). */
  allowIncompleteMultibyte: boolean;
}

export const DEFAULT_FLAGS: DecodeFlags = {
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

  /** Split typed input into tokens, respecting the dictionary's separators. */
  tokenizeCommand(
    text: string,
    dictionaryAddress: number,
  ): { start: number; length: number; text: string }[] {
    let addr = dictionaryAddress;
    const sepCount = this.memory.readByte(addr++);
    const seps = new Set<string>();

    for (let i = 0; i < sepCount; i++) {
      seps.add(String.fromCharCode(this.memory.readByte(addr++)));
    }

    const tokens: { start: number; length: number; text: string }[] = [];
    let start = -1;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (start < 0) {
        if (ch !== " ") start = i;

        if (seps.has(ch)) {
          tokens.push({ start: i, length: 1, text: ch });
          start = -1;
        }
      } else if (ch === " ") {
        tokens.push({ start, length: i - start, text: text.slice(start, i) });
        start = -1;
      } else if (seps.has(ch)) {
        tokens.push({ start, length: i - start, text: text.slice(start, i) });
        tokens.push({ start: i, length: 1, text: ch });
        start = -1;
      }
    }

    if (start >= 0) {
      tokens.push({ start, length: text.length - start, text: text.slice(start) });
    }

    return tokens;
  }

  /** Find a word in a dictionary; returns its entry address, or 0 if absent. */
  lookupWord(word: string, dictionaryAddress: number): number {
    const encoded = this.encodeWord(word);
    const { base, entryCount, entryLength, sorted } = this.readDictionaryHeader(dictionaryAddress);

    let lower = 0;
    let upper = entryCount - 1;

    while (lower <= upper) {
      const entryNumber = sorted ? (lower + upper) >> 1 : lower;
      const entryAddress = base + entryNumber * entryLength;
      const cmp = this.compareEntry(encoded, entryAddress);

      if (cmp === 0) return entryAddress;

      if (sorted) {
        if (cmp > 0) lower = entryNumber + 1;
        else upper = entryNumber - 1;
      } else {
        lower++;
      }
    }

    return 0;
  }

  /** Parse a dictionary's header, returning where its entries begin and how to scan them. */
  private readDictionaryHeader(dictionaryAddress: number): {
    base: number;
    entryCount: number;
    entryLength: number;
    sorted: boolean;
  } {
    let addr = dictionaryAddress;
    const sepCount = this.memory.readByte(addr++);

    addr += sepCount;

    const entryLength = this.memory.readByte(addr++);
    let entryCount = this.memory.readWord(addr);

    addr += 2;

    let sorted = true;

    if (entryCount >= 0x8000) {
      entryCount = 0x10000 - entryCount; // negative count => unsorted
      sorted = false;
    }

    return { base: addr, entryCount, entryLength, sorted };
  }

  /** Compare `encoded` against the entry at `entryAddress`: negative, 0 (equal), or positive. */
  private compareEntry(encoded: number[], entryAddress: number): number {
    for (let i = 0; i < this.resolution; i++) {
      const entry = this.memory.readWord(entryAddress + i * 2);

      if (encoded[i] !== entry) return encoded[i] > entry ? 1 : -1;
    }

    return 0;
  }

  /** Encode a word into `resolution` packed Z-words, for dictionary lookup. */
  encodeWord(word: string): number[] {
    return this.packZChars(this.encodeToZChars(word));
  }

  /** Turn a word into exactly `resolution * 3` Z-characters (padded with shifts). */
  private encodeToZChars(word: string): number[] {
    const max = this.resolution * 3;

    if (word.length > max) word = word.slice(0, max);

    const alphabet = this.newAlphabet();
    const zchars: number[] = [];
    let ti = 0;

    while (zchars.length < max) {
      zchars.push(...(ti < word.length ? this.encodeChar(word[ti++], alphabet) : [5]));
    }

    zchars.length = max;

    return zchars;
  }

  /** Encode a single character into its Z-characters (alphabet shift or 10-bit ZSCII escape). */
  private encodeChar(ch: string, alphabet: AlphabetTable): number[] {
    if (ch === " ") return [0];

    const found = alphabet.findChar(ch);

    if (!found) {
      const zc = ch.charCodeAt(0);
      return [5, 6, (zc >> 5) & 0x1f, zc & 0x1f];
    }

    if (found.set !== 0) {
      return [(this.version <= 2 ? 1 : 3) + found.set, found.index];
    }

    return [found.index];
  }

  /** Pack `resolution * 3` Z-characters into packed Z-words, with the terminator bit set. */
  private packZChars(zchars: number[]): number[] {
    const words: number[] = [];

    for (let i = 0; i < this.resolution; i++) {
      words.push(((zchars[i * 3] << 10) | (zchars[i * 3 + 1] << 5) | zchars[i * 3 + 2]) & 0xffff);
    }

    words[this.resolution - 1] |= 0x8000;

    return words;
  }

  private get resolution(): number {
    return this.version <= 3 ? 2 : 3;
  }

  private readAbbreviation(index: number): number[] {
    // Unreachable in practice: `index` is 32*(z-1)+next with z in 1..3 and next
    // in 0..31, so it is always 0..95. Kept as a guard against a decoder bug.
    /* v8 ignore next 3 -- @preserve */
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
        // Unreachable: zWordsToZChars masks each Z-character to 5 bits (0..31).
        /* v8 ignore next -- @preserve */
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
