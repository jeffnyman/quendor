import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { loadStoryFromFile } from "quendor/node";
import { cmdHeader, main } from "../src/cli.ts";

vi.mock("quendor/node", () => ({
  loadStoryFromFile: vi.fn(),
}));

// `fileLength: 0` sidesteps computeChecksum's byte-reading loop, so this
// fake doesn't need a working `memory.readByte`.
function fakeStory(size: number): Awaited<ReturnType<typeof loadStoryFromFile>> {
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
  } as unknown as Awaited<ReturnType<typeof loadStoryFromFile>>;
}

const originalArgv = process.argv;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
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
