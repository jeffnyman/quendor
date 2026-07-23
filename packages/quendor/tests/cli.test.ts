import { afterEach, expect, test, vi } from "vite-plus/test";
import { main, parseArgs } from "../src/cli.ts";

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
