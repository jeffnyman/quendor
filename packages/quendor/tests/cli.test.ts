import { afterEach, expect, test, vi } from "vite-plus/test";
import { defaultSaveName, main, parseArgs, promptForSaveFile } from "../src/cli.ts";
import { readLineSync } from "../src/node.ts";

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
