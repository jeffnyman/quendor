#!/usr/bin/env node

import { Machine } from "./machine.ts";
import { loadStoryFromFile } from "./node.ts";

const USAGE = `quendor — a terminal Z-Machine player

Usage:
  quendor <story-file>

  <story-file>   a Z-code game (.z1-.z8)
`;

type ParsedArgs = { help: true } | { help: false; path?: string };

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
  new Machine(story);
}

main().catch((err) => {
  console.error(`quendor: ${(err as Error).message}`);
  process.exitCode = 1;
});
