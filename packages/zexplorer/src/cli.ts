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
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const USAGE = `zexp — a headless Z-Machine explorer and debugger

Usage:
  zexp <command> [args]

Commands:
  header   <story-file>                   Parse and print the story header.
  abbrevs  <story-file>                   Decode the abbreviation table.
  dump     <story-file> [out-file]        Dump the header + objects/properties.
  disasm   <story-file> [hex-addr]        Disassemble every reachable routine/target.
  run      <story-file> [run-options]     Execute the story (headless).
  debug    <story-file> [options]         Step through a story in the debugger.
  blorb    <blorb-file> [--extract <dir>] Inspect a Blorb's resources.

Run options (for \`run\` and \`debug\`):
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

  wireSaveRestore(machine, path);

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

type LoadedStory = Awaited<ReturnType<typeof loadStoryFromFile>>;

/** Shared state a debugger command reads and acts on. */
interface DebugCtx {
  machine: Machine;
  story: LoadedStory;
  /** Last watch hit already announced, so re-pausing on it shows "paused", not the hit again. */
  shownHit: Machine["lastWatchHit"];
}

function showState(ctx: DebugCtx): void {
  const { machine } = ctx;

  if (machine.state === "halted") {
    console.log("[halted]");
  } else if (machine.state === "waiting-input") {
    console.log("[waiting for input — use: i <your command>]");
  } else if (machine.state === "paused") {
    const hit = machine.lastWatchHit;

    if (hit && hit !== ctx.shownHit) {
      ctx.shownHit = hit;
      console.log(
        `[watchpoint ${hex(hit.address)}: ${hex(hit.oldValue, 2)} -> ${hex(hit.newValue, 2)}]`,
      );
    } else {
      console.log(`[paused at ${hex(machine.programCounter)}]`);
    }
  }
}

function showNext(ctx: DebugCtx): void {
  if (ctx.machine.state === "halted") return;
  const insn = ctx.machine.decodeAt();
  console.log(`  ${hex(insn.address)}:  ${formatInstruction(insn, ctx.story.text)}`);
}

function showBreakpoints(machine: Machine): void {
  console.log(`breakpoints: ${[...machine.breakpoints].map((a) => hex(a)).join(", ") || "(none)"}`);
}

function showWatchpoints(machine: Machine): void {
  console.log(`watchpoints: ${[...machine.watchpoints].map((a) => hex(a)).join(", ") || "(none)"}`);
}

// --- debugger commands: each maps (ctx, args) to one action ----------------

function dbgStep(ctx: DebugCtx, args: string[]): void {
  // Step exactly N instructions (default 1). Breakpoints/watchpoints are honored
  // by `c` (continue), not by single-stepping.
  const { machine, story } = ctx;
  const n = args[0] ? parseInt(args[0], 10) : 1;

  for (let i = 0; i < n && machine.state !== "halted"; i++) {
    if (machine.state === "waiting-input") break;
    const { executed } = machine.step();
    console.log(`  ${hex(executed.address)}:  ${formatInstruction(executed, story.text)}`);
  }

  showState(ctx);
}

function dbgContinue(ctx: DebugCtx): void {
  ctx.machine.run();
  showState(ctx);
  showNext(ctx);
}

function dbgAddBreak(ctx: DebugCtx, args: string[]): void {
  const a = parseHex(args[0]);
  if (a !== undefined) ctx.machine.breakpoints.add(a);
  showBreakpoints(ctx.machine);
}

function dbgDelBreak(ctx: DebugCtx, args: string[]): void {
  const a = parseHex(args[0]);
  if (a !== undefined) ctx.machine.breakpoints.delete(a);
  showBreakpoints(ctx.machine);
}

function dbgAddWatch(ctx: DebugCtx, args: string[]): void {
  // Watch the word (both bytes) at the address; the usual target is a global or
  // property, which are 16-bit.
  const a = parseHex(args[0]);
  if (a !== undefined) ctx.machine.watchWord(a);
  showWatchpoints(ctx.machine);
}

function dbgDelWatch(ctx: DebugCtx, args: string[]): void {
  const a = parseHex(args[0]);
  if (a !== undefined) {
    ctx.machine.removeWatchpoint(a);
    ctx.machine.removeWatchpoint(a + 1);
  }
  showWatchpoints(ctx.machine);
}

function dbgBacktrace(ctx: DebugCtx): void {
  ctx.machine.getCallStack().forEach((f, i) => {
    console.log(
      `  #${i} routine ${hex(f.routineAddress)}  locals=[${f.locals.map((v) => hex(v)).join(",")}]  ret=${hex(f.returnPC)}`,
    );
  });
}

function dbgRegs(ctx: DebugCtx): void {
  const { machine } = ctx;
  console.log(
    `  pc=${hex(machine.programCounter)}  state=${machine.state}  #insn=${machine.instructionCount}`,
  );
  console.log(
    `  locals=[${machine
      .getLocals()
      .map((v) => hex(v))
      .join(", ")}]`,
  );
  console.log(
    `  stack=[${machine
      .getEvalStack()
      .map((v) => hex(v))
      .join(", ")}]`,
  );
}

function dbgGlobals(ctx: DebugCtx): void {
  const nonZero = ctx.machine
    .getGlobals()
    .map((v, i) => [i, v] as const)
    .filter(([, v]) => v !== 0)
    .map(([i, v]) => `g${hex(i, 2)}=${hex(v)}`);
  console.log("  " + (nonZero.join("  ") || "(all zero)"));
}

function dbgExamine(ctx: DebugCtx, args: string[]): void {
  const { machine } = ctx;
  const addr = parseHex(args[0]) ?? machine.programCounter;
  const n = args[1] ? parseInt(args[1], 10) : 16;
  const count = Number.isNaN(n) ? 16 : n;
  const bytes = Array.from({ length: count }, (_, i) => hex(machine.readMemoryByte(addr + i), 2));
  console.log(`  ${hex(addr)}:  ${bytes.join(" ")}`);
}

function dbgInput(ctx: DebugCtx, args: string[]): void {
  const { machine } = ctx;

  if (machine.state === "waiting-input") {
    machine.provideInput(args.join(" "));
    machine.run();
    showState(ctx);
    showNext(ctx);
  } else {
    console.log("(not waiting for input)");
  }
}

/** Debugger commands keyed by name ("" = repeat-step on a bare Enter). */
const DEBUG_COMMANDS = new Map<string, (ctx: DebugCtx, args: string[]) => void>([
  ["", dbgStep],
  ["s", dbgStep],
  ["c", dbgContinue],
  ["b", dbgAddBreak],
  ["db", dbgDelBreak],
  ["w", dbgAddWatch],
  ["dw", dbgDelWatch],
  ["bt", dbgBacktrace],
  ["regs", dbgRegs],
  ["globals", dbgGlobals],
  ["x", dbgExamine],
  ["i", dbgInput],
]);

async function cmdDebug(path: string, opts: ZexpOptions): Promise<void> {
  const story = await loadStoryFromFile(path);
  const machine = new Machine(story, opts);

  machine.onOutput = (text): void => {
    process.stdout.write(text);
  };

  wireSaveRestore(machine, path);

  const ctx: DebugCtx = { machine, story, shownHit: machine.lastWatchHit };

  console.log(
    "zexp debugger. commands: s[n] c b <a> db <a> w <a> dw <a> bt regs globals x <a> [n] i <text> q",
  );

  showNext(ctx);

  for (;;) {
    process.stdout.write("(zexp) ");

    const line = readLineSync();

    if (line === null || line.trim() === "q") break;

    const [cmd, ...args] = line.trim().split(/\s+/);
    const handler = DEBUG_COMMANDS.get(cmd);

    if (!handler) {
      console.log(`unknown command: ${cmd}`);
      continue;
    }

    // A bad command (an out-of-range `x`, a malformed argument) prints an error
    // and keeps the session alive rather than tearing down the whole debugger.
    try {
      handler(ctx, args);
    } catch (err) {
      console.log(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Wire save/restore to a single `.qzl` slot beside the story file. */
export function wireSaveRestore(machine: Machine, storyPath: string): void {
  const savePath = storyPath + ".qzl";

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

/** Parse a hex address argument; undefined if missing or not a number. */
function parseHex(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = parseInt(s, 16);
  return Number.isNaN(n) ? undefined : n;
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
    case "debug": {
      const { path, opts } = parseArgs(rest);

      return withPath(path, "usage: zexp debug <story-file> [--seed N] [--tandy]", (p) =>
        cmdDebug(p, opts),
      );
    }
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
