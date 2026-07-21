#!/usr/bin/env node

import { loadStoryFromFile } from "quendor/node";
import { dumpAll, dumpHeader, formatInstruction, InstructionReader, isReturnLike } from "quendor";
import { writeFileSync } from "node:fs";

/**
 * Write a header dump (infodump-style).
 */
export async function cmdHeader(path: string): Promise<void> {
  const story = await loadStoryFromFile(path);

  console.log(`File  ${path}`);
  console.log(`loaded ${story.memory.size} bytes`);
  console.log(dumpHeader(story));
}

export async function cmdAbbrevs(path: string): Promise<void> {
  const story = await loadStoryFromFile(path);
  const abbrevs = story.readAbbreviations();

  abbrevs.forEach((text, i) => {
    console.log(`[${String(i).padStart(2)}] ${JSON.stringify(text)}`);
  });
}

/**
 * Write an object/property dump (infodump-style). With an output
 * path, write the file; otherwise print to stdout (redirectable).
 * This will also display the header information.
 */
async function cmdDump(path: string, outPath: string | undefined): Promise<void> {
  const story = await loadStoryFromFile(path);
  const text = `File: ${path}\n\n${dumpAll(story)}\n`;

  if (outPath) {
    writeFileSync(outPath, text);
    console.log(`Wrote dump to ${outPath}`);
  } else {
    process.stdout.write(text);
  }
}

async function cmdDisasm(
  path: string,
  addressArg: string | undefined,
  countArg: string | undefined,
): Promise<void> {
  const story = await loadStoryFromFile(path);
  const start =
    addressArg !== undefined ? parseInt(addressArg, 16) : story.header.initialProgramCounter;
  const maxCount = countArg !== undefined ? parseInt(countArg, 10) : 64;
  const reader = new InstructionReader(story.memory, story.header.version, start);

  for (let i = 0; i < maxCount; i++) {
    const insn = reader.next();
    console.log(`${hex(insn.address)}:  ${formatInstruction(insn, story.text)}`);
    if (isReturnLike(insn)) break;
  }
}

function hex(n: number, width = 4): string {
  return "0x" + n.toString(16).padStart(width, "0");
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
    case "abbrevs": {
      const path = rest[0];

      if (!path) {
        console.error("usage: zexp abbrevs <story-file>");
        process.exitCode = 1;
        return;
      }

      await cmdAbbrevs(path);

      return;
    }
    case "dump": {
      const path = rest[0];

      if (!path) {
        console.error("usage: zexp dump <story-file> [output-file]");
        process.exitCode = 1;
        return;
      }

      await cmdDump(path, rest[1]);

      return;
    }
    case "disasm": {
      const path = rest[0];

      if (!path) {
        console.error("usage: zexp disasm <story-file> [hex-address] [count]");
        process.exitCode = 1;
        return;
      }

      await cmdDisasm(path, rest[1], rest[2]);

      return;
    }
    default:
      console.error("usage: zexp <command> [args]");
      console.error("commands:");
      console.error("  header <story-file>               parse and print the story header");
      console.error("  abbrevs <story-file>              decode the abbreviation table");
      console.error(
        "  dump <story-file> [output-file]   dump header + objects/properties (to a file or stdout)",
      );
      console.error("  disasm <story-file> [addr] [n]    disassemble n instructions from addr");

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
