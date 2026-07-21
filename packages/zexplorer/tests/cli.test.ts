import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { loadStoryFromFile } from "quendor/node";
import { dumpAll } from "quendor";
import { writeFileSync } from "node:fs";
import { cmdAbbrevs, cmdHeader, main } from "../src/cli.ts";

vi.mock("quendor/node", () => ({
  loadStoryFromFile: vi.fn(),
}));

// dumpAll is mocked (dumpHeader stays real) so these tests exercise cmdDump's
// own plumbing -- argument handling, stdout vs. file output -- without also
// having to fake a full, valid story for quendor's dump internals, which
// already have their own thorough test coverage.
vi.mock("quendor", async () => {
  const actual = await vi.importActual("quendor");

  return { ...actual, dumpAll: vi.fn() };
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
      checksum: 0,
    },
    readAbbreviations: () => abbreviations,
  } as unknown as Awaited<ReturnType<typeof loadStoryFromFile>>;
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
