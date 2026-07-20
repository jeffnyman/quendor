import { readHeader, type Header } from "./header.ts";
import { Memory } from "./memory.ts";

export class Story {
  readonly memory: Memory;
  readonly header: Header;

  constructor(bytes: Uint8Array) {
    this.memory = new Memory(bytes);
    this.header = readHeader(this.memory);
  }
}
