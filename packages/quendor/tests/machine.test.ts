import { expect, test } from "vite-plus/test";
import { Story } from "../src/story.ts";
import { HeaderOffset } from "../src/header.ts";
import { Machine, RunState } from "../src/machine.ts";

function buildStory(size: number, fill: (bytes: Uint8Array) => void): Story {
  const bytes = new Uint8Array(size);

  fill(bytes);

  return new Story(bytes);
}

test("stamps the interpreter number and version into memory", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
    }),
  );

  expect(machine.memory.readByte(HeaderOffset.InterpreterNumber)).toBe(6);
  expect(machine.memory.readByte(HeaderOffset.InterpreterVersion)).toBe(0x41);
});

test("exposes the interpreter number and version it wrote", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
    }),
  );

  expect(machine.interpreterNumber).toBe(6);
  expect(machine.interpreterVersion).toBe(0x41);
});

test("uses the interpreter number and version from options when provided", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
    }),
    { interpreterNumber: 2, interpreterVersion: 0x42 }, // Apple IIe, 'B'
  );

  expect(machine.memory.readByte(HeaderOffset.InterpreterNumber)).toBe(2);
  expect(machine.memory.readByte(HeaderOffset.InterpreterVersion)).toBe(0x42);
  expect(machine.interpreterNumber).toBe(2);
  expect(machine.interpreterVersion).toBe(0x42);
});

test("v4+ writes the screen dimensions into the header (0x20/0x21)", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 4;
    }),
    { screenWidth: 100, screenHeight: 30 },
  );

  expect(machine.memory.readByte(HeaderOffset.ScreenWidth)).toBe(100);
  expect(machine.memory.readByte(HeaderOffset.ScreenHeight)).toBe(30);
});

test("v1-3 leaves the screen-dimension bytes alone (they're a v4+ header field)", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
    }),
    { screenWidth: 100, screenHeight: 30 },
  );

  expect(machine.memory.readByte(HeaderOffset.ScreenWidth)).toBe(0);
  expect(machine.memory.readByte(HeaderOffset.ScreenHeight)).toBe(0);
});

test("shares the story's memory rather than copying it", () => {
  const story = buildStory(64, (bytes) => {
    bytes[HeaderOffset.Version] = 3;
  });
  const machine = new Machine(story);

  expect(machine.memory).toBe(story.memory);
});

test("v1-5/7/8: the initial frame has no locals and starts at the header's byte address", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
      bytes[HeaderOffset.InitialProgramCounter + 1] = 40; // byte address 40
    }),
  );

  expect(machine.currentFrame.routineAddress).toBe(40);
  expect(machine.currentFrame.locals).toEqual([]);
});

test("v6: unpacks the packed main-routine address and reads its header", () => {
  const machine = new Machine(
    buildStory(70, (bytes) => {
      bytes[HeaderOffset.Version] = 6;
      bytes[HeaderOffset.InitialProgramCounter + 1] = 15; // packed address 15
      bytes[60] = 2; // routine header: 2 locals (v6 -> initial values are 0)
    }),
  );

  expect(machine.currentFrame.routineAddress).toBe(60); // 15 * 4 + routinesOffset(0) * 8
  expect(machine.currentFrame.locals).toEqual([0, 0]);
});

// --- execution: call / ret round-trip -------------------------------------
//
// A tiny hand-assembled v3 program. Layout (all outside the header):
//   MAIN (initial PC) -> ROUTINE (packed) -> GLOBALS (variable table).
// The emitters below build real instruction bytes so the encoding is readable
// and matches InstructionReader exactly, rather than magic hex.

const MAIN = 0x40;
const ROUTINE = 0x50;
const ROUTINE_PACKED = ROUTINE >> 1; // v3 packs routine addresses / 2
const GLOBALS = 0x60;
const G_FIRST = 0x10; // variable number of the first global

/** VAR-form `call` (opcode 0xe0): routine + args as large constants, then a store byte. */
function callInsn(packedRoutine: number, args: number[], storeVar: number): number[] {
  const operands = [packedRoutine, ...args]; // all encoded as large constants (kind 0b00)
  let kinds = 0;

  for (let i = 0; i < 4; i++) {
    const kind = i < operands.length ? 0b00 : 0b11; // large constant, else omitted
    kinds |= kind << (6 - i * 2);
  }

  const bytes = [0xe0, kinds];

  for (const value of operands) bytes.push((value >> 8) & 0xff, value & 0xff);

  bytes.push(storeVar);

  return bytes;
}

/** Short 1OP `ret` (0x9b) of a small constant. */
function retConst(value: number): number[] {
  return [0x9b, value & 0xff];
}

/** Short 1OP `ret` (0xab) of a variable — e.g. a local. */
function retVar(variableNumber: number): number[] {
  return [0xab, variableNumber & 0xff];
}

/** A v3 routine: a local-count byte, one initial-value word per local, then the body. */
function routine(initials: number[], body: number[]): number[] {
  return [initials.length, ...initials.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]), ...body];
}

function buildProgram(main: number[], routineBytes?: number[], globalW0?: number): Story {
  const bytes = new Uint8Array(0x100);

  bytes[HeaderOffset.Version] = 3;
  bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
  bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
  bytes[HeaderOffset.GlobalVariablesTableAddress] = (GLOBALS >> 8) & 0xff;
  bytes[HeaderOffset.GlobalVariablesTableAddress + 1] = GLOBALS & 0xff;

  bytes.set(main, MAIN);

  if (routineBytes) bytes.set(routineBytes, ROUTINE);

  if (globalW0 !== undefined) {
    bytes[GLOBALS] = (globalW0 >> 8) & 0xff;
    bytes[GLOBALS + 1] = globalW0 & 0xff;
  }

  return new Story(bytes);
}

test("call enters the routine, mapping the argument into its first local", () => {
  const machine = new Machine(
    buildProgram(
      [...callInsn(ROUTINE_PACKED, [0x1234], G_FIRST), ...retConst(0)],
      routine([0x0000], retVar(0x01)),
    ),
  );

  const { executed, state } = machine.step(); // execute the `call`

  expect(executed.opcode.name).toBe("call");
  expect(state).toBe(RunState.Running);
  expect(machine.currentFrame.routineAddress).toBe(ROUTINE);
  expect(machine.currentFrame.locals).toEqual([0x1234]); // arg -> local 1
  expect(machine.currentFrame.storeVariable).toBe(G_FIRST);
  expect(machine.currentFrame.returnPC).toBe(MAIN + 7); // past the 7-byte call
});

test("ret unwinds to the caller and stores the returned value", () => {
  const machine = new Machine(
    buildProgram(
      [...callInsn(ROUTINE_PACKED, [0x1234], G_FIRST), ...retConst(0)],
      routine([0x0000], retVar(0x01)), // returns local 1 (= the arg)
    ),
  );

  machine.step(); // call -> inside routine
  const { executed, state } = machine.step(); // ret -> back in main

  expect(executed.opcode.name).toBe("ret");
  expect(state).toBe(RunState.Running);
  expect(machine.currentFrame.routineAddress).toBe(MAIN); // back in the caller
  expect(machine.memory.readWord(GLOBALS)).toBe(0x1234); // stored into global 0x10
});

test("returning from the main routine halts the machine", () => {
  const machine = new Machine(
    buildProgram(
      [...callInsn(ROUTINE_PACKED, [0x1234], G_FIRST), ...retConst(0)],
      routine([0x0000], retVar(0x01)),
    ),
  );

  machine.step(); // call
  machine.step(); // ret from routine
  const { state } = machine.step(); // main's `ret 0`

  expect(state).toBe(RunState.Halted);
});

test("call with fewer arguments than locals leaves the rest at their initial values", () => {
  const machine = new Machine(
    buildProgram(
      callInsn(ROUTINE_PACKED, [0x1234], G_FIRST),
      routine([0x00aa, 0x00bb], retConst(0)),
    ),
  );

  machine.step(); // call

  expect(machine.currentFrame.locals).toEqual([0x1234, 0x00bb]); // arg overrides local 1 only
});

test("call with more arguments than locals drops the extras", () => {
  const machine = new Machine(
    buildProgram(
      callInsn(ROUTINE_PACKED, [0x1111, 0x2222], G_FIRST),
      routine([0x0000], retConst(0)),
    ),
  );

  machine.step(); // call

  expect(machine.currentFrame.locals).toEqual([0x1111]); // second arg has nowhere to go
});

test("call to packed address 0 does nothing and stores false", () => {
  const machine = new Machine(
    buildProgram(callInsn(0, [], G_FIRST), undefined, 0xffff), // global pre-seeded non-zero
  );

  machine.step(); // call 0

  expect(machine.currentFrame.routineAddress).toBe(MAIN); // no frame pushed
  expect(machine.memory.readWord(GLOBALS)).toBe(0); // stored 0
});

// --- execution: text output ------------------------------------------------
//
// NOTE: these tests never load a real story file. `entharion`'s Infocom and
// checker files aren't present in a plain clone or in CI (it's an optional
// submodule, and CI does not fetch submodules), the suite is kept independent
// of it by design, and the Infocom files are copyrighted and can't be vendored.
// So we hand-assemble tiny synthetic stories. czech/etude and the real Zork
// banner are manual, local conformance checks — not part of the automated suite.

/** Encode a lowercase-ASCII string (with spaces) as packed Z-words for inline text. */
function zstring(text: string): number[] {
  const zchars: number[] = [];

  for (const ch of text) {
    zchars.push(ch === " " ? 0 : 6 + (ch.charCodeAt(0) - "a".charCodeAt(0)));
  }

  while (zchars.length % 3 !== 0) zchars.push(5); // pad with a harmless shift

  const words: number[] = [];

  for (let i = 0; i < zchars.length; i += 3) {
    words.push((zchars[i] << 10) | (zchars[i + 1] << 5) | zchars[i + 2]);
  }

  words[words.length - 1] |= 0x8000; // terminator bit on the final word

  return words;
}

/** 0OP `print` (0xb2) carrying `text` as inline Z-text. */
function printInsn(text: string): number[] {
  return [0xb2, ...zstring(text).flatMap((w) => [(w >> 8) & 0xff, w & 0xff])];
}

/** 0OP `new_line` (0xbb). */
function newLineInsn(): number[] {
  return [0xbb];
}

test("print emits inline text through onOutput, and new_line emits a newline", () => {
  const machine = new Machine(
    buildProgram([...printInsn("hello world"), ...newLineInsn(), ...retConst(0)]),
  );

  let out = "";
  machine.onOutput = (text): void => {
    out += text;
  };

  machine.run();

  expect(out).toBe("hello world\n");
});

// --- execution: output streams and upper-window refresh --------------------

/** VAR `output_stream` (0xf3) with a single large-constant operand (may be negative). */
function outputStreamInsn(value: number): number[] {
  return [0xf3, 0x3f, (value >> 8) & 0xff, value & 0xff]; // types: large const, rest omitted
}

/** VAR `split_window` (0xea) with a single small-constant operand. */
function splitWindowInsn(lines: number): number[] {
  return [0xea, 0x7f, lines & 0xff]; // types: small const, rest omitted
}

/** VAR `set_window` (0xeb) with a single small-constant operand. */
function setWindowInsn(window: number): number[] {
  return [0xeb, 0x7f, window & 0xff];
}

test("output_stream -1 suppresses screen output until stream 1 is reselected", () => {
  const machine = new Machine(
    buildProgram([
      ...printInsn("a"),
      ...outputStreamInsn(-1), // disable the screen
      ...printInsn("b"), // goes nowhere on screen
      ...outputStreamInsn(1), // re-enable it
      ...printInsn("c"),
      ...retConst(0),
    ]),
  );

  let out = "";
  machine.onOutput = (text): void => {
    out += text;
  };

  machine.run();

  expect(out).toBe("ac"); // the "b" printed while the screen stream was off is dropped
});

test("upper-window opcodes fire onScreenRefresh so the host can repaint mid-run", () => {
  const machine = new Machine(
    buildProgram([...splitWindowInsn(2), ...setWindowInsn(1), ...setWindowInsn(0), ...retConst(0)]),
  );

  let refreshes = 0;
  machine.onScreenRefresh = (): void => {
    refreshes++;
  };

  machine.run();

  expect(refreshes).toBe(3); // split_window + two set_window
});

// --- execution: opcode exerciser -------------------------------------------
//
// Straight-line programs that drive the arithmetic/memory/branch opcodes and
// assert an observable result (a global, or a routine's return value), the
// CI-safe stand-in for a czech run. Branch opcodes use the rtrue/rfalse special
// offsets so no branch target has to be hand-computed. Object opcodes
// (test_attr/put_prop) need an object table and are covered separately.

const G17 = 0x11;
const G18 = 0x12;
const TABLE = 0x70; // scratch memory area, clear of MAIN/ROUTINE/GLOBALS

/** add #a #b -> store (2OP, both small constants). */
function addInsn(a: number, b: number, store: number): number[] {
  return [0x14, a & 0xff, b & 0xff, store & 0xff];
}

/** sub Gv #b -> store (2OP; first operand a variable, second a small constant). */
function subVarInsn(varNum: number, b: number, store: number): number[] {
  return [0x55, varNum & 0xff, b & 0xff, store & 0xff];
}

/** store #var #value (2OP; writes value into the variable named by the first operand). */
function storeInsn(varNum: number, value: number): number[] {
  return [0x0d, varNum & 0xff, value & 0xff];
}

/** storew #base #index #value (VAR, three small constants). */
function storewInsn(base: number, index: number, value: number): number[] {
  return [0xe1, 0x57, base & 0xff, index & 0xff, value & 0xff];
}

/** loadw #base #index -> store (2OP, both small constants). */
function loadwInsn(base: number, index: number, store: number): number[] {
  return [0x0f, base & 0xff, index & 0xff, store & 0xff];
}

/** je #a #b, branching to "return true" (offset 1) when equal. */
function jeRtrueInsn(a: number, b: number): number[] {
  return [0x01, a & 0xff, b & 0xff, 0xc1]; // 0xc1 = whenTrue | one-byte | offset 1
}

/** jz #value, branch-on-true to "return true"; with a non-zero value it falls through. */
function jzInsn(value: number): number[] {
  return [0x90, value & 0xff, 0xc1];
}

/** jump by a signed offset (1OP, large constant). */
function jumpInsn(offset: number): number[] {
  return [0x8c, (offset >> 8) & 0xff, offset & 0xff];
}

test("add, sub, and store compute and write the expected globals", () => {
  const machine = new Machine(
    buildProgram([
      ...addInsn(10, 5, G_FIRST), // G16 = 15
      ...subVarInsn(G_FIRST, 3, G17), // G17 = G16 - 3 = 12
      ...storeInsn(G18, 0x2a), // G18 = 42
      ...retConst(0),
    ]),
  );

  machine.run();

  expect(machine.memory.readWord(GLOBALS)).toBe(15);
  expect(machine.memory.readWord(GLOBALS + 2)).toBe(12);
  expect(machine.memory.readWord(GLOBALS + 4)).toBe(0x2a);
});

test("storew then loadw round-trips a word through memory", () => {
  const machine = new Machine(
    buildProgram([
      ...storewInsn(TABLE, 1, 0xab), // memory[TABLE + 2] = 0x00ab
      ...loadwInsn(TABLE, 1, G_FIRST), // G16 = memory[TABLE + 2] = 0xab
      ...retConst(0),
    ]),
  );

  machine.run();

  expect(machine.memory.readWord(GLOBALS)).toBe(0xab);
});

test("je takes its branch when operands are equal", () => {
  const machine = new Machine(
    buildProgram(
      [...callInsn(ROUTINE_PACKED, [], G_FIRST), ...retConst(0)],
      routine([], [...jeRtrueInsn(5, 5), ...retConst(0)]), // equal -> return true (1)
    ),
  );

  machine.run();

  expect(machine.memory.readWord(GLOBALS)).toBe(1); // branch taken -> routine returned 1
});

test("jz falls through when its operand is non-zero", () => {
  const machine = new Machine(
    buildProgram(
      [...callInsn(ROUTINE_PACKED, [], G_FIRST), ...retConst(0)],
      routine([], [...jzInsn(1), ...retConst(7)]), // 1 != 0 -> no branch -> ret 7
    ),
  );

  machine.run();

  expect(machine.memory.readWord(GLOBALS)).toBe(7); // fell through to ret 7
});

test("jump skips the instruction it leaps over", () => {
  const machine = new Machine(
    buildProgram([
      ...jumpInsn(5), // skip the next 3-byte store
      ...storeInsn(G_FIRST, 0x00), // failure marker (jumped over)
      ...storeInsn(G_FIRST, 0x63), // landing site: G16 = 99
      ...retConst(0),
    ]),
  );

  machine.run();

  expect(machine.memory.readWord(GLOBALS)).toBe(0x63); // proves the fail store was skipped
});

// --- execution: sread / input handling -------------------------------------
//
// Drives the read path end to end: sread blocks the machine WaitingForInput,
// provideInput satisfies it, and the line is written to the text buffer and
// tokenized into the parse buffer against a small in-memory dictionary.

const TEXTBUF = 0x80;
const PARSEBUF = 0xa0;
const DICT = 0xc0;
const DICT_BASE = DICT + 4; // past sepCount (1) + entryLength (1) + entryCount (2)

/** Encode a short (<=6 char) lowercase word as fixed 2-word dictionary bytes. */
function dictWordBytes(word: string): number[] {
  return zstring(word).flatMap((w) => [(w >> 8) & 0xff, w & 0xff]);
}

/** Read a NUL-terminated ASCII string from memory. */
function readAsciiz(machine: Machine, address: number): string {
  let s = "";

  for (let a = address; machine.memory.readByte(a) !== 0; a++) {
    s += String.fromCharCode(machine.memory.readByte(a));
  }

  return s;
}

/** A v3 story whose main routine is `sread TEXTBUF PARSEBUF; ret 0`, with a
 *  two-word dictionary of "door" and "open" (sorted). */
function buildReadProgram(): Story {
  const bytes = new Uint8Array(0x100);

  bytes[HeaderOffset.Version] = 3;
  bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
  bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
  bytes[HeaderOffset.DictionaryAddress] = (DICT >> 8) & 0xff;
  bytes[HeaderOffset.DictionaryAddress + 1] = DICT & 0xff;

  // sread #TEXTBUF #PARSEBUF (VAR 0xe4, two small-constant operands); then ret 0
  bytes.set([0xe4, 0x5f, TEXTBUF, PARSEBUF, 0x9b, 0x00], MAIN);

  bytes[TEXTBUF] = 20; // max input length
  bytes[PARSEBUF] = 5; // max parsed words

  // dictionary: 0 separators, 4-byte entries, 2 sorted entries (door < open)
  bytes[DICT] = 0;
  bytes[DICT + 1] = 4;
  bytes[DICT + 2] = 0x00;
  bytes[DICT + 3] = 0x02;
  bytes.set([...dictWordBytes("door"), ...dictWordBytes("open")], DICT_BASE);

  return new Story(bytes);
}

test("sread blocks for input, then fills the text and parse buffers", () => {
  const machine = new Machine(buildReadProgram());

  expect(machine.run()).toBe(RunState.WaitingForInput); // blocked on sread

  machine.provideInput("open door");

  // text buffer (v3): NUL-terminated, starting one byte in
  expect(readAsciiz(machine, TEXTBUF + 1)).toBe("open door");

  // parse buffer: [maxWords][count][entryAddr, length, textPosition] * count
  expect(machine.memory.readByte(PARSEBUF + 1)).toBe(2);

  // token 0 "open" -> second dictionary entry, length 4, at text position 1
  expect(machine.memory.readWord(PARSEBUF + 2)).toBe(DICT_BASE + 4);
  expect(machine.memory.readByte(PARSEBUF + 4)).toBe(4);
  expect(machine.memory.readByte(PARSEBUF + 5)).toBe(1);

  // token 1 "door" -> first dictionary entry, length 4, at text position 6
  expect(machine.memory.readWord(PARSEBUF + 6)).toBe(DICT_BASE);
  expect(machine.memory.readByte(PARSEBUF + 8)).toBe(4);
  expect(machine.memory.readByte(PARSEBUF + 9)).toBe(6);
});

// --- execution: quit / restart ---------------------------------------------

/** 0OP `quit` (0xba). */
function quitInsn(): number[] {
  return [0xba];
}

/** 0OP `restart` (0xb7). */
function restartInsn(): number[] {
  return [0xb7];
}

/** A v3 story whose main calls a routine, with the whole buffer marked dynamic
 *  so restart's memory-restore is observable. The routine body is caller-supplied. */
function buildRestartProgram(routineBytes: number[]): Story {
  const bytes = new Uint8Array(0x100);

  bytes[HeaderOffset.Version] = 3;
  bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
  bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
  bytes[HeaderOffset.GlobalVariablesTableAddress] = (GLOBALS >> 8) & 0xff;
  bytes[HeaderOffset.GlobalVariablesTableAddress + 1] = GLOBALS & 0xff;
  bytes[HeaderOffset.StaticMemoryBase] = (0x100 >> 8) & 0xff; // all memory dynamic
  bytes[HeaderOffset.StaticMemoryBase + 1] = 0x100 & 0xff;

  bytes.set([...callInsn(ROUTINE_PACKED, [], G_FIRST), ...retConst(0)], MAIN);
  bytes.set(routineBytes, ROUTINE);

  return new Story(bytes);
}

test("quit halts the machine", () => {
  const machine = new Machine(buildProgram(quitInsn()));

  expect(machine.run()).toBe(RunState.Halted);
});

test("restart restores dynamic memory and returns to a fresh main frame", () => {
  // Restart from *inside* a routine: main calls R, R writes a global then restarts.
  const machine = new Machine(
    buildRestartProgram(routine([], [...storeInsn(G_FIRST, 0x42), ...restartInsn()])),
  );

  machine.step(); // call R -> now inside the routine
  machine.step(); // store 0x42 into global 0x10 (dynamic memory)
  expect(machine.memory.readWord(GLOBALS)).toBe(0x42); // sanity: the write landed

  machine.step(); // restart

  // Frame reset: current is the fresh main frame, not the routine's. (Regression
  // guard: discarding setupInitialFrame's return leaves this pointing at R.)
  expect(machine.currentFrame.routineAddress).toBe(MAIN);
  // Memory reset: the global is restored to its original value.
  expect(machine.memory.readWord(GLOBALS)).toBe(0);
});

// --- execution: save / restore ---------------------------------------------
//
// save/restore go through the injected onSave/onRestore byte callbacks — the
// engine never touches a file — so the whole round-trip runs in memory. The
// story marks all memory dynamic so a restore's memory-revert is observable.

/** 0OP `save` (0xb5) followed by a branch byte. */
function saveInsn(branch: number): number[] {
  return [0xb5, branch & 0xff];
}

/** 0OP `restore` (0xb6) followed by a branch byte. */
function restoreInsn(branch: number): number[] {
  return [0xb6, branch & 0xff];
}

// Branch bytes (on-true, one-byte offset): 0xc1 => offset 1 (return true);
// 0xc2 => offset 2, which lands on the next instruction whether or not it's
// taken, keeping save's control flow linear for the round-trip test.
const BRANCH_RTRUE = 0xc1;
const BRANCH_CONTINUE = 0xc2;

/** buildProgram, but with all memory dynamic so save/restore memory changes show. */
function buildSaveProgram(main: number[], routineBytes?: number[]): Story {
  const bytes = new Uint8Array(0x100);

  bytes[HeaderOffset.Version] = 3;
  bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
  bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
  bytes[HeaderOffset.GlobalVariablesTableAddress] = (GLOBALS >> 8) & 0xff;
  bytes[HeaderOffset.GlobalVariablesTableAddress + 1] = GLOBALS & 0xff;
  bytes[HeaderOffset.StaticMemoryBase] = (0x100 >> 8) & 0xff; // all memory dynamic
  bytes[HeaderOffset.StaticMemoryBase + 1] = 0x100 & 0xff;

  bytes.set(main, MAIN);

  if (routineBytes) bytes.set(routineBytes, ROUTINE);

  return new Story(bytes);
}

test("save hands a Quetzal blob to onSave, and restore reverts memory to that point", () => {
  const machine = new Machine(
    buildSaveProgram([
      ...storeInsn(G_FIRST, 0x11), // G16 = 0x11  (the state we save)
      ...saveInsn(BRANCH_CONTINUE), // capture the blob, continue
      ...storeInsn(G_FIRST, 0x22), // G16 = 0x22  (mutate after saving)
      ...restoreInsn(BRANCH_CONTINUE), // revert to the saved state
      ...quitInsn(),
    ]),
  );

  let blob: Uint8Array | null = null;
  machine.onSave = (data): boolean => {
    blob = data;
    return true;
  };
  machine.onRestore = (): Uint8Array | null => blob;

  machine.step(); // store 0x11
  expect(machine.memory.readWord(GLOBALS)).toBe(0x11);

  machine.step(); // save
  // onSave received the blob; its IFZS format is covered in quetzal.test.ts.
  expect(blob).not.toBeNull();

  machine.step(); // store 0x22
  expect(machine.memory.readWord(GLOBALS)).toBe(0x22); // mutated after the save

  machine.step(); // restore
  expect(machine.memory.readWord(GLOBALS)).toBe(0x11); // memory reverted to the save point
});

test("save branches on success (onSave true) and falls through on failure", () => {
  // Routine body `save ?rtrue; ret 7`: success -> return 1, failure -> return 7.
  const build = (): Story =>
    buildSaveProgram(
      [...callInsn(ROUTINE_PACKED, [], G_FIRST), ...quitInsn()],
      routine([], [...saveInsn(BRANCH_RTRUE), ...retConst(7)]),
    );

  const ok = new Machine(build());
  ok.onSave = (): boolean => true;
  ok.run();
  expect(ok.memory.readWord(GLOBALS)).toBe(1); // succeeded -> branch to rtrue

  const fail = new Machine(build());
  fail.onSave = (): boolean => false;
  fail.run();
  expect(fail.memory.readWord(GLOBALS)).toBe(7); // failed -> fell through to ret 7
});

test("restore fails cleanly (result 0) when onRestore offers no save", () => {
  const machine = new Machine(
    buildSaveProgram(
      [...callInsn(ROUTINE_PACKED, [], G_FIRST), ...quitInsn()],
      routine([], [...restoreInsn(BRANCH_RTRUE), ...retConst(7)]),
    ),
  );

  machine.onRestore = (): Uint8Array | null => null;
  machine.run();

  expect(machine.memory.readWord(GLOBALS)).toBe(7); // no save -> restore fell through to ret 7
});

// --- header: Tandy flag ----------------------------------------------------
//
// The v1-3 Tandy bit (Flags 1, bit 3) is interpreter-owned: driven by the
// `tandy` option and — the subtle part — re-asserted after a restart, since the
// dynamic-memory restore (from a snapshot taken before the bit was set) clears it.

test("sets the v1-3 Tandy bit (Flags 1, bit 3) when the tandy option is given", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
    }),
    { tandy: true },
  );

  expect(machine.memory.readByte(HeaderOffset.Flags1) & 0x08).toBe(0x08);
});

test("leaves the Tandy bit clear by default", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
    }),
  );

  expect(machine.memory.readByte(HeaderOffset.Flags1) & 0x08).toBe(0);
});

test("re-asserts the Tandy bit after a restart", () => {
  const machine = new Machine(buildRestartProgram(routine([], restartInsn())), { tandy: true });

  expect(machine.memory.readByte(HeaderOffset.Flags1) & 0x08).toBe(0x08); // set at load

  machine.step(); // call the routine
  machine.step(); // restart: restores original memory (bit clear), then re-asserts it

  expect(machine.memory.readByte(HeaderOffset.Flags1) & 0x08).toBe(0x08);
});

// --- execution: read_char (single keystroke) -------------------------------

test("read_char blocks awaiting a single keystroke, and provideChar delivers it", () => {
  const machine = new Machine(
    buildStory(0x100, (bytes) => {
      bytes[HeaderOffset.Version] = 4; // read_char is a v4+ opcode
      bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
      bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
      bytes[HeaderOffset.GlobalVariablesTableAddress] = (GLOBALS >> 8) & 0xff;
      bytes[HeaderOffset.GlobalVariablesTableAddress + 1] = GLOBALS & 0xff;
      // read_char 1 -> G_FIRST ; quit
      // 0xf6 = VAR read_char; 0x7f = one small-constant operand then three omitted.
      bytes.set([0xf6, 0x7f, 0x01, G_FIRST, ...quitInsn()], MAIN);
    }),
  );

  expect(machine.run()).toBe(RunState.WaitingForInput);
  expect(machine.awaitingCharInput).toBe(true);

  machine.provideChar("x");

  expect(machine.awaitingCharInput).toBe(false);
  expect(machine.run()).toBe(RunState.Halted);
  expect(machine.memory.readWord(GLOBALS)).toBe("x".charCodeAt(0)); // 'x' = 120
});
