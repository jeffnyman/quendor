import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

  // Persist saves next to the story (a single slot).
  const savePath = parsed.path + ".sav";

  machine.onSave = (data): boolean => {
    try {
      writeFileSync(savePath, data);
      return true;
    } catch {
      return false;
    }
  };

  machine.onRestore = (): Uint8Array | null => {
    try {
      return existsSync(savePath) ? new Uint8Array(readFileSync(savePath)) : null;
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
