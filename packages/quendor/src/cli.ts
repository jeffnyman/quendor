import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { Machine, RunState } from "./machine.ts";
import { loadStoryFromFile, readKeySync, readLineSync } from "./node.ts";
import { type Cell, type Screen, TextStyle } from "./screen.ts";
import { font3Char } from "./font3.ts";
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

// --- curses-style screen renderer ------------------------------------------

const ESC = "\x1b";

/**
 * A full-frame redraw of the screen grid to the terminal: each row positioned and
 * written with reverse-video runs coalesced, then the hardware cursor parked at the
 * lower window's cursor (where input echoes). quendor owns the whole screen, so
 * this replaces the old status-bar overlay entirely. See docs/screen-model.md.
 */
/**
 * The ANSI SGR sequence for a cell's attributes: a reset, then bold/italic/reverse
 * and any foreground/background colour. Z-Machine colours 2-9 map to the eight
 * basic ANSI colours (2=black … 9=white); colour 1 ("default") emits nothing.
 */
function sgr(cell: Cell): string {
  const codes = [0];

  if (cell.style & TextStyle.Bold) codes.push(1);
  if (cell.style & TextStyle.Italic) codes.push(3);
  if (cell.style & TextStyle.Reverse) codes.push(7);
  if (cell.fg >= 2 && cell.fg <= 9) codes.push(28 + cell.fg); // 30 + (fg - 2)
  if (cell.bg >= 2 && cell.bg <= 9) codes.push(38 + cell.bg); // 40 + (bg - 2)

  return `${ESC}[${codes.join(";")}m`;
}

export function renderFrame(screen: Screen): string {
  let out = "";

  screen.grid.forEach((row, r) => {
    out += `${ESC}[${r + 1};1H`; // home to the row start
    let lastSgr = "";

    for (const cell of row) {
      const s = sgr(cell);
      if (s !== lastSgr) {
        out += s;
        lastSgr = s;
      }

      // Font 3 is the character-graphics font: map its codes to Unicode glyphs.
      out += cell.font === 3 ? font3Char(cell.ch.charCodeAt(0)) : cell.ch;
    }

    out += `${ESC}[0m`;
  });

  const { row, col } = screen.lowerCursor;
  out += `${ESC}[${row + 1};${col + 1}H`; // park the cursor for input (1-based)

  return out;
}

/** Draw the `[More]` prompt on the bottom line of the screen (reverse video). */
function drawMore(screen: Screen): string {
  return `${ESC}[${screen.height};1H${ESC}[7m[More]${ESC}[0m`;
}

/**
 * Wire the machine's host callbacks for interactive play. Output and screen
 * clears land on the grid (drawn by renderFrame), not straight to the terminal,
 * so onOutput and onClearScreen are intentionally quiet; frames are drawn at each
 * settle point rather than per opcode. The sound bell and the save/restore file
 * prompts remain.
 */
export function installHostCallbacks(machine: Machine, defaultSave: string): void {
  machine.onOutput = (): void => {}; // the grid is the display; onOutput is only for transcripts
  machine.onClearScreen = (): void => {}; // erase_window clears the grid; the next frame shows it
  machine.onScreenRefresh = (): void => {}; // rendered at settle points, not on every screen op

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
 * Deliver whatever input the machine is waiting for: a single keystroke for
 * read_char, or a line for sread/aread. A line is echoed into the lower window so
 * the player's typing becomes part of the scrolling transcript (quendor does not
 * echo reads itself). Returns false at end of input.
 */
export function deliverInput(machine: Machine): boolean {
  if (machine.awaitingCharInput) {
    const code = readKeySync(); // arrow-aware: decodes escape sequences to ZSCII 129-132
    if (code === null) return false;
    machine.provideKey(code);
  } else {
    const line = readLineSync();
    if (line === null) return false;
    machine.screen.print(line + "\n"); // echo into the grid before the game responds
    machine.provideInput(line);
  }

  return true;
}

/**
 * Run the fetch/prompt loop until the machine halts or input ends, redrawing the
 * screen grid after each step. On a TTY it runs on the alternate screen buffer, so
 * entering and leaving restores the console cleanly — no scrollback ghosts, no
 * lingering scroll region.
 */
export function runTerminalLoop(machine: Machine): void {
  const tty = process.stdout.isTTY === true;

  if (tty) process.stdout.write(`${ESC}[?1049h${ESC}[2J`); // enter the alternate screen

  for (;;) {
    const state = machine.run();

    if (tty) process.stdout.write(renderFrame(machine.screen));

    if (state !== RunState.WaitingForInput) break; // halted

    if (machine.pendingInputKind === "more") {
      if (tty) process.stdout.write(drawMore(machine.screen));
      readKeySync(); // any key pages forward (consumes a whole escape sequence)
      machine.continueFromMore();
      continue;
    }

    if (!deliverInput(machine)) break; // end of input
  }

  if (tty) process.stdout.write(`${ESC}[?1049l`); // leave the alternate screen
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

      if (machine.pendingInputKind === "more") {
        machine.continueFromMore(); // a scripted run pages straight through, no key consumed
        continue;
      }

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
  runTerminalLoop(machine); // enters/leaves the alternate screen and clears it itself
}
