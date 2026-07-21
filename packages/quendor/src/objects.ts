import type { Memory } from "./memory.ts";

/**
 * The Z-Machine object table: a tree of objects, each with attribute
 * flags, parent/sibling/child links, and a property table.
 *
 * The binary layout differs between versions: v1-3 use 9-byte entries
 * with 1-byte object numbers and 32 attributes; v4+ use 14-byte entries
 * with 2-byte object numbers and 48 attributes. See the Z-Machine
 * Standards Document 1.1, section 12.
 */
export class ObjectTable {
  private readonly memory: Memory;
  readonly version: number;
  readonly tableAddress: number;

  private readonly maxProperties: number;
  private readonly entriesAddress: number;
  private readonly entrySize: number;
  private readonly propertyTableAddressOffset: number;
  private readonly attributeCount: number;
  private readonly numberSize: number;
  private readonly parentOffset: number;
  private readonly siblingOffset: number;
  private readonly childOffset: number;

  constructor(memory: Memory, version: number, tableAddress: number) {
    this.memory = memory;
    this.version = version;
    this.tableAddress = tableAddress;

    const v3 = version <= 3;
    this.maxProperties = v3 ? 31 : 63;
    this.entriesAddress = tableAddress + this.maxProperties * 2;
    this.entrySize = v3 ? 9 : 14;
    this.propertyTableAddressOffset = v3 ? 7 : 12;
    this.attributeCount = v3 ? 32 : 48;
    this.numberSize = v3 ? 1 : 2;
    this.parentOffset = v3 ? 4 : 6;
    this.siblingOffset = v3 ? 5 : 8;
    this.childOffset = v3 ? 6 : 10;
  }

  /**
   * Count the objects by walking entries until they collide with
   * the lowest property-table address (there is no explicit count
   * in the format).
   */
  getObjectCount(): number {
    const maxObjects = this.version <= 3 ? 255 : 65535;
    let address = this.entriesAddress;
    let smallest = 0xffff;

    for (let i = 1; i <= maxObjects; i++) {
      if (address >= smallest) return i - 1;

      const propAddr = this.memory.readWord(address + this.propertyTableAddressOffset);

      smallest = Math.min(smallest, propAddr);
      address += this.entrySize;
    }

    return maxObjects;
  }

  getObjectAddress(objNum: number): number {
    if (objNum < 1) throw new RangeError(`invalid object number ${objNum}`);
    return this.entriesAddress + (objNum - 1) * this.entrySize;
  }

  getPropertyTableAddress(objNum: number): number {
    return this.memory.readWord(this.getObjectAddress(objNum) + this.propertyTableAddressOffset);
  }

  /** Address of the object's short-name length byte (zwords follow it). */
  getShortNameAddress(objNum: number): number {
    return this.getPropertyTableAddress(objNum);
  }

  /** The attribute numbers currently set on an object. */
  getSetAttributes(objNum: number): number[] {
    const result: number[] = [];

    for (let a = 0; a < this.attributeCount; a++) {
      if (this.hasAttribute(objNum, a)) result.push(a);
    }

    return result;
  }

  hasAttribute(objNum: number, attribute: number): boolean {
    if (attribute < 0 || attribute >= this.attributeCount) {
      throw new RangeError(`invalid attribute ${attribute}`);
    }

    const addr = this.getObjectAddress(objNum) + (attribute >> 3);
    const mask = 1 << (7 - (attribute & 7));

    return (this.memory.readByte(addr) & mask) !== 0;
  }

  getParent(objNum: number): number {
    return this.readNumber(this.getObjectAddress(objNum) + this.parentOffset);
  }

  getSibling(objNum: number): number {
    return this.readNumber(this.getObjectAddress(objNum) + this.siblingOffset);
  }

  getChild(objNum: number): number {
    return this.readNumber(this.getObjectAddress(objNum) + this.childOffset);
  }

  /** Address of the first property entry (after the short name). */
  getFirstPropertyAddress(objNum: number): number {
    const propTable = this.getPropertyTableAddress(objNum);
    const nameLength = this.memory.readByte(propTable);

    return propTable + 1 + nameLength * 2;
  }

  /** Given a property's size-byte address, address of the next property. */
  getNextPropertyAddress(propAddress: number): number {
    let size = this.memory.readByte(propAddress);

    propAddress++;

    if (this.version <= 3) {
      size >>= 5;
    } else if ((size & 0x80) !== 0x80) {
      size >>= 6;
    } else {
      size = this.memory.readByte(propAddress) & 0x3f;
      if (size === 0) size = 64;
    }

    return propAddress + size + 1;
  }

  /** List an object's properties (highest number first, as stored). */
  readProperties(objNum: number): { number: number; dataAddress: number; length: number }[] {
    const result: { number: number; dataAddress: number; length: number }[] = [];
    let address = this.getFirstPropertyAddress(objNum);

    for (;;) {
      const size = this.memory.readByte(address);

      if (size === 0) break; // terminator

      let number: number;
      let length: number;
      let dataAddress: number;

      if (this.version <= 3) {
        number = size & 0x1f;
        length = (size >> 5) + 1;
        dataAddress = address + 1;
      } else if ((size & 0x80) === 0) {
        number = size & 0x3f;
        length = ((size >> 6) & 1) + 1;
        dataAddress = address + 1;
      } else {
        number = size & 0x3f;
        length = this.memory.readByte(address + 1) & 0x3f;

        if (length === 0) length = 64;

        dataAddress = address + 2;
      }

      result.push({ number, dataAddress, length });
      address = this.getNextPropertyAddress(address);
    }

    return result;
  }

  private readNumber(address: number): number {
    return this.numberSize === 1 ? this.memory.readByte(address) : this.memory.readWord(address);
  }
}
