import { Memory } from "./memory.ts";

export class Story {
  readonly memory: Memory;

  constructor(bytes: Uint8Array) {
    this.memory = new Memory(bytes);
  }
}
