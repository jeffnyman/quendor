import { readHeader, type Header } from "./header.ts";
import { Memory } from "./memory.ts";
import { ZText } from "./text.ts";

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
}
