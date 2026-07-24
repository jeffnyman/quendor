import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { Machine, RunState } from "./machine.ts";
import { loadStoryFromFile, readLineSync } from "./node.ts";

const USAGE = `quendor — a terminal Z-Machine interpreter

Usage:
  quendor <story-file>

  <story-file>             a Z-code game (.z1-.z4)
  --seed N                 fix the RNG seed (reproducible playthroughs)
  --tandy                  set the v1-3 "Tandy" flag
  --interpreter N          set the interpreter number (default 6 = IBM PC)
  --interpreter-version C  set the interpreter version letter (default A)

  Save/restore prompt for a filename, defaulting to the story name + ".qzl".
`;

interface ParsedArgs {
  help: boolean;
  path?: string;
  seed?: number;
  tandy?: boolean;
  interpreterNumber?: number;
  interpreterVersion?: number;
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
function setScrollRegion(height: number): void {
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

/** Redraw the upper window as a reverse-video bar at the top, preserving the cursor. */
function drawStatusBar(rows: string[]): void {
  const width = process.stdout.columns; // defined: only called under the isTTY guard

  process.stdout.write(`${ESC}7`); // save cursor
  rows.forEach((text, r) => {
    const line = text.padEnd(width).slice(0, width);
    process.stdout.write(`${ESC}[${r + 1};1H${ESC}[7m${line}${ESC}[0m`);
  });
  process.stdout.write(`${ESC}8`); // restore cursor
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
  const machine = new Machine(story, {
    randomSeed: parsed.seed,
    tandy: parsed.tandy,
    interpreterNumber: parsed.interpreterNumber,
    interpreterVersion: parsed.interpreterVersion,
    screenWidth: process.stdout.columns, // undefined off a TTY -> engine default (80)
    screenHeight: process.stdout.rows,
  });

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
  const defaultSave = defaultSaveName(parsed.path);

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

  // Start on a fresh screen (Std §8: clear on start) so the game isn't drawn
  // over prior terminal output. TTY only, so piped output stays clean.
  if (process.stdout.isTTY) {
    process.stdout.write(`${ESC}[2J${ESC}[H`);
  }

  let statusHeight = 0;

  for (;;) {
    const state = machine.run();

    if (state !== RunState.WaitingForInput) break; // halted

    // Redraw the v4+ status line (the upper window) before prompting. TTY only —
    // piped/headless output must stay free of escape codes.
    if (process.stdout.isTTY) {
      if (machine.screen.upperHeight !== statusHeight) {
        statusHeight = machine.screen.upperHeight;
        setScrollRegion(statusHeight);
      }

      if (statusHeight > 0) drawStatusBar(machine.screen.upperRows());
    }

    const line = readLineSync();

    if (line === null) break; // end of input

    machine.provideInput(line);
  }

  // Leave the terminal clean: drop any scroll region we set.
  if (process.stdout.isTTY && statusHeight > 0) {
    process.stdout.write(`${ESC}[r`);
  }
}
