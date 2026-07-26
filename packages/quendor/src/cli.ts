import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { Machine, RunState } from "./machine.ts";
import { loadStoryFromFile, readCharSync, readLineSync } from "./node.ts";
import { type Cell, TextStyle } from "./screen.ts";
import type { Story } from "./story.ts";

const USAGE = `quendor — a terminal Z-Machine interpreter

Usage:
  quendor <story-file>

  <story-file>             a Z-code game (.z1-.z5)
  --seed N                 fix the RNG seed (reproducible playthroughs)
  --tandy                  set the v1-3 "Tandy" flag
  --interpreter N          set the interpreter number (default 6 = IBM PC)
  --interpreter-version C  set the interpreter version letter (default A)
  --accept FILE            play a solution file (one command per line) and print the transcript
  --oracle FILE            with --accept, diff the transcript against a saved golden transcript

  Save/restore prompt for a filename, defaulting to the story name + ".qzl".
`;

interface ParsedArgs {
  help: boolean;
  path?: string;
  seed?: number;
  tandy?: boolean;
  interpreterNumber?: number;
  interpreterVersion?: number;
  accept?: string;
  oracle?: string;
}

/** Parse an integer argument, yielding undefined for a non-numeric value. */
function intArg(value: string): number | undefined {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

export function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { help: false };

  // Flags that consume the following argument, keyed by name. Adding an option
  // is a new entry here, not another branch in the loop below.
  const withValue: Record<string, (value: string) => void> = {
    "--seed": (v): void => {
      const n = intArg(v);
      if (n !== undefined) parsed.seed = n;
    },
    "--interpreter": (v): void => {
      const n = intArg(v);
      if (n !== undefined) parsed.interpreterNumber = n;
    },
    "--interpreter-version": (v): void => {
      const c = v.charCodeAt(0); // version is a byte, conventionally a letter
      if (!Number.isNaN(c)) parsed.interpreterVersion = c;
    },
    "--accept": (v): void => {
      parsed.accept = v;
    },
    "--oracle": (v): void => {
      parsed.oracle = v;
    },
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];

    if (a === "--help" || a === "-h")
      return { help: true }; // short-circuits
    else if (a === "--tandy") parsed.tandy = true;
    else if (a in withValue && i + 1 < args.length) withValue[a](args[++i]);
    else if (!a.startsWith("-")) parsed.path ??= a;
  }

  return parsed;
}

/** Default save filename derived from the story: base name, no directory, no extension. */
export function defaultSaveName(storyPath: string): string {
  return basename(storyPath, extname(storyPath)) + ".qzl";
}

/** Prompt (Frotz-style) for a save/restore filename; empty input takes the default. */
export function promptForSaveFile(def: string): string {
  process.stdout.write(`Enter a file name.\nDefault is "${def}": `);

  const line = readLineSync();
  const name = (line ?? "").trim();

  return name.length > 0 ? name : def;
}

// --- terminal status bar (v4+ upper window) --------------------------------

const ESC = "\x1b";

/** Reserve the top `height` rows with a DECSTBM scroll region (0 resets to full screen). */
export function setScrollRegion(height: number): void {
  const rows = process.stdout.rows;

  if (height > 0 && rows) {
    // Setting the region homes the cursor as a side effect, so wrap it in
    // save (ESC 7) / restore (ESC 8) to leave the cursor where the transcript
    // left it — right after the prompt — instead of moving it.
    process.stdout.write(`${ESC}7${ESC}[${height + 1};${rows}r${ESC}8`);
  } else {
    process.stdout.write(`${ESC}[r`); // reset to the full screen
  }
}

/**
 * Redraw the upper window at the top of the screen, preserving the cursor.
 * Each cell is drawn in reverse video only if the game set that style on it, so
 * a full-width reverse row renders a status bar while a game that writes reverse
 * cells over just part of a row (leaving the margins untouched) renders a
 * centered quote box. Adjacent same-style cells are coalesced into one run to
 * keep the escape output compact.
 */
export function drawUpperWindow(grid: Cell[][]): void {
  process.stdout.write(`${ESC}7`); // save cursor
  grid.forEach((row, r) => {
    let line = `${ESC}[${r + 1};1H${ESC}[0m`;
    let reverse = false;

    for (const cell of row) {
      const wantReverse = (cell.style & TextStyle.Reverse) !== 0;

      if (wantReverse !== reverse) {
        line += wantReverse ? `${ESC}[7m` : `${ESC}[0m`;
        reverse = wantReverse;
      }

      line += cell.ch;
    }

    process.stdout.write(`${line}${ESC}[0m`);
  });
  process.stdout.write(`${ESC}8`); // restore cursor
}

/**
 * Wire the machine's host callbacks to the terminal: text output, screen
 * clears, the sound bell, and the save/restore file prompts.
 */
export function installHostCallbacks(machine: Machine, defaultSave: string): void {
  machine.onOutput = (text): void => {
    process.stdout.write(text);
  };

  // Fired by erase_window on the lower window. Clear from the first lower-window
  // row to the end of screen, leaving any status bar above it intact. (For
  // erase_window -1, Screen resets upperHeight to 0 first, so this clears all.)
  machine.onClearScreen = (): void => {
    if (!process.stdout.isTTY) return;
    process.stdout.write(`${ESC}[${machine.screen.upperHeight + 1};1H${ESC}[J`);
  };

  // sound_effect: bleeps (1 = high, 2 = low) map to the terminal bell; sampled
  // sounds (3+) need audio we don't have yet (Blorb pending), so ignore them.
  machine.onSoundEffect = (number): void => {
    if (number === 1 || number === 2) process.stdout.write("\x07");
  };

  // Frotz-style: prompt for a filename on each save/restore, defaulting to the
  // story's base name. The prompt is synchronous like the main input loop —
  // save/restore are synchronous opcodes, so blocking on input here is fine.
  machine.onSave = (data): boolean => {
    const file = promptForSaveFile(defaultSave);

    try {
      writeFileSync(file, data);
      return true;
    } catch {
      return false;
    }
  };

  machine.onRestore = (): Uint8Array | null => {
    const file = promptForSaveFile(defaultSave);

    try {
      return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
    } catch {
      return null;
    }
  };
}

/**
 * Deliver whatever input the machine is waiting for: a single keystroke (any
 * key) for read_char, or a line for sread/aread. Returns false at end of input.
 */
export function deliverInput(machine: Machine): boolean {
  if (machine.awaitingCharInput) {
    const ch = readCharSync();
    if (ch === null) return false;
    machine.provideChar(ch);
  } else {
    const line = readLineSync();
    if (line === null) return false;
    machine.provideInput(line);
  }

  return true;
}

/**
 * Run the fetch/prompt loop until the machine halts or input ends. The v4+
 * upper window (a status line, or a transient quote box) is repainted both at
 * each prompt and mid-run via onScreenRefresh — a quote box is drawn and torn
 * down between prompts, so the prompt-time paint alone would never catch it
 * (repaints are idempotent). Leaves the terminal clean on exit.
 */
export function runTerminalLoop(machine: Machine): void {
  let statusHeight = 0;

  const refreshUpperWindow = (): void => {
    if (!process.stdout.isTTY) return;

    if (machine.screen.upperHeight !== statusHeight) {
      statusHeight = machine.screen.upperHeight;
      setScrollRegion(statusHeight);
    }

    if (statusHeight > 0) drawUpperWindow(machine.screen.upper);
  };
  machine.onScreenRefresh = refreshUpperWindow;

  for (;;) {
    const state = machine.run();

    if (state !== RunState.WaitingForInput) break; // halted

    refreshUpperWindow();

    if (!deliverInput(machine)) break; // end of input
  }

  // Leave the terminal clean. Reset the scroll region unconditionally (a no-op
  // if none was set) so a stray margin can't leave the console scroll-locked,
  // and erase the reserved status rows so the bar doesn't ghost in the
  // scrollback. Wrapped in save (ESC 7) / restore (ESC 8): ESC[r and the erases
  // move the cursor, but we want the shell prompt to resume where the game left
  // off — below the transcript, not jumped to the top.
  if (process.stdout.isTTY) {
    let cleanup = `${ESC}7${ESC}[r`; // save cursor, reset the scroll region to full screen

    for (let row = 1; row <= statusHeight; row++) {
      cleanup += `${ESC}[${row};1H${ESC}[0m${ESC}[2K`; // home to each frozen status row and erase it
    }

    cleanup += `${ESC}8`; // restore the cursor to the transcript

    process.stdout.write(cleanup);
  }
}

// --- acceptance mode (--accept) --------------------------------------------
//
// Non-interactively replay a "solution" file — one command per line — through a
// game and capture the transcript. quendor's RNG is deterministic (seeded), so a
// given solution + seed produces a byte-stable transcript, which can be frozen
// as a golden "oracle" and diffed against on later runs. Screen chrome (status
// bar, clears, sound) is intentionally excluded: the transcript is lower-window
// text only, matching a real script capture.

/** ZSCII codes for the named keys a solution can use at a read_char prompt. */
const NAMED_KEYS = new Map<string, number>([
  ["SPACE", 32],
  ["RETURN", 13],
  ["ENTER", 13],
  ["ESC", 27],
  ["ESCAPE", 27],
  ["UP", 129],
  ["DOWN", 130],
  ["LEFT", 131],
  ["RIGHT", 132],
]);

/** Parse a solution file into commands: one per line, trimmed, dropping blanks and `#` comments. */
export function parseSolution(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/** The ZSCII key a read_char solution token stands for: a named key, or its first character. */
export function solutionKey(token: string): number {
  return NAMED_KEYS.get(token.toUpperCase()) ?? token.charCodeAt(0);
}

export interface AcceptanceResult {
  /** The interleaved transcript: game output with each fed command echoed inline. */
  transcript: string;
  /** How the run ended: the game halted, the solution ran out, or an opcode threw. */
  outcome: "halted" | "exhausted" | "error";
  /** The message when `outcome` is "error", otherwise empty. */
  error: string;
  commandsUsed: number;
}

/** Replay `commands` through `machine`, echoing each into the captured transcript. */
export function runAcceptance(machine: Machine, commands: string[]): AcceptanceResult {
  let transcript = "";
  machine.onOutput = (text): void => {
    transcript += text;
  };

  let used = 0;
  let outcome: AcceptanceResult["outcome"] = "halted";
  let error = "";

  try {
    for (;;) {
      const state = machine.run();

      if (state !== RunState.WaitingForInput) break; // the game halted

      if (used >= commands.length) {
        outcome = "exhausted";
        break;
      }

      const command = commands[used++];
      transcript += command + "\n"; // echo, terminal-style, right after the game's prompt

      if (machine.awaitingCharInput) {
        machine.provideKey(solutionKey(command));
      } else {
        machine.provideInput(command);
      }
    }
  } catch (err) {
    outcome = "error";
    // The machine throws Error objects; the String(err) fallback is defensive.
    /* v8 ignore next -- @preserve */
    error = err instanceof Error ? err.message : String(err);
  }

  return { transcript, outcome, error, commandsUsed: used };
}

/** Describe the first line where the transcript diverges from the oracle. */
function describeDiff(expected: string, actual: string): string {
  const exp = expected.split("\n");
  const act = actual.split("\n");
  const lines = Math.max(exp.length, act.length);

  for (let i = 0; i < lines; i++) {
    const e = exp.at(i);
    const a = act.at(i);

    if (e !== a) {
      return (
        `acceptance: transcript diverges from the oracle at line ${i + 1}\n` +
        `  expected: ${JSON.stringify(e ?? "<end of transcript>")}\n` +
        `  actual:   ${JSON.stringify(a ?? "<end of transcript>")}\n`
      );
    }
  }

  // Unreachable: describeDiff is only called when the strings differ, and any
  // difference (content or length) is caught line-by-line above. Kept for the
  // return type.
  /* v8 ignore next -- @preserve */
  return "acceptance: transcripts differ only in trailing content\n";
}

/** Run a solution against `story`, printing the transcript or diffing it against an oracle. */
export function runAcceptanceMode(
  story: Story,
  solutionPath: string,
  oraclePath: string | undefined,
  seed: number | undefined,
): void {
  const commands = parseSolution(readFileSync(solutionPath, "utf8"));
  const machine = new Machine(story, {
    randomSeed: seed,
    screenWidth: 80, // fixed width => reproducible wrapping, independent of the terminal
  });

  const result = runAcceptance(machine, commands);

  if (oraclePath === undefined) {
    process.stdout.write(result.transcript);
  } else {
    const expected = readFileSync(oraclePath, "utf8");

    if (result.transcript === expected) {
      process.stdout.write(
        `acceptance: transcript matches the oracle (${result.commandsUsed} commands)\n`,
      );
    } else {
      process.stdout.write(describeDiff(expected, result.transcript));
      process.exitCode = 1;
    }
  }

  if (result.outcome === "error") {
    process.stderr.write(
      `acceptance: runtime error after ${result.commandsUsed} command(s): ${result.error}\n`,
    );
    process.exitCode = 1;
  } else if (result.outcome === "exhausted") {
    process.stderr.write(
      `acceptance: solution ran out after ${result.commandsUsed} command(s) with the game still running\n`,
    );
    process.exitCode = 1;
  }
}

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  if (!parsed.path) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const story = await loadStoryFromFile(parsed.path);

  if (parsed.accept !== undefined) {
    runAcceptanceMode(story, parsed.accept, parsed.oracle, parsed.seed);
    return;
  }

  const machine = new Machine(story, {
    randomSeed: parsed.seed,
    tandy: parsed.tandy,
    interpreterNumber: parsed.interpreterNumber,
    interpreterVersion: parsed.interpreterVersion,
    screenWidth: process.stdout.columns, // undefined off a TTY -> engine default (80)
    screenHeight: process.stdout.rows,
  });

  installHostCallbacks(machine, defaultSaveName(parsed.path));

  // Start on a fresh screen (Std §8: clear on start) so the game isn't drawn
  // over prior terminal output. TTY only, so piped output stays clean.
  if (process.stdout.isTTY) {
    process.stdout.write(`${ESC}[2J${ESC}[H`);
  }

  runTerminalLoop(machine);
}
