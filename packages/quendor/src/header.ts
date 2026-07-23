import type { Memory } from "./memory.ts";

/**
 * Fixed byte offsets of the Z-Machine story header.
 * See the Z-Machine Standards Document 1.1, section 11.
 */
export const HeaderOffset = {
  Version: 0x00,
  Flags1: 0x01,
  Release: 0x02,
  HighMemoryBase: 0x04,
  InitialProgramCounter: 0x06,
  DictionaryAddress: 0x08,
  ObjectTableAddress: 0x0a,
  GlobalVariablesTableAddress: 0x0c,
  StaticMemoryBase: 0x0e,
  Flags2: 0x10,
  SerialNumber: 0x12, // 6 bytes of ASCII
  AbbreviationsTableAddress: 0x18,
  FileLength: 0x1a,
  Checksum: 0x1c,
  InterpreterNumber: 0x1e,
  InterpreterVersion: 0x1f,
  RoutinesOffset: 0x28, // v6/v7; divided by 8 to get the real offset
  StringsOffset: 0x2a, // v6/v7; divided by 8 to get the real offset
  AlphabetTableAddress: 0x34, // v5+; 0 means use the default alphabets
} as const;

export interface Header {
  version: number;
  release: number;
  highMemoryBase: number;
  initialProgramCounter: number;
  dictionaryAddress: number;
  objectTableAddress: number;
  globalVariablesTableAddress: number;
  staticMemoryBase: number;
  serialNumber: string;
  abbreviationsTableAddress: number;
  /** File length as declared by the header (already un-scaled to bytes). */
  fileLength: number;
  /** Custom alphabet table address (v5+); 0 = use the default alphabets. */
  alphabetTableAddress: number;
  /** v6/v7 routine-packing base, stored divided by 8 (see unpackRoutineAddress). */
  routinesOffset: number;
  /** v6/v7 string-packing base, stored divided by 8 (see unpackString). */
  stringsOffset: number;
  checksum: number;
}

export function readHeader(memory: Memory): Header {
  const version = memory.readByte(HeaderOffset.Version);
  const serialBytes = memory.readBytes(HeaderOffset.SerialNumber, 6);
  const serialNumber = String.fromCharCode(...serialBytes);

  return {
    version,
    release: memory.readWord(HeaderOffset.Release),
    highMemoryBase: memory.readWord(HeaderOffset.HighMemoryBase),
    initialProgramCounter: memory.readWord(HeaderOffset.InitialProgramCounter),
    dictionaryAddress: memory.readWord(HeaderOffset.DictionaryAddress),
    objectTableAddress: memory.readWord(HeaderOffset.ObjectTableAddress),
    globalVariablesTableAddress: memory.readWord(HeaderOffset.GlobalVariablesTableAddress),
    staticMemoryBase: memory.readWord(HeaderOffset.StaticMemoryBase),
    serialNumber,
    abbreviationsTableAddress: memory.readWord(HeaderOffset.AbbreviationsTableAddress),
    fileLength: memory.readWord(HeaderOffset.FileLength) * fileLengthScale(version),
    alphabetTableAddress: version >= 5 ? memory.readWord(HeaderOffset.AlphabetTableAddress) : 0,
    routinesOffset: memory.readWord(HeaderOffset.RoutinesOffset),
    stringsOffset: memory.readWord(HeaderOffset.StringsOffset),
    checksum: memory.readWord(HeaderOffset.Checksum),
  };
}

/**
 * The header checksum is the unsigned sum of every byte from 0x40 to the
 * declared file length, mod 0x10000. Verifying it confirms the story loaded
 * intact and that our file-length scaling is right.
 */
export function computeChecksum(memory: Memory, header: Header): number {
  let sum = 0;
  const end = Math.min(header.fileLength, memory.size);

  for (let i = 0x40; i < end; i++) {
    sum = (sum + memory.readByte(i)) & 0xffff;
  }

  return sum;
}

/**
 * Unpack a packed routine address into a real byte address. The packing
 * factor is version-dependent; v6/v7 also add a story-specific base (the
 * header's Routines Offset, stored divided by 8) since those versions can
 * address routines beyond the 16-bit packed-address range. See the
 * Z-Machine Standards Document 1.1, section 1.2.3.
 */
export function unpackRoutineAddress(
  version: number,
  packedAddress: number,
  routinesOffset: number,
): number {
  switch (version) {
    case 1:
    case 2:
    case 3:
      return packedAddress * 2;
    case 4:
    case 5:
      return packedAddress * 4;
    case 6:
    case 7:
      return packedAddress * 4 + routinesOffset * 8;
    default:
      return packedAddress * 8;
  }
}

/**
 * Unpack a packed string address into a real byte address. Mirrors
 * unpackRoutineAddress: version-dependent packing, with v6/v7 adding the
 * header's Strings Offset (stored divided by 8). See the Z-Machine Standards
 * Document 1.1, section 1.2.3.
 */
export function unpackString(
  version: number,
  packedAddress: number,
  stringsOffset: number,
): number {
  switch (version) {
    case 1:
    case 2:
    case 3:
      return packedAddress * 2;
    case 4:
    case 5:
      return packedAddress * 4;
    case 6:
    case 7:
      return packedAddress * 4 + stringsOffset * 8;
    default:
      return packedAddress * 8;
  }
}

/**
 * The header stores file length divided by a version-dependent factor.
 * v1-3: /2, v4-5: /4, v6-8: /8.
 */
function fileLengthScale(version: number): number {
  if (version <= 3) return 2;
  if (version <= 5) return 4;
  return 8;
}
