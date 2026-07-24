import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { Machine, RunState } from "./machine.ts";
import { loadStoryFromFile, readLineSync } from "./node.ts";

const USAGE = `quendor — a terminal Z-Machine player

Usage:
  quendor <story-file>

  <story-file>   a Z-code game (.z1-.z8)
  --seed N       fix the RNG seed (reproducible playthroughs)
`;

type ParsedArgs = { help: true } | { help: false; path?: string; seed?: number };

export function parseArgs(args: string[]): ParsedArgs {
  let path: string | undefined;
  let seed: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];

    if (a === "--help" || a === "-h") {
      return { help: true };
    } else if (a === "--seed" && i + 1 < args.length) {
      const n = parseInt(args[++i], 10);
      if (!Number.isNaN(n)) seed = n;
    } else if (!a.startsWith("-")) {
      path ??= a;
    }
  }

  return { help: false, path, seed };
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
  const machine = new Machine(story, { randomSeed: parsed.seed });

  machine.onOutput = (text): void => {
    process.stdout.write(text);
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

  for (;;) {
    const state = machine.run();

    if (state !== RunState.WaitingForInput) break; // halted

    const line = readLineSync();

    if (line === null) break; // end of input

    machine.provideInput(line);
  }
}
