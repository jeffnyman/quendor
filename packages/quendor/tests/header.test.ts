import { expect, test } from "vite-plus/test";
import { Memory } from "../src/memory.ts";
import {
  computeChecksum,
  HeaderOffset,
  readHeader,
  unpackRoutineAddress,
  type Header,
} from "../src/header.ts";

interface HeaderField {
  name: string;
  write: (bytes: Uint8Array) => void;
  expected: number | string;
  read: (header: Header) => number | string;
}

const HEADER_FIELDS: HeaderField[] = [
  {
    name: "version",
    write: (bytes) => {
      bytes[HeaderOffset.Version] = 7;
    },
    expected: 7,
    read: (header) => header.version,
  },
  {
    name: "release",
    write: (bytes) => {
      bytes[HeaderOffset.Release] = 0x01;
      bytes[HeaderOffset.Release + 1] = 0x02;
    },
    expected: 0x0102,
    read: (header) => header.release,
  },
  {
    name: "serialNumber",
    write: (bytes) => {
      const serial = "861222";

      for (let i = 0; i < serial.length; i++) {
        bytes[HeaderOffset.SerialNumber + i] = serial.charCodeAt(i);
      }
    },
    expected: "861222",
    read: (header) => header.serialNumber,
  },
  {
    name: "routinesOffset",
    write: (bytes) => {
      bytes[HeaderOffset.RoutinesOffset] = 0x00;
      bytes[HeaderOffset.RoutinesOffset + 1] = 0x05;
    },
    expected: 5,
    read: (header) => header.routinesOffset,
  },
];

function buildMemory(size: number, fill: (bytes: Uint8Array) => void): Memory {
  const bytes = new Uint8Array(size);

  fill(bytes);

  return new Memory(bytes);
}

test.each(HEADER_FIELDS)("reads $name from its header offset", ({ write, expected, read }) => {
  const memory = buildMemory(64, write);

  expect(read(readHeader(memory))).toBe(expected);
});

test.each([
  { version: 3, scale: 2 },
  { version: 4, scale: 4 },
  { version: 5, scale: 4 },
  { version: 6, scale: 8 },
])("scales fileLength by $scale for version $version", ({ version, scale }) => {
  const memory = buildMemory(64, (bytes) => {
    bytes[HeaderOffset.Version] = version;
    bytes[HeaderOffset.FileLength] = 0x00;
    bytes[HeaderOffset.FileLength + 1] = 0x10;
  });

  expect(readHeader(memory).fileLength).toBe(0x10 * scale);
});

test.each([
  [1, 2],
  [2, 2],
  [3, 2],
  [4, 4],
  [5, 4],
  [8, 8],
])("unpackRoutineAddress scales version %i's packed address by %i", (version, factor) => {
  expect(unpackRoutineAddress(version, 100, 0)).toBe(100 * factor);
});

test.each([6, 7])(
  "unpackRoutineAddress adds the routines offset (x8) for version %i",
  (version) => {
    expect(unpackRoutineAddress(version, 100, 5)).toBe(100 * 4 + 5 * 8);
  },
);

test("throws when memory is too short to contain the header", () => {
  const memory = new Memory(new Uint8Array(0));

  expect(() => readHeader(memory)).toThrow(RangeError);
});

test("computeChecksum sums bytes from 0x40 up to the declared file length", () => {
  const memory = buildMemory(80, (bytes) => {
    bytes[HeaderOffset.Version] = 3; // scale 2
    bytes[HeaderOffset.FileLength + 1] = 40; // 40 * 2 = 80

    for (let i = 0x40; i < 80; i++) {
      bytes[i] = 1;
    }
  });

  expect(computeChecksum(memory, readHeader(memory))).toBe(80 - 0x40);
});

test("computeChecksum stops at the actual memory size when fileLength overruns it", () => {
  const memory = buildMemory(70, (bytes) => {
    bytes[HeaderOffset.Version] = 3; // scale 2
    bytes[HeaderOffset.FileLength + 1] = 40; // claims 80 bytes, but memory is only 70

    for (let i = 0x40; i < 70; i++) {
      bytes[i] = 1;
    }
  });

  expect(computeChecksum(memory, readHeader(memory))).toBe(70 - 0x40);
});
