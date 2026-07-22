#!/usr/bin/env node

import { Machine } from "./machine.ts";
import { loadStoryFromFile } from "./node.ts";
import { readSync } from "node:fs";

const USAGE = `quendor — a terminal Z-Machine player

Usage:
  quendor <story-file>

  <story-file>   a Z-code game (.z1-.z8)
`;

type ParsedArgs = { help: true } | { help: false; path?: string };

/** Read one line from stdin synchronously, to fit the tight run loop. Null at EOF. */
function readLineSync(): string | null {
  const buf = Buffer.alloc(1);
  let line = "";
  let sawAny = false;

  for (;;) {
    let n: number;

    try {
      n = readSync(0, buf, 0, 1, null);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EAGAIN") continue;
      break; // EOF or closed stream
    }

    if (n === 0) break; // EOF

    sawAny = true;

    const ch = buf.toString("utf8");

    if (ch === "\n") return line;
    if (ch !== "\r") line += ch;
  }

  return sawAny ? line : null;
}

function parseArgs(args: string[]): ParsedArgs {
  if (args.some((a) => a === "--help" || a === "-h")) {
    return { help: true };
  }

  return { help: false, path: args.find((a) => !a.startsWith("-")) };
}

async function main(): Promise<void> {
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
  const machine = new Machine(story);

  machine.onOutput = (text): void => {
    process.stdout.write(text);
  };

  for (;;) {
    const state = machine.run();

    if (state !== "waiting-input") break; // halted

    const line = readLineSync();

    if (line === null) break; // end of input

    machine.provideInput(line);
  }
}

main().catch((err) => {
  console.error(`quendor: ${(err as Error).message}`);
  process.exitCode = 1;
});
