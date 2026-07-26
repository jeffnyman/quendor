import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  defaultSaveName,
  drawUpperWindow,
  main,
  parseArgs,
  promptForSaveFile,
  setScrollRegion,
} from "../src/cli.ts";
import { readLineSync } from "../src/node.ts";
import { TextStyle, type Cell } from "../src/screen.ts";

// promptForSaveFile reads a line synchronously via readLineSync; mock the node
// entry so the tests can drive it without real stdin.
vi.mock("../src/node.ts", () => ({
  loadStoryFromFile: vi.fn(),
  readLineSync: vi.fn(),
}));

// --- parseArgs -------------------------------------------------------------

test("parses a bare story path", () => {
  expect(parseArgs(["game.z3"])).toEqual({ help: false, path: "game.z3", seed: undefined });
});

test("--help and -h short-circuit to help, even alongside other arguments", () => {
  expect(parseArgs(["--help"])).toEqual({ help: true });
  expect(parseArgs(["-h"])).toEqual({ help: true });
  expect(parseArgs(["game.z3", "--help"])).toEqual({ help: true });
});

test("--seed consumes its value and does not mistake it for the path", () => {
  // The reason parseArgs walks by index instead of scanning for the first
  // non-dash argument: the seed's value is itself a non-dash argument.
  expect(parseArgs(["--seed", "42", "game.z3"])).toEqual({
    help: false,
    path: "game.z3",
    seed: 42,
  });
});

test("--seed with no following value is ignored, and the path still resolves", () => {
  expect(parseArgs(["game.z3", "--seed"])).toEqual({
    help: false,
    path: "game.z3",
    seed: undefined,
  });
});

test("--seed with a non-numeric value is dropped but still consumed", () => {
  // 'abc' is consumed by --seed, so it never falls through to become the path.
  expect(parseArgs(["--seed", "abc", "game.z3"])).toEqual({
    help: false,
    path: "game.z3",
    seed: undefined,
  });
});

test("takes the first positional as the path and ignores unknown flags", () => {
  expect(parseArgs(["--verbose", "first.z3", "second.z3"])).toEqual({
    help: false,
    path: "first.z3",
    seed: undefined,
  });
});

test("--tandy is an accumulating flag (unlike --help), coexisting with the path", () => {
  expect(parseArgs(["--tandy", "game.z3"])).toEqual({
    help: false,
    path: "game.z3",
    seed: undefined,
    tandy: true,
  });
});

test("parses --interpreter (number) and --interpreter-version (letter -> byte)", () => {
  expect(parseArgs(["--interpreter", "2", "--interpreter-version", "B", "game.z3"])).toEqual({
    help: false,
    path: "game.z3",
    seed: undefined,
    tandy: undefined,
    interpreterNumber: 2,
    interpreterVersion: 0x42, // 'B'
  });
});

test("drops --interpreter with a non-numeric value", () => {
  expect(parseArgs(["--interpreter", "xyz", "game.z3"]).interpreterNumber).toBeUndefined();
});

// --- main early exits ------------------------------------------------------

const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

test("main prints usage on --help and doesn't set a failure exit code", async () => {
  process.argv = ["node", "quendor", "--help"];
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  await main();

  expect(log).toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
});

test("main errors and exits 1 when no story path is given", async () => {
  process.argv = ["node", "quendor"];
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  await main();

  expect(error).toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

// --- defaultSaveName -------------------------------------------------------

test("defaultSaveName drops the directory and the Z-code extension", () => {
  expect(defaultSaveName("entharion/zcode-infocom/zork1-r88-s840726.z3")).toBe(
    "zork1-r88-s840726.qzl",
  );
});

test("defaultSaveName handles a bare filename and other Z-code versions", () => {
  expect(defaultSaveName("game.z5")).toBe("game.qzl");
  expect(defaultSaveName("story.z8")).toBe("story.qzl");
});

test("defaultSaveName appends .qzl when the story has no extension", () => {
  expect(defaultSaveName("game")).toBe("game.qzl");
});

// --- promptForSaveFile -----------------------------------------------------

test("promptForSaveFile takes the default when the line is empty", () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(readLineSync).mockReturnValue("");

  expect(promptForSaveFile("zork1.qzl")).toBe("zork1.qzl");
});

test("promptForSaveFile takes the default on end-of-input (null)", () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(readLineSync).mockReturnValue(null);

  expect(promptForSaveFile("zork1.qzl")).toBe("zork1.qzl");
});

test("promptForSaveFile returns the typed name, trimmed", () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(readLineSync).mockReturnValue("  mysave.qzl  ");

  expect(promptForSaveFile("zork1.qzl")).toBe("mysave.qzl");
});

// --- terminal rendering: setScrollRegion / drawUpperWindow -----------------

/** Capture everything written to stdout as one string. */
function captureStdout(): { text: () => string } {
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  return { text: () => write.mock.calls.map((c) => String(c[0])).join("") };
}

test("setScrollRegion resets to the full screen when height is 0", () => {
  const out = captureStdout();

  setScrollRegion(0);

  expect(out.text()).toBe("\x1b[r");
});

test("setScrollRegion carves a region below the status rows when the terminal has a height", () => {
  const out = captureStdout();
  const rowsDesc = Object.getOwnPropertyDescriptor(process.stdout, "rows");
  Object.defineProperty(process.stdout, "rows", { value: 24, configurable: true });

  try {
    setScrollRegion(2);
    // cursor save (ESC 7), scroll region rows 3..24, cursor restore (ESC 8)
    expect(out.text()).toBe("\x1b7\x1b[3;24r\x1b8");
  } finally {
    if (rowsDesc) Object.defineProperty(process.stdout, "rows", rowsDesc);
    else Object.defineProperty(process.stdout, "rows", { value: undefined, configurable: true });
  }
});

const cell = (ch: string, style = 0): Cell => ({ ch, style, fg: 1, bg: 1 });

test("drawUpperWindow coalesces reverse-video runs, bracketed by cursor save/restore", () => {
  const out = captureStdout();

  // A is normal; B and C are reverse — the two reverse cells coalesce into one run.
  drawUpperWindow([[cell("A"), cell("B", TextStyle.Reverse), cell("C", TextStyle.Reverse)]]);

  const E = "\x1b";
  expect(out.text()).toBe(`${E}7${E}[1;1H${E}[0mA${E}[7mBC${E}[0m${E}8`);
});
