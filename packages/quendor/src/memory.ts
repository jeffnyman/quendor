export class Memory {
  readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get size(): number {
    return this.bytes.length;
  }
}
