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
    checksum: memory.readWord(HeaderOffset.Checksum),
  };
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
