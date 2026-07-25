import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { loadStoryFromFile, readLineSync } from "quendor/node";
import {
  disassembleReachable,
  dumpAll,
  formatInstruction,
  formatResolvedOperands,
  Machine,
  RunState,
  type DisassembledRun,
  type Instruction,
} from "quendor";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cmdAbbrevs, cmdHeader, main, parseArgs } from "../src/cli.ts";

vi.mock("quendor/node", () => ({
  loadStoryFromFile: vi.fn(),
  readLineSync: vi.fn(),
}));

// dumpAll/formatInstruction/formatResolvedOperands/disassembleReachable/Machine
// are mocked (dumpHeader stays real) so these tests exercise the CLI's own
// plumbing -- argument handling, stdout vs. file output, the disasm loop, and
// the run/trace loop -- without having to fake a full, valid story for quendor's
// internals, which already have their own thorough test coverage.
vi.mock("quendor", async () => {
  const actual = await vi.importActual("quendor");

  return {
    ...actual,
    dumpAll: vi.fn(),
    formatInstruction: vi.fn(),
    formatResolvedOperands: vi.fn(),
    disassembleReachable: vi.fn(),
    Machine: vi.fn(),
  };
});

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
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
      stringsOffset: 0,
      checksum: 0,
    },
    readAbbreviations: () => abbreviations,
  } as unknown as Awaited<ReturnType<typeof loadStoryFromFile>>;
}

function fakeInsn(address: number): Instruction {
  return { address } as unknown as Instruction;
}

type FakeMachine = {
  onOutput?: (text: string) => void;
  onTrace?: (insn: Instruction, depth: number, ops: number[]) => void;
  run: ReturnType<typeof vi.fn>;
  provideInput: ReturnType<typeof vi.fn>;
};

// A stand-in for Machine that returns a scripted sequence of run() states. With
// emitTrace, the first run() fires onTrace once (as a real run would) so the
// --trace file path can be exercised.
function fakeMachine(states: RunState[], emitTrace = false): FakeMachine {
  let call = 0;
  const m: FakeMachine = {
    run: vi.fn(() => {
      if (call === 0 && emitTrace) m.onTrace?.(fakeInsn(0x100), 1, []);
      const state = call < states.length ? states[call] : RunState.Halted;
      call += 1;
      return state;
    }),
    provideInput: vi.fn(),
  };
  return m;
}

// Route `new Machine(...)` in cmdRun to a fake. vitest types a mocked class's
// impl as a constructor (void return), so the factory arrow is cast to a
// value-returning signature to keep the strict-void-return lint rule happy.
function installMachine(machine: FakeMachine): void {
  // vitest requires a class for a mock invoked with `new`; a constructor may
  // return an object, so we hand back the captured fake for cmdRun to drive.
  vi.mocked(Machine).mockImplementation(
    class {
      constructor() {
        return machine;
      }
    } as unknown as typeof Machine,
  );
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

  expect(console.error).toHaveBeenCalledWith("zexp: unknown command 'bogus'\n");
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
  expect(process.exitCode).toBe(1);
});

test("main prints usage and exits 1 when no command is given", async () => {
  process.argv = ["node", "zexp"];

  await main();

  expect(process.exitCode).toBe(1);
});

test("main prints help to stdout and exits 0 for --help", async () => {
  process.argv = ["node", "zexp", "--help"];

  await main();

  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
  expect(process.exitCode).toBeUndefined();
});

test("main prints usage and exits 1 when run is missing a path", async () => {
  process.argv = ["node", "zexp", "run"];

  await main();

  expect(console.error).toHaveBeenCalledWith(
    "usage: zexp run <story-file> [run-options]   (see 'zexp --help')",
  );
  expect(process.exitCode).toBe(1);
  expect(loadStoryFromFile).not.toHaveBeenCalled();
});

test("main run: constructs the machine with parsed options and runs to a halt", async () => {
  vi.mocked(loadStoryFromFile).mockResolvedValue(fakeStory(5));
  const machine = fakeMachine([RunState.Halted]);
  installMachine(machine);
  process.argv = ["node", "zexp", "run", "game.z5", "--seed", "42"];

  await main();

  expect(loadStoryFromFile).toHaveBeenCalledWith("game.z5");
  expect(Machine).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ randomSeed: 42 }),
  );
  expect(machine.run).toHaveBeenCalledTimes(1);
  expect(writeFileSync).not.toHaveBeenCalled(); // no --trace, so no file touched

  // onOutput is wired straight through to stdout.
  machine.onOutput?.("banner");
  expect(stdoutWrite).toHaveBeenCalledWith("banner");
});

test("main run: feeds a read line to the machine, then stops at end of input", async () => {
  vi.mocked(loadStoryFromFile).mockResolvedValue(fakeStory(5));
  const machine = fakeMachine([RunState.WaitingForInput, RunState.WaitingForInput]);
  installMachine(machine);
  vi.mocked(readLineSync).mockReturnValueOnce("north").mockReturnValueOnce(null);
  process.argv = ["node", "zexp", "run", "game.z5"];

  await main();

  expect(machine.provideInput).toHaveBeenCalledWith("north");
  expect(machine.provideInput).toHaveBeenCalledTimes(1); // null on the 2nd read breaks the loop
});

test("main run --trace: truncates the file, appends the traced line, and notes the path", async () => {
  vi.mocked(loadStoryFromFile).mockResolvedValue(fakeStory(5));
  vi.mocked(formatInstruction).mockReturnValue("call 0x1234");
  vi.mocked(formatResolvedOperands).mockReturnValue("G16=0x1234");
  const machine = fakeMachine([RunState.Halted], true);
  installMachine(machine);
  const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.argv = ["node", "zexp", "run", "game.z5", "--trace", "trace.log"];

  await main();

  expect(writeFileSync).toHaveBeenCalledWith("trace.log", ""); // truncated first
  expect(appendFileSync).toHaveBeenCalledWith("trace.log", "0x0100: call 0x1234  ; G16=0x1234\n");
  expect(stderrWrite).toHaveBeenCalledWith("\n[trace written to trace.log]\n");
});

// --- blorb command ---------------------------------------------------------

// A minimal real Blorb (FORM/IFRS with a single ZCOD chunk), so cmdBlorb's real
// describeBlorb/extractBlorb run against actual bytes rather than a mock.
function blorbWithZcod(story: Uint8Array): Uint8Array {
  const pad = story.length % 2;
  const chunkLen = 8 + story.length + pad;
  const bytes = new Uint8Array(12 + chunkLen);
  const view = new DataView(bytes.buffer);
  const put4 = (o: number, s: string): void => {
    for (let i = 0; i < 4; i++) bytes[o + i] = s.charCodeAt(i);
  };

  put4(0, "FORM");
  view.setUint32(4, 4 + chunkLen);
  put4(8, "IFRS");
  put4(12, "ZCOD");
  view.setUint32(16, story.length);
  bytes.set(story, 20);

  return bytes;
}

// readFileSync is overloaded (string | Buffer), which the mock's return type
// won't narrow cleanly; funnel the bytes through one cast here.
function mockReadFile(bytes: Uint8Array): void {
  vi.mocked(readFileSync).mockReturnValue(Buffer.from(bytes));
}

test("main blorb: reads the file and prints the Blorb description", async () => {
  mockReadFile(blorbWithZcod(new Uint8Array([5, 0, 0])));
  process.argv = ["node", "zexp", "blorb", "game.zblorb"];

  await main();

  expect(readFileSync).toHaveBeenCalledWith("game.zblorb");
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("ZCOD present"));
});

test("main blorb --extract: writes each resource and reports the count", async () => {
  mockReadFile(blorbWithZcod(new Uint8Array([5, 0, 0])));
  process.argv = ["node", "zexp", "blorb", "game.zblorb", "--extract", "out"];

  await main();

  expect(mkdirSync).toHaveBeenCalledWith("out", { recursive: true });
  expect(writeFileSync).toHaveBeenCalledWith("out/story.z5", expect.any(Uint8Array));
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Extracted 1 file"));
});

test("main blorb --extract on a non-Blorb reports nothing to extract", async () => {
  mockReadFile(new Uint8Array(20).fill(0x42));
  process.argv = ["node", "zexp", "blorb", "bare.z5", "--extract", "out"];

  await main();

  expect(mkdirSync).not.toHaveBeenCalled();
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Nothing to extract"));
});

// --- run option parsing ----------------------------------------------------

test("parseArgs collects the path plus the trace, seed, and tandy options", () => {
  const { path, opts } = parseArgs(["game.z3", "--trace", "out.log", "--seed", "42", "--tandy"]);

  expect(path).toBe("game.z3");
  expect(opts).toEqual({ trace: "out.log", seed: 42, tandy: true });
});

test("parseArgs drops --seed with no value or a non-numeric value", () => {
  expect(parseArgs(["game.z3", "--seed"]).opts.seed).toBeUndefined();
  expect(parseArgs(["--seed", "abc", "game.z3"]).opts.seed).toBeUndefined();
});

test("parseArgs leaves options empty when only a path is given", () => {
  const { path, opts } = parseArgs(["game.z3"]);

  expect(path).toBe("game.z3");
  expect(opts).toEqual({});
});

test("parseArgs reads --interpreter (number) and --interpreter-version (letter -> byte)", () => {
  const { opts } = parseArgs(["game.z3", "--interpreter", "11", "--interpreter-version", "T"]);

  expect(opts.interpreterNumber).toBe(11);
  expect(opts.interpreterVersion).toBe(0x54); // 'T'
});
