/**
 * The Z-Machine's flat address space.
 *
 * Everything in the Z-Machine is addressed as bytes; 16-bit
 * "words" are stored big-endian. JavaScript numbers are float64,
 * so every read is explicitly masked to the right unsigned width
 * and every write is masked before storing.
 */
export class Memory {
  readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get size(): number {
    return this.bytes.length;
  }

  /**
   * Optional observer invoked after every write, with the address
   * written and how many bytes (1 or 2). Left undefined on the hot
   * path (the interpreter only installs it while data watchpoints
   * are active) so normal execution pays nothing.
   */
  onWrite: ((address: number, size: number) => void) | undefined;

  /** Read an unsigned byte (0..255). */
  readByte(address: number): number {
    if (address < 0 || address >= this.bytes.length) {
      throw new RangeError(`readByte out of range: 0x${address.toString(16)}`);
    }

    return this.bytes[address];
  }

  /** Read `length` raw bytes starting at `address`. */
  readBytes(address: number, length: number): Uint8Array {
    if (address < 0 || address + length > this.bytes.length) {
      throw new RangeError(`readBytes out of range: 0x${address.toString(16)}+${length}`);
    }

    return this.bytes.subarray(address, address + length);
  }

  /** Read an unsigned 16-bit word, big-endian (0..65535). */
  readWord(address: number): number {
    if (address < 0 || address + 1 >= this.bytes.length) {
      throw new RangeError(`readWord out of range: 0x${address.toString(16)}`);
    }

    const hi = this.bytes[address];
    const lo = this.bytes[address + 1];

    return ((hi << 8) | lo) & 0xffff;
  }

  /** Write an unsigned byte; value is masked to 8 bits. */
  writeByte(address: number, value: number): void {
    if (address < 0 || address >= this.bytes.length) {
      throw new RangeError(`writeByte out of range: 0x${address.toString(16)}`);
    }

    this.bytes[address] = value & 0xff;
    this.onWrite?.(address, 1);
  }
}
