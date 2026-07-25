#!/usr/bin/env node

import { loadStoryFromFile, readLineSync } from "quendor/node";
import {
  describeBlorb,
  extractBlorb,
  disassembleReachable,
  dumpAll,
  dumpHeader,
  formatInstruction,
  formatResolvedOperands,
  Machine,
  RunState,
} from "quendor";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const USAGE = `zexp — a headless Z-Machine explorer and debugger

Usage:
  zexp <command> [args]

Commands:
  header   <story-file>                   Parse and print the story header.
  abbrevs  <story-file>                   Decode the abbreviation table.
  dump     <story-file> [out-file]        Dump the header + objects/properties.
  disasm   <story-file> [hex-addr]        Disassemble every reachable routine/target.
  run      <story-file> [run-options]     Execute the story (headless).
  blorb    <blorb-file> [--extract <dir>] Inspect a Blorb's resources.

Run options (for \`zexp run\`):
  --trace <file>            Log the executed opcode path to <file>.
  --seed N                  Fix the RNG seed for reproducible runs.
  --tandy                   Set the v1-3 "Tandy" flag.
  --interpreter N           Interpreter number reported to the game (default 6, IBM PC).
  --interpreter-version C   Interpreter version letter (default A).
`;

interface ZexpOptions {
  trace?: string;
  seed?: number;
  tandy?: boolean;
  interpreterNumber?: number;
  interpreterVersion?: number;
}

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

/**
 * Disassemble every routine and jump/branch target reachable from an
 * address, txd-style, following call/jump/branch targets instead of
 * reading bytes strictly in order. An unrecognized opcode stops only the
 * run it's in; every other reachable run still gets decoded and printed.
 */
async function cmdDisasm(path: string, addressArg: string | undefined): Promise<void> {
  const story = await loadStoryFromFile(path);
  const start =
    addressArg !== undefined ? parseInt(addressArg, 16) : story.header.initialProgramCounter;
  const runs = disassembleReachable(story, start);

  for (const run of runs) {
    console.log(`=== ${run.isRoutineStart ? "ROUTINE" : "run"} @${hex(run.startAddress)} ===`);

    for (const insn of run.instructions) {
      console.log(`${hex(insn.address)}:  ${formatInstruction(insn, story.text)}`);
    }

    if (run.error !== undefined) {
      console.log(`  (stopped: ${run.error})`);
    }

    console.log("");
  }

  const instructionCount = runs.reduce((n, r) => n + r.instructions.length, 0);

  console.log(`${runs.length} runs, ${instructionCount} instructions total`);
}

async function cmdRun(path: string, opts: ZexpOptions): Promise<void> {
  const story = await loadStoryFromFile(path);
  const machine = new Machine(story, {
    randomSeed: opts.seed,
    tandy: opts.tandy,
    interpreterNumber: opts.interpreterNumber,
    interpreterVersion: opts.interpreterVersion,
  });

  machine.onOutput = (text): void => {
    process.stdout.write(text);
  };

  // --trace: stream every executed instruction to a file, indented by call
  // depth so the routine call chain reads at a glance. Batched per run() to
  // avoid a filesystem write per instruction.
  const tracePath = opts.trace;
  const traceBatch: string[] = [];

  if (tracePath) {
    // truncate any previous trace
    writeFileSync(tracePath, "");

    machine.onTrace = (insn, depth, ops): void => {
      const indent = "  ".repeat(Math.max(0, depth - 1));
      let line = `${indent}${hex(insn.address)}: ${formatInstruction(insn, story.text)}`;

      // Annotate what each variable operand actually resolved to at runtime,
      // the one thing the static disassembly can't show.
      const resolved = formatResolvedOperands(insn, ops);

      if (resolved) {
        line += `  ; ${resolved}`;
      }

      traceBatch.push(line);
    };
  }

  const flushTrace = (): void => {
    if (tracePath && traceBatch.length) {
      appendFileSync(tracePath, traceBatch.join("\n") + "\n");
      traceBatch.length = 0;
    }
  };

  for (;;) {
    const state = machine.run();

    flushTrace();

    if (state === RunState.WaitingForInput) {
      const line = readLineSync();

      if (line === null) break; // end of input: stop cleanly

      machine.provideInput(line);
    } else {
      // halted (or paused, though plain run sets no breakpoints)
      break;
    }
  }

  flushTrace();

  if (tracePath) {
    process.stderr.write(`\n[trace written to ${tracePath}]\n`);
  }
}

/**
 * Show a Blorb's structure (chunks, story, metadata, picture/sound resources).
 * With `--extract <dir>`, also write each resource out as a file.
 */
async function cmdBlorb(path: string, extractDir: string | undefined): Promise<void> {
  const bytes = new Uint8Array(readFileSync(path));

  console.log(`File  ${path}`);
  console.log(describeBlorb(bytes));

  if (extractDir !== undefined) {
    const files = extractBlorb(bytes);

    if (files.length === 0) {
      console.log("\nNothing to extract (not a Blorb, or no resources).");
      return;
    }

    mkdirSync(extractDir, { recursive: true });

    for (const f of files) {
      writeFileSync(`${extractDir}/${f.name}`, f.data);
    }

    console.log(`\nExtracted ${files.length} file(s) to ${extractDir}/`);
  }
}

/** Parse an integer argument, yielding undefined for a non-numeric value. */
function intArg(value: string): number | undefined {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

export function parseArgs(rest: string[]): { path: string | undefined; opts: ZexpOptions } {
  const opts: ZexpOptions = {};
  const positional: string[] = [];

  // Flags that consume the following argument. Adding an option is a new entry
  // here, not another branch in the loop below.
  const withValue: Record<string, (value: string) => void> = {
    "--trace": (v): void => {
      opts.trace = v;
    },
    "--seed": (v): void => {
      const n = intArg(v);
      if (n !== undefined) opts.seed = n;
    },
    "--interpreter": (v): void => {
      const n = intArg(v);
      if (n !== undefined) opts.interpreterNumber = n;
    },
    "--interpreter-version": (v): void => {
      const c = v.charCodeAt(0); // version is a byte, conventionally a letter
      if (!Number.isNaN(c)) opts.interpreterVersion = c;
    },
  };

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];

    if (a === "--tandy") opts.tandy = true;
    else if (a in withValue && i + 1 < rest.length) withValue[a](rest[++i]);
    else positional.push(a);
  }

  return { path: positional[0], opts };
}

function hex(n: number, width = 4): string {
  return "0x" + n.toString(16).padStart(width, "0");
}

/** Run `fn` with the required story-file path, or print `usage` and exit 1. */
async function withPath(
  path: string | undefined,
  usage: string,
  fn: (path: string) => Promise<void>,
): Promise<void> {
  if (!path) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }

  await fn(path);
}

/** The `--extract <dir>` target (defaulting to "blorb-out"), or undefined if absent. */
function extractDir(rest: string[]): string | undefined {
  const ex = rest.indexOf("--extract");
  return ex >= 0 ? (rest[ex + 1] ?? "blorb-out") : undefined;
}

export async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  // Explicit help succeeds and goes to stdout so it can be piped; usage errors
  // (below) go to stderr with a non-zero exit.
  if (command === "-h" || command === "--help") {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case "header":
      return withPath(rest[0], "usage: zexp header <story-file>", (p) => cmdHeader(p));
    case "abbrevs":
      return withPath(rest[0], "usage: zexp abbrevs <story-file>", (p) => cmdAbbrevs(p));
    case "dump":
      return withPath(rest[0], "usage: zexp dump <story-file> [output-file]", (p) =>
        cmdDump(p, rest[1]),
      );
    case "disasm":
      return withPath(rest[0], "usage: zexp disasm <story-file> [hex-address]", (p) =>
        cmdDisasm(p, rest[1]),
      );
    case "run": {
      const { path, opts } = parseArgs(rest);
      return withPath(
        path,
        "usage: zexp run <story-file> [run-options]   (see 'zexp --help')",
        (p) => cmdRun(p, opts),
      );
    }
    case "blorb":
      return withPath(rest[0], "usage: zexp blorb <blorb-file> [--extract <dir>]", (p) =>
        cmdBlorb(p, extractDir(rest)),
      );
    default:
      // Unknown command names get a pointed error line; a bare invocation (no
      // command — undefined at runtime, though typed string) falls through to
      // just the usage text.
      if (command) console.error(`zexp: unknown command '${command}'\n`);
      console.error(USAGE);
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
