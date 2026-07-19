#!/usr/bin/env node

import { loadStoryFromFile } from "./node.ts";

const USAGE = `quendor — a terminal Z-Machine player

Usage:
  quendor <story-file>

  <story-file>   a Z-code game (.z1-.z8)
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let path: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];

    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      return;
    } else if (!a.startsWith("-")) {
      path ??= a;
    }
  }

  if (!path) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const story = await loadStoryFromFile(path);

  console.log(`loaded ${story.bytes.length} bytes`);
}

main().catch((err) => {
  console.error(`quendor: ${(err as Error).message}`);
  process.exitCode = 1;
});
