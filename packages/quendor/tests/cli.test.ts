import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  defaultSaveName,
  deliverInput,
  installHostCallbacks,
  main,
  parseArgs,
  parseSolution,
  promptForSaveFile,
  renderFrame,
  runAcceptance,
  runAcceptanceMode,
  runTerminalLoop,
  solutionKey,
} from "../src/cli.ts";
import { loadStoryFromFile, readKeySync, readLineSync } from "../src/node.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { TextStyle, type Cell, type Screen } from "../src/screen.ts";
import { Machine, RunState } from "../src/machine.ts";
import { Story } from "../src/story.ts";
import { HeaderOffset } from "../src/header.ts";

// The CLI reads input synchronously via node.ts and touches the filesystem for
// save/restore; mock both so the tests can drive them without real stdin/disk.
vi.mock("../src/node.ts", () => ({
  loadStoryFromFile: vi.fn(),
  readLineSync: vi.fn(),
  readKeySync: vi.fn(),
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

// --- terminal rendering: renderFrame ---------------------------------------

/** Capture everything written to stdout as one string. */
function captureStdout(): { text: () => string } {
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  return { text: () => write.mock.calls.map((c) => String(c[0])).join("") };
}

const cell = (ch: string, style = 0): Cell => ({ ch, style, fg: 1, bg: 1, font: 1 });

test("renderFrame draws each grid row, coalescing reverse-video runs, then parks the cursor", () => {
  const E = "\x1b";
  const screen = {
    // A normal, B/C reverse (coalesced), D normal (reverse turns back off)
    grid: [[cell("A"), cell("B", TextStyle.Reverse), cell("C", TextStyle.Reverse), cell("D")]],
    height: 1,
    lowerCursor: { row: 0, col: 3 },
  } as unknown as Screen;

  expect(renderFrame(screen)).toBe(`${E}[1;1H${E}[0mA${E}[0;7mBC${E}[0mD${E}[0m${E}[1;4H`);
});

test("renderFrame emits ANSI colour for non-default fg/bg (2-9)", () => {
  const E = "\x1b";
  const colored = (ch: string, fg: number, bg: number): Cell => ({ ch, style: 0, fg, bg, font: 1 });
  const screen = {
    grid: [[colored("X", 8, 1), colored("Y", 1, 3)]], // X cyan-on-default, Y default-on-red
    height: 1,
    lowerCursor: { row: 0, col: 0 },
  } as unknown as Screen;

  // cyan fg = 30+(8-2)=36; red bg = 40+(3-2)=41
  expect(renderFrame(screen)).toBe(`${E}[1;1H${E}[0;36mX${E}[0;41mY${E}[0m${E}[1;1H`);
});

test("renderFrame maps font-3 codes to Unicode glyphs", () => {
  const E = "\x1b";
  const f3 = (code: number): Cell => ({
    ch: String.fromCharCode(code),
    style: 0,
    fg: 1,
    bg: 1,
    font: 3,
  });
  const screen = {
    grid: [[f3(92), f3(93)]], // up arrow, down arrow
    height: 1,
    lowerCursor: { row: 0, col: 0 },
  } as unknown as Screen;

  expect(renderFrame(screen)).toBe(`${E}[1;1H${E}[0m↑↓${E}[0m${E}[1;1H`);
});

test("renderFrame emits bold and italic SGR codes", () => {
  const E = "\x1b";
  const styled = (ch: string, style: number): Cell => ({ ch, style, fg: 1, bg: 1, font: 1 });
  const screen = {
    grid: [[styled("Z", TextStyle.Bold | TextStyle.Italic)]],
    height: 1,
    lowerCursor: { row: 0, col: 0 },
  } as unknown as Screen;

  expect(renderFrame(screen)).toBe(`${E}[1;1H${E}[0;1;3mZ${E}[0m${E}[1;1H`);
});

// --- installHostCallbacks --------------------------------------------------

/** A minimal Machine stand-in: just the slots installHostCallbacks writes to. */
function hostMachine(): Machine {
  return { screen: { upperHeight: 0 } } as unknown as Machine;
}

test("installHostCallbacks: onOutput is a no-op (the grid is the display)", () => {
  const out = captureStdout();
  const machine = hostMachine();

  installHostCallbacks(machine, "save.qzl");
  machine.onOutput("hello");

  expect(out.text()).toBe(""); // nothing goes straight to stdout in curses mode
});

test("installHostCallbacks: onScreenRefresh is a no-op (frames render at settle points)", () => {
  const out = captureStdout();
  const machine = hostMachine();

  installHostCallbacks(machine, "save.qzl");

  expect(() => machine.onScreenRefresh()).not.toThrow();
  expect(out.text()).toBe("");
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

test("installHostCallbacks: onClearScreen is a no-op (erase_window clears the grid instead)", () => {
  const out = captureStdout();
  const machine = hostMachine();

  installHostCallbacks(machine, "save.qzl");
  machine.onClearScreen();

  expect(out.text()).toBe("");
});

// --- deliverInput ----------------------------------------------------------

test("deliverInput reads a line, echoes it into the grid, and provides it", () => {
  vi.mocked(readLineSync).mockReturnValue("go north");
  const provideInput = vi.fn();
  const print = vi.fn();
  const machine = {
    awaitingCharInput: false,
    provideInput,
    screen: { print },
  } as unknown as Machine;

  expect(deliverInput(machine)).toBe(true);
  expect(print).toHaveBeenCalledWith("go north\n"); // echoed into the lower window
  expect(provideInput).toHaveBeenCalledWith("go north");
});

test("deliverInput returns false at end of input (line)", () => {
  vi.mocked(readLineSync).mockReturnValue(null);
  const machine = { awaitingCharInput: false, provideInput: vi.fn() } as unknown as Machine;

  expect(deliverInput(machine)).toBe(false);
});

test("deliverInput reads a single key (read_char) and provides its ZSCII code", () => {
  vi.mocked(readKeySync).mockReturnValue(129); // up arrow, decoded from an escape sequence
  const provideKey = vi.fn();
  const machine = { awaitingCharInput: true, provideKey } as unknown as Machine;

  expect(deliverInput(machine)).toBe(true);
  expect(provideKey).toHaveBeenCalledWith(129);
});

test("deliverInput returns false at end of input (read_char)", () => {
  vi.mocked(readKeySync).mockReturnValue(null);
  const machine = { awaitingCharInput: true, provideKey: vi.fn() } as unknown as Machine;

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

test("main loads the story, wires it up, and runs it on the alternate screen (TTY)", async () => {
  process.argv = ["node", "quendor", "game.z3"];
  const out = captureStdout();
  vi.mocked(loadStoryFromFile).mockResolvedValue(quitStory());

  const isTTYDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

  try {
    await main();

    expect(loadStoryFromFile).toHaveBeenCalledWith("game.z3");
    expect(process.exitCode).toBeUndefined();
    expect(out.text()).toContain("\x1b[?1049h"); // entered the alternate screen
    expect(out.text()).toContain("\x1b[?1049l"); // ...and left it cleanly on exit
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
  const machine = {
    run,
    provideInput,
    awaitingCharInput: false,
    screen: { print: vi.fn(), onMore: (): void => {} },
  } as unknown as Machine;

  runTerminalLoop(machine);

  expect(provideInput).toHaveBeenCalledWith("look");
  expect(run).toHaveBeenCalledTimes(2);
});

test("runTerminalLoop stops at end of input", () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(readLineSync).mockReturnValue(null); // EOF

  const run = vi.fn().mockReturnValue(RunState.WaitingForInput);
  const machine = {
    run,
    provideInput: vi.fn(),
    awaitingCharInput: false,
    screen: { print: vi.fn(), onMore: (): void => {} },
  } as unknown as Machine;

  runTerminalLoop(machine);

  expect(run).toHaveBeenCalledTimes(1);
});

test("runTerminalLoop enters/leaves the alternate screen and renders the grid on a TTY", () => {
  const out = captureStdout();
  const isTTYDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

  const run = vi.fn().mockReturnValue(RunState.Halted);
  const machine = {
    run,
    provideInput: vi.fn(),
    awaitingCharInput: false,
    screen: {
      grid: [[{ ch: "H", style: 0, fg: 1, bg: 1 }]],
      height: 1,
      lowerCursor: { row: 0, col: 0 },
    },
  } as unknown as Machine;

  try {
    runTerminalLoop(machine);
    const text = out.text();

    expect(text).toContain("\x1b[?1049h"); // entered the alternate screen
    expect(text).toContain("H"); // rendered the grid cell
    expect(text).toContain("\x1b[?1049l"); // left the alternate screen on exit
  } finally {
    Object.defineProperty(
      process.stdout,
      "isTTY",
      isTTYDesc ?? { value: undefined, configurable: true },
    );
  }
});

test("runTerminalLoop shows [More] and pages forward on a 'more' yield (TTY)", () => {
  const out = captureStdout();
  const isTTYDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  vi.mocked(readKeySync).mockReturnValue(32); // the key that pages forward

  const continueFromMore = vi.fn();
  const run = vi
    .fn()
    .mockReturnValueOnce(RunState.WaitingForInput) // a [More] yield
    .mockReturnValueOnce(RunState.Halted);
  const machine = {
    run,
    provideInput: vi.fn(),
    awaitingCharInput: false,
    pendingInputKind: "more",
    continueFromMore,
    screen: {
      grid: [[{ ch: "X", style: 0, fg: 1, bg: 1 }]],
      height: 1,
      lowerCursor: { row: 0, col: 0 },
    },
  } as unknown as Machine;

  try {
    runTerminalLoop(machine);

    expect(out.text()).toContain("[More]"); // the prompt was drawn
    expect(readKeySync).toHaveBeenCalled(); // it waited for a key
    expect(continueFromMore).toHaveBeenCalled(); // then paged forward
  } finally {
    Object.defineProperty(
      process.stdout,
      "isTTY",
      isTTYDesc ?? { value: undefined, configurable: true },
    );
  }
});

test("runAcceptance auto-pages a [More] yield without consuming a command", () => {
  // run() sequence: a [More] yield, then a read prompt, then halt.
  const states = [RunState.WaitingForInput, RunState.WaitingForInput, RunState.Halted];
  const kinds = ["more", "line", "line"];
  let i = -1;

  const continueFromMore = vi.fn();
  const provideInput = vi.fn();
  const machine = {
    onOutput: (): void => {},
    awaitingCharInput: false,
    continueFromMore,
    provideInput,
    provideKey: vi.fn(),
    get pendingInputKind(): string {
      return kinds[i];
    },
    run(): RunState {
      i++;
      return states[i];
    },
  } as unknown as Machine;

  const result = runAcceptance(machine, ["look"]);

  expect(continueFromMore).toHaveBeenCalledTimes(1); // the [More] paged, not fed a command
  expect(provideInput).toHaveBeenCalledWith("look"); // the command went to the read, not the pause
  expect(result.commandsUsed).toBe(1);
});

test("runTerminalLoop pages a [More] yield without drawing the prompt off a TTY", () => {
  const out = captureStdout(); // isTTY unset -> not a TTY
  vi.mocked(readKeySync).mockReturnValue(32);

  const continueFromMore = vi.fn();
  const run = vi
    .fn()
    .mockReturnValueOnce(RunState.WaitingForInput)
    .mockReturnValueOnce(RunState.Halted);
  const machine = {
    run,
    provideInput: vi.fn(),
    awaitingCharInput: false,
    pendingInputKind: "more",
    continueFromMore,
    screen: { grid: [], height: 1, lowerCursor: { row: 0, col: 0 } },
  } as unknown as Machine;

  runTerminalLoop(machine);

  expect(out.text()).not.toContain("[More]"); // no prompt off a TTY
  expect(continueFromMore).toHaveBeenCalled(); // but it still pages forward
});

// --- acceptance mode (--accept) --------------------------------------------

test("--accept and --oracle consume their file arguments", () => {
  expect(parseArgs(["--accept", "sol.txt", "--oracle", "gold.txt", "game.z3"])).toEqual({
    help: false,
    path: "game.z3",
    accept: "sol.txt",
    oracle: "gold.txt",
  });
});

test("parseSolution keeps commands and drops blank lines and # comments", () => {
  const text = "# walkthrough\nopen mailbox\n\n  read leaflet  \n# done\nn";

  expect(parseSolution(text)).toEqual(["open mailbox", "read leaflet", "n"]);
});

test("parseSolution handles CRLF line endings", () => {
  expect(parseSolution("look\r\nnorth\r\n")).toEqual(["look", "north"]);
});

test("solutionKey maps named keys (case-insensitively) and falls back to the first character", () => {
  expect(solutionKey("SPACE")).toBe(32);
  expect(solutionKey("return")).toBe(13);
  expect(solutionKey("UP")).toBe(129);
  expect(solutionKey("y")).toBe("y".charCodeAt(0));
});

// A fake game whose run() emits the next scripted output chunk (through the
// onOutput the harness installs), then blocks for input until the chunks run out.
function scriptedMachine(
  chunks: string[],
  opts: { char?: boolean } = {},
): {
  machine: Machine;
  inputs: string[];
  keys: number[];
} {
  const inputs: string[] = [];
  const keys: number[] = [];
  let turn = 0;

  const machine = {
    onOutput: (_t: string): void => {},
    awaitingCharInput: opts.char ?? false,
    run(): RunState {
      machine.onOutput(chunks.at(turn) ?? "");
      turn++;
      return turn < chunks.length ? RunState.WaitingForInput : RunState.Halted;
    },
    provideInput: (line: string): void => {
      inputs.push(line);
    },
    provideKey: (code: number): void => {
      keys.push(code);
    },
  } as unknown as Machine;

  return { machine, inputs, keys };
}

test("runAcceptance interleaves game output with the commands it feeds, and reports the halt", () => {
  const { machine, inputs } = scriptedMachine(["Room\n>", "You look.\n>", "Bye\n"]);

  const result = runAcceptance(machine, ["look", "north"]);

  expect(inputs).toEqual(["look", "north"]);
  expect(result.outcome).toBe("halted");
  expect(result.commandsUsed).toBe(2);
  expect(result.transcript).toBe("Room\n>look\nYou look.\n>north\nBye\n");
});

test("runAcceptance delivers a read_char prompt as a keystroke via provideKey", () => {
  const { machine, inputs, keys } = scriptedMachine(["Press a key.\n", "Done\n"], { char: true });

  runAcceptance(machine, ["SPACE"]);

  expect(keys).toEqual([32]); // SPACE -> ZSCII 32, not a line
  expect(inputs).toEqual([]);
});

test("runAcceptance reports 'exhausted' when the solution runs out before the game ends", () => {
  const machine = {
    onOutput: (): void => {},
    awaitingCharInput: false,
    run: (): RunState => RunState.WaitingForInput, // always wants more input
    provideInput: vi.fn(),
    provideKey: vi.fn(),
  } as unknown as Machine;

  const result = runAcceptance(machine, ["look"]);

  expect(result.outcome).toBe("exhausted");
  expect(result.commandsUsed).toBe(1);
});

test("runAcceptance captures a runtime error thrown mid-playthrough", () => {
  const machine = {
    onOutput: (): void => {},
    awaitingCharInput: false,
    run: (): RunState => {
      throw new Error("Unknown opcode");
    },
    provideInput: vi.fn(),
    provideKey: vi.fn(),
  } as unknown as Machine;

  const result = runAcceptance(machine, ["look"]);

  expect(result.outcome).toBe("error");
  expect(result.error).toContain("Unknown opcode");
});

/** A v3 story that reads one line and quits — enough to exercise the real read/echo/halt path. */
function readingStory(): Story {
  const bytes = new Uint8Array(0x100);
  const MAIN = 0x40;
  const DICT = 0xc0;
  const TEXTBUF = 0x80;
  const PARSEBUF = 0xa0;

  bytes[HeaderOffset.Version] = 3;
  bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
  bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
  bytes[HeaderOffset.DictionaryAddress] = (DICT >> 8) & 0xff;
  bytes[HeaderOffset.DictionaryAddress + 1] = DICT & 0xff;
  bytes.set([0xe4, 0x5f, TEXTBUF, PARSEBUF, 0xba], MAIN); // sread TEXTBUF PARSEBUF ; quit
  bytes[TEXTBUF] = 20; // max input length
  bytes[PARSEBUF] = 5; // max parsed words
  bytes[DICT + 1] = 4; // entry length (0 separators, 0 entries)

  return new Story(bytes);
}

test("runAcceptance plays a real reading story, echoing the command and halting", () => {
  const result = runAcceptance(new Machine(readingStory()), ["go"]);

  expect(result.outcome).toBe("halted");
  expect(result.commandsUsed).toBe(1);
  expect(result.transcript).toBe("go\n"); // the game reads, prints nothing, then quits
});

test("runAcceptanceMode prints the transcript when no oracle is given", () => {
  const out = captureStdout();
  vi.mocked(readFileSync).mockReturnValue("go");

  runAcceptanceMode(readingStory(), "solution.txt", undefined, undefined);

  expect(out.text()).toBe("go\n");
});

test("runAcceptanceMode reports a match when the transcript equals the oracle", () => {
  process.exitCode = undefined;
  const out = captureStdout();
  vi.mocked(readFileSync)
    .mockReturnValueOnce("go") // solution
    .mockReturnValueOnce("go\n"); // oracle

  runAcceptanceMode(readingStory(), "solution.txt", "oracle.txt", undefined);

  expect(out.text()).toContain("matches the oracle");
  expect(process.exitCode).toBeUndefined();
});

test("runAcceptanceMode reports a divergence and fails when the transcript differs from the oracle", () => {
  process.exitCode = undefined;
  const out = captureStdout();
  vi.mocked(readFileSync)
    .mockReturnValueOnce("go") // solution
    .mockReturnValueOnce("different\n"); // oracle

  runAcceptanceMode(readingStory(), "solution.txt", "oracle.txt", undefined);

  expect(out.text()).toContain("diverges from the oracle");
  expect(process.exitCode).toBe(1);

  process.exitCode = undefined; // don't leak the failure code into later tests
});

test("runAcceptanceMode warns and fails when the solution runs out before the game ends", () => {
  process.exitCode = undefined;
  captureStdout();
  const errWrite = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue("# no commands");

  runAcceptanceMode(readingStory(), "solution.txt", undefined, undefined);

  const errText = errWrite.mock.calls.map((c) => String(c[0])).join("");
  expect(errText).toContain("ran out");
  expect(process.exitCode).toBe(1);

  process.exitCode = undefined;
});

/** A story whose initial PC lands on a 0x00 byte, which decodes to an unregistered 2OP:0x00. */
function erroringStory(): Story {
  const bytes = new Uint8Array(0x100);

  bytes[HeaderOffset.Version] = 3;
  bytes[HeaderOffset.InitialProgramCounter] = 0x00;
  bytes[HeaderOffset.InitialProgramCounter + 1] = 0x40; // PC = 0x40, which holds 0x00

  return new Story(bytes);
}

test("runAcceptanceMode reports a runtime error and fails when an opcode throws", () => {
  process.exitCode = undefined;
  captureStdout();
  const errWrite = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue("go");

  runAcceptanceMode(erroringStory(), "solution.txt", undefined, undefined);

  const errText = errWrite.mock.calls.map((c) => String(c[0])).join("");
  expect(errText).toContain("runtime error");
  expect(process.exitCode).toBe(1);

  process.exitCode = undefined;
});

test("main dispatches to acceptance mode when --accept is given", async () => {
  process.argv = ["node", "quendor", "--accept", "sol.txt", "game.z3"];
  const out = captureStdout();
  vi.mocked(loadStoryFromFile).mockResolvedValue(readingStory());
  vi.mocked(readFileSync).mockReturnValue("go");

  await main();

  expect(out.text()).toBe("go\n");
});

test("the oracle diff reports the transcript ending early when expected output is missing", () => {
  process.exitCode = undefined;
  const out = captureStdout();
  vi.mocked(readFileSync)
    .mockReturnValueOnce("go") // solution -> transcript "go\n" (lines: "go", "")
    .mockReturnValueOnce("go\n\n"); // oracle has an extra blank line

  runAcceptanceMode(readingStory(), "solution.txt", "oracle.txt", undefined);

  const text = out.text();
  expect(text).toContain("at line 3"); // first two lines matched
  expect(text).toContain("<end of transcript>"); // the transcript ran out first
  expect(process.exitCode).toBe(1);

  process.exitCode = undefined;
});

test("the oracle diff reports the oracle ending early when there is extra output", () => {
  process.exitCode = undefined;
  const out = captureStdout();
  vi.mocked(readFileSync)
    .mockReturnValueOnce("go") // solution -> transcript "go\n" (lines: "go", "")
    .mockReturnValueOnce("go"); // oracle has only one line

  runAcceptanceMode(readingStory(), "solution.txt", "oracle.txt", undefined);

  const text = out.text();
  expect(text).toContain("at line 2");
  expect(text).toContain("<end of transcript>"); // the oracle ran out first
  expect(process.exitCode).toBe(1);

  process.exitCode = undefined;
});
