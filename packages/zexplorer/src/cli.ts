#!/usr/bin/env node

import { loadStoryFromFile } from "quendor/node";
import { dumpHeader } from "quendor";

export async function cmdHeader(path: string): Promise<void> {
  const story = await loadStoryFromFile(path);

  console.log(`File  ${path}`);
  console.log(`loaded ${story.memory.size} bytes`);
  console.log(dumpHeader(story));
}

export async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "header": {
      const path = rest[0];

      if (!path) {
        console.error("usage: zexp header <story-file>");
        process.exitCode = 1;
        return;
      }

      await cmdHeader(path);

      return;
    }
    default:
      console.error("usage: zexp <command> [args]");
      console.error("commands:");
      console.error("  header <story-file>    parse and print the story header");

      process.exitCode = 1;
  }
}

/* v8 ignore next -- @preserve */
if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
