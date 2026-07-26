import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  defaultSaveName,
  deliverInput,
  drawUpperWindow,
  installHostCallbacks,
  main,
  parseArgs,
  promptForSaveFile,
  runTerminalLoop,
  setScrollRegion,
} from "../src/cli.ts";
import { loadStoryFromFile, readCharSync, readLineSync } from "../src/node.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { TextStyle, type Cell } from "../src/screen.ts";
import { RunState, type Machine } from "../src/machine.ts";
import { Story } from "../src/story.ts";
import { HeaderOffset } from "../src/header.ts";

// The CLI reads input synchronously via node.ts and touches the filesystem for
// save/restore; mock both so the tests can drive them without real stdin/disk.
vi.mock("../src/node.ts", () => ({
  loadStoryFromFile: vi.fn(),
  readLineSync: vi.fn(),
  readCharSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
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

// --- installHostCallbacks --------------------------------------------------

/** A minimal Machine stand-in: just the slots installHostCallbacks writes to. */
function hostMachine(): Machine {
  return { screen: { upperHeight: 0 } } as unknown as Machine;
}

test("installHostCallbacks: onOutput writes text straight to stdout", () => {
  const out = captureStdout();
  const machine = hostMachine();

  installHostCallbacks(machine, "save.qzl");
  machine.onOutput("hello");

  expect(out.text()).toBe("hello");
});

test("installHostCallbacks: onSoundEffect bleeps for 1 and 2, ignores sampled sounds", () => {
  const out = captureStdout();
  const machine = hostMachine();

  installHostCallbacks(machine, "save.qzl");
  machine.onSoundEffect(1, 0, 0, 0);
  machine.onSoundEffect(3, 0, 0, 0); // sampled — ignored
  machine.onSoundEffect(2, 0, 0, 0);

  expect(out.text()).toBe("\x07\x07");
});

test("installHostCallbacks: onSave prompts, writes the file, and returns true", () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(readLineSync).mockReturnValue(""); // accept the default name
  vi.mocked(writeFileSync).mockReturnValue(undefined);

  const machine = hostMachine();
  installHostCallbacks(machine, "zork1.qzl");

  const data = new Uint8Array([1, 2, 3]);
  expect(machine.onSave(data)).toBe(true);
  expect(writeFileSync).toHaveBeenCalledWith("zork1.qzl", data);
});

test("installHostCallbacks: onSave returns false when the write throws", () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(readLineSync).mockReturnValue("");
  vi.mocked(writeFileSync).mockImplementation(() => {
    throw new Error("disk full");
  });

  const machine = hostMachine();
  installHostCallbacks(machine, "zork1.qzl");

  expect(machine.onSave(new Uint8Array([1]))).toBe(false);
});

test("installHostCallbacks: onRestore reads an existing save file", () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(readLineSync).mockReturnValue("");
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(Buffer.from([4, 5, 6]));

  const machine = hostMachine();
  installHostCallbacks(machine, "zork1.qzl");

  expect(machine.onRestore()).toEqual(new Uint8Array([4, 5, 6]));
});

test("installHostCallbacks: onRestore returns null when the save file is missing", () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(readLineSync).mockReturnValue("");
  vi.mocked(existsSync).mockReturnValue(false);

  const machine = hostMachine();
  installHostCallbacks(machine, "zork1.qzl");

  expect(machine.onRestore()).toBeNull();
});

test("installHostCallbacks: onRestore returns null when reading the file throws", () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(readLineSync).mockReturnValue("");
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockImplementation(() => {
    throw new Error("read error");
  });

  const machine = hostMachine();
  installHostCallbacks(machine, "zork1.qzl");

  expect(machine.onRestore()).toBeNull();
});

test("installHostCallbacks: onClearScreen is a no-op when stdout is not a TTY", () => {
  const out = captureStdout();
  const machine = hostMachine();

  installHostCallbacks(machine, "save.qzl");
  machine.onClearScreen();

  expect(out.text()).toBe("");
});

test("installHostCallbacks: onClearScreen clears below the status bar on a TTY", () => {
  const out = captureStdout();
  const isTTYDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

  const machine = { screen: { upperHeight: 2 } } as unknown as Machine;

  try {
    installHostCallbacks(machine, "save.qzl");
    machine.onClearScreen();
    // clears from the first lower-window row (upperHeight + 1 = 3) to end of screen
    expect(out.text()).toBe("\x1b[3;1H\x1b[J");
  } finally {
    Object.defineProperty(
      process.stdout,
      "isTTY",
      isTTYDesc ?? { value: undefined, configurable: true },
    );
  }
});

// --- deliverInput ----------------------------------------------------------

test("deliverInput reads a line and provides it (line input)", () => {
  vi.mocked(readLineSync).mockReturnValue("go north");
  const provideInput = vi.fn();
  const machine = { awaitingCharInput: false, provideInput } as unknown as Machine;

  expect(deliverInput(machine)).toBe(true);
  expect(provideInput).toHaveBeenCalledWith("go north");
});

test("deliverInput returns false at end of input (line)", () => {
  vi.mocked(readLineSync).mockReturnValue(null);
  const machine = { awaitingCharInput: false, provideInput: vi.fn() } as unknown as Machine;

  expect(deliverInput(machine)).toBe(false);
});

test("deliverInput reads a single key (read_char) and provides it", () => {
  vi.mocked(readCharSync).mockReturnValue("x");
  const provideChar = vi.fn();
  const machine = { awaitingCharInput: true, provideChar } as unknown as Machine;

  expect(deliverInput(machine)).toBe(true);
  expect(provideChar).toHaveBeenCalledWith("x");
});

test("deliverInput returns false at end of input (read_char)", () => {
  vi.mocked(readCharSync).mockReturnValue(null);
  const machine = { awaitingCharInput: true, provideChar: vi.fn() } as unknown as Machine;

  expect(deliverInput(machine)).toBe(false);
});

// --- runTerminalLoop / main's run path -------------------------------------

/** A minimal real story that quits immediately (initial PC -> 0OP quit). */
function quitStory(): Story {
  const bytes = new Uint8Array(0x100);
  const MAIN = 0x40;
  bytes[HeaderOffset.Version] = 3;
  bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
  bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
  bytes[MAIN] = 0xba; // quit
  return new Story(bytes);
}

test("main loads the story, wires it up, and runs it to completion (TTY: clears the screen)", async () => {
  process.argv = ["node", "quendor", "game.z3"];
  const out = captureStdout();
  vi.mocked(loadStoryFromFile).mockResolvedValue(quitStory());

  const isTTYDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

  try {
    await main();

    expect(loadStoryFromFile).toHaveBeenCalledWith("game.z3");
    expect(process.exitCode).toBeUndefined();
    expect(out.text()).toContain("\x1b[2J"); // Std §8: clear the screen on start
  } finally {
    Object.defineProperty(
      process.stdout,
      "isTTY",
      isTTYDesc ?? { value: undefined, configurable: true },
    );
  }
});

test("runTerminalLoop delivers a line at a read prompt, then stops when the game halts", () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(readLineSync).mockReturnValue("look");

  const provideInput = vi.fn();
  const run = vi
    .fn()
    .mockReturnValueOnce(RunState.WaitingForInput)
    .mockReturnValueOnce(RunState.Halted);
  const machine = { run, provideInput, awaitingCharInput: false } as unknown as Machine;

  runTerminalLoop(machine);

  expect(provideInput).toHaveBeenCalledWith("look");
  expect(run).toHaveBeenCalledTimes(2);
});

test("runTerminalLoop stops at end of input", () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(readLineSync).mockReturnValue(null); // EOF

  const run = vi.fn().mockReturnValue(RunState.WaitingForInput);
  const machine = { run, provideInput: vi.fn(), awaitingCharInput: false } as unknown as Machine;

  runTerminalLoop(machine);

  expect(run).toHaveBeenCalledTimes(1);
});

test("runTerminalLoop repaints the upper window and resets the region on a TTY", () => {
  const out = captureStdout();
  const isTTYDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const rowsDesc = Object.getOwnPropertyDescriptor(process.stdout, "rows");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "rows", { value: 24, configurable: true });
  vi.mocked(readLineSync).mockReturnValue("go");

  const run = vi
    .fn()
    .mockReturnValueOnce(RunState.WaitingForInput)
    .mockReturnValueOnce(RunState.Halted);
  const machine = {
    run,
    provideInput: vi.fn(),
    awaitingCharInput: false,
    screen: { upperHeight: 1, upper: [[{ ch: "S", style: 0, fg: 1, bg: 1 }]] },
  } as unknown as Machine;

  try {
    runTerminalLoop(machine);
    const text = out.text();

    expect(text).toContain("\x1b[2;24r"); // setScrollRegion(1): region rows 2..24
    expect(text).toContain("S"); // drawUpperWindow painted the status cell
    expect(text).toContain("\x1b[r"); // cleanup reset the region on exit
  } finally {
    Object.defineProperty(
      process.stdout,
      "isTTY",
      isTTYDesc ?? { value: undefined, configurable: true },
    );
    Object.defineProperty(
      process.stdout,
      "rows",
      rowsDesc ?? { value: undefined, configurable: true },
    );
  }
});
