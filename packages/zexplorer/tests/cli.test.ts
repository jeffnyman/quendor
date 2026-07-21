import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { loadStoryFromFile } from "quendor/node";
import {
  disassembleReachable,
  dumpAll,
  formatInstruction,
  type DisassembledRun,
  type Instruction,
} from "quendor";
import { writeFileSync } from "node:fs";
import { cmdAbbrevs, cmdHeader, main } from "../src/cli.ts";

vi.mock("quendor/node", () => ({
  loadStoryFromFile: vi.fn(),
}));

// dumpAll/InstructionReader/formatInstruction/isReturnLike are mocked
// (dumpHeader stays real) so these tests exercise the CLI's own plumbing --
// argument handling, stdout vs. file output, the disasm loop -- without also
// having to fake a full, valid story for quendor's internals, which already
// have their own thorough test coverage.
vi.mock("quendor", async () => {
  const actual = await vi.importActual("quendor");

  return {
    ...actual,
    dumpAll: vi.fn(),
    formatInstruction: vi.fn(),
    disassembleReachable: vi.fn(),
  };
});

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
}));

// `fileLength: 0` sidesteps computeChecksum's byte-reading loop, so this
// fake doesn't need a working `memory.readByte`.
function fakeStory(
  size: number,
  abbreviations: string[] = [],
): Awaited<ReturnType<typeof loadStoryFromFile>> {
  return {
    memory: { size },
    header: {
      version: 3,
      release: 0,
      highMemoryBase: 0,
      initialProgramCounter: 0,
      dictionaryAddress: 0,
      objectTableAddress: 0,
      globalVariablesTableAddress: 0,
      staticMemoryBase: 0,
      serialNumber: "000000",
      abbreviationsTableAddress: 0,
      fileLength: 0,
      alphabetTableAddress: 0,
      routinesOffset: 0,
      checksum: 0,
    },
    readAbbreviations: () => abbreviations,
  } as unknown as Awaited<ReturnType<typeof loadStoryFromFile>>;
}

function fakeInsn(address: number): Instruction {
  return { address } as unknown as Instruction;
}

function hex(n: number, width = 4): string {
  return "0x" + n.toString(16).padStart(width, "0");
}

const originalArgv = process.argv;
let stdoutWrite: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = undefined;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test("cmdHeader logs the byte count for a loaded story", async () => {
  vi.mocked(loadStoryFromFile).mockResolvedValue(fakeStory(10));

  await cmdHeader("game.z5");

  expect(loadStoryFromFile).toHaveBeenCalledWith("game.z5");
  expect(console.log).toHaveBeenCalledWith("loaded 10 bytes");
});

test("main prints usage and exits 1 when header is missing a path", async () => {
  process.argv = ["node", "zexp", "header"];

  await main();

  expect(console.error).toHaveBeenCalledWith("usage: zexp header <story-file>");
  expect(process.exitCode).toBe(1);
  expect(loadStoryFromFile).not.toHaveBeenCalled();
});

test("main dispatches to cmdHeader when given a path", async () => {
  vi.mocked(loadStoryFromFile).mockResolvedValue(fakeStory(5));
  process.argv = ["node", "zexp", "header", "game.z5"];

  await main();

  expect(loadStoryFromFile).toHaveBeenCalledWith("game.z5");
  expect(console.log).toHaveBeenCalledWith("loaded 5 bytes");
});

test("cmdAbbrevs logs each decoded abbreviation with its index", async () => {
  vi.mocked(loadStoryFromFile).mockResolvedValue(fakeStory(10, ["a room", "the "]));

  await cmdAbbrevs("game.z5");

  expect(loadStoryFromFile).toHaveBeenCalledWith("game.z5");
  expect(console.log).toHaveBeenCalledWith('[ 0] "a room"');
  expect(console.log).toHaveBeenCalledWith('[ 1] "the "');
});

test("main prints usage and exits 1 when abbrevs is missing a path", async () => {
  process.argv = ["node", "zexp", "abbrevs"];

  await main();

  expect(console.error).toHaveBeenCalledWith("usage: zexp abbrevs <story-file>");
  expect(process.exitCode).toBe(1);
  expect(loadStoryFromFile).not.toHaveBeenCalled();
});

test("main dispatches to cmdAbbrevs when given a path", async () => {
  vi.mocked(loadStoryFromFile).mockResolvedValue(fakeStory(5, ["a room"]));
  process.argv = ["node", "zexp", "abbrevs", "game.z5"];

  await main();

  expect(loadStoryFromFile).toHaveBeenCalledWith("game.z5");
  expect(console.log).toHaveBeenCalledWith('[ 0] "a room"');
});

test("main prints usage and exits 1 when dump is missing a path", async () => {
  process.argv = ["node", "zexp", "dump"];

  await main();

  expect(console.error).toHaveBeenCalledWith("usage: zexp dump <story-file> [output-file]");
  expect(process.exitCode).toBe(1);
  expect(loadStoryFromFile).not.toHaveBeenCalled();
});

test("main dispatches to cmdDump and writes the combined dump to stdout by default", async () => {
  vi.mocked(loadStoryFromFile).mockResolvedValue(fakeStory(5));
  vi.mocked(dumpAll).mockReturnValue("DUMP CONTENT");
  process.argv = ["node", "zexp", "dump", "game.z5"];

  await main();

  expect(loadStoryFromFile).toHaveBeenCalledWith("game.z5");
  expect(stdoutWrite).toHaveBeenCalledWith("File: game.z5\n\nDUMP CONTENT\n");
  expect(writeFileSync).not.toHaveBeenCalled();
});

test("main dispatches to cmdDump and writes the combined dump to a file when given an output path", async () => {
  vi.mocked(loadStoryFromFile).mockResolvedValue(fakeStory(5));
  vi.mocked(dumpAll).mockReturnValue("DUMP CONTENT");
  process.argv = ["node", "zexp", "dump", "game.z5", "out.txt"];

  await main();

  expect(writeFileSync).toHaveBeenCalledWith("out.txt", "File: game.z5\n\nDUMP CONTENT\n");
  expect(console.log).toHaveBeenCalledWith("Wrote dump to out.txt");
  expect(stdoutWrite).not.toHaveBeenCalled();
});

test("main prints usage and exits 1 when disasm is missing a path", async () => {
  process.argv = ["node", "zexp", "disasm"];

  await main();

  expect(console.error).toHaveBeenCalledWith("usage: zexp disasm <story-file> [hex-address]");
  expect(process.exitCode).toBe(1);
  expect(loadStoryFromFile).not.toHaveBeenCalled();
});

test("main dispatches to cmdDisasm, printing each run with its own header and an error note", async () => {
  vi.mocked(loadStoryFromFile).mockResolvedValue(fakeStory(5));

  const runs: DisassembledRun[] = [
    {
      startAddress: 0x100,
      isRoutineStart: true,
      instructions: [fakeInsn(0x101)],
      error: undefined,
    },
    {
      startAddress: 0x200,
      isRoutineStart: false,
      instructions: [],
      error: "Unknown opcode: kind=TwoOp number=0x05",
    },
  ];

  vi.mocked(disassembleReachable).mockReturnValue(runs);
  vi.mocked(formatInstruction).mockReturnValue("FORMATTED");
  process.argv = ["node", "zexp", "disasm", "game.z5"];

  await main();

  expect(console.log).toHaveBeenNthCalledWith(1, "=== ROUTINE @0x0100 ===");
  expect(console.log).toHaveBeenNthCalledWith(2, `${hex(0x101)}:  FORMATTED`);
  expect(console.log).toHaveBeenNthCalledWith(3, "");
  expect(console.log).toHaveBeenNthCalledWith(4, "=== run @0x0200 ===");
  expect(console.log).toHaveBeenNthCalledWith(
    5,
    "  (stopped: Unknown opcode: kind=TwoOp number=0x05)",
  );
  expect(console.log).toHaveBeenNthCalledWith(6, "");
  expect(console.log).toHaveBeenNthCalledWith(7, "2 runs, 1 instructions total");
});

test("main dispatches to cmdDisasm with an explicit hex start address", async () => {
  vi.mocked(loadStoryFromFile).mockResolvedValue(fakeStory(5));
  vi.mocked(disassembleReachable).mockReturnValue([]);
  process.argv = ["node", "zexp", "disasm", "game.z5", "2000"];

  await main();

  expect(disassembleReachable).toHaveBeenCalledWith(expect.anything(), 0x2000);
});

test("main prints usage and exits 1 for an unknown command", async () => {
  process.argv = ["node", "zexp", "bogus"];

  await main();

  expect(console.error).toHaveBeenCalledWith("usage: zexp <command> [args]");
  expect(process.exitCode).toBe(1);
});

test("main prints usage and exits 1 when no command is given", async () => {
  process.argv = ["node", "zexp"];

  await main();

  expect(process.exitCode).toBe(1);
});
