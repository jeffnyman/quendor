import { Memory } from "./voxam/Memory";

export class ZMachine {
  private readonly _memory: Memory;

  constructor(zcode: Buffer) {
    this._memory = new Memory(zcode);
  }

  public get memory(): Memory {
    return this._memory;
  }
}
