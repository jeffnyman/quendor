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

test("run() is a no-op while WaitingForInput, so a debugger 'continue' can't skip the read", () => {
  const machine = new Machine(buildReadProgram());

  expect(machine.run()).toBe(RunState.WaitingForInput); // blocked on sread

  const before = machine.instructionCount;

  // A bare run() (e.g. `c` typed at the prompt) must not step past the unfinished
  // read: it returns WaitingForInput without executing an instruction.
  expect(machine.run()).toBe(RunState.WaitingForInput);
  expect(machine.instructionCount).toBe(before);

  // The read still completes normally once input is provided.
  machine.provideInput("open door");
  expect(readAsciiz(machine, TEXTBUF + 1)).toBe("open door");
});

// --- execution: tokenize ---------------------------------------------------
//
// tokenize (v5+) re-lexes an already-filled text buffer into a parse buffer
// against a dictionary -- the same lexing sread does, but on demand (games
// re-parse against alternate dictionaries). The v5 text buffer is length-
// prefixed (byte 1 = length, text from byte 2) and v4+ dictionary words are
// 6-byte (9 z-char) encodings, so this needs its own harness rather than
// buildReadProgram's v3 one. The text buffer is pre-filled, so nothing blocks.

/** Encode a word as a v4+ dictionary entry: 9 z-chars packed into 3 words. */
function dictWordBytesV4(word: string): number[] {
  const zchars = Array.from(word.slice(0, 9)).map((c) => 6 + (c.charCodeAt(0) - "a".charCodeAt(0)));

  while (zchars.length < 9) zchars.push(5); // pad with a harmless shift

  const words = [0, 1, 2].map((w) => {
    const i = w * 3;
    return (zchars[i] << 10) | (zchars[i + 1] << 5) | zchars[i + 2];
  });

  words[2] |= 0x8000; // terminator bit on the final word

  return words.flatMap((w) => [(w >> 8) & 0xff, w & 0xff]);
}

/** A v5 story: `tokenize TEXTBUF PARSEBUF; ret 0`, text buffer pre-filled with
 *  "open door", against a two-word (6-byte-entry) dictionary of "door", "open". */
function buildTokenizeProgram(): Story {
  const bytes = new Uint8Array(0x100);

  bytes[HeaderOffset.Version] = 5;
  bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
  bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
  bytes[HeaderOffset.DictionaryAddress] = (DICT >> 8) & 0xff;
  bytes[HeaderOffset.DictionaryAddress + 1] = DICT & 0xff;

  // tokenize #TEXTBUF #PARSEBUF (VAR 0xfb, two small-constant operands); then ret 0
  bytes.set([0xfb, 0x5f, TEXTBUF, PARSEBUF, 0x9b, 0x00], MAIN);

  const input = "open door";
  bytes[TEXTBUF] = 20; // max input length
  bytes[TEXTBUF + 1] = input.length; // v5 length prefix
  bytes.set(
    Array.from(input).map((c) => c.charCodeAt(0)),
    TEXTBUF + 2,
  );
  bytes[PARSEBUF] = 5; // max parsed words

  // dictionary: 0 separators, 6-byte entries, 2 sorted entries (door < open)
  bytes[DICT] = 0;
  bytes[DICT + 1] = 6;
  bytes[DICT + 2] = 0x00;
  bytes[DICT + 3] = 0x02;
  bytes.set([...dictWordBytesV4("door"), ...dictWordBytesV4("open")], DICT_BASE);

  return new Story(bytes);
}

test("tokenize lexes a pre-filled text buffer into the parse buffer", () => {
  const machine = new Machine(buildTokenizeProgram());

  machine.run();

  // parse buffer: [maxWords][count][entryAddr, length, textPosition] * count.
  // Text positions use the v5 offset of 2 (past the max/length prefix bytes).
  expect(machine.memory.readByte(PARSEBUF + 1)).toBe(2);

  // token 0 "open" -> second entry (6-byte entries), length 4, at text position 2
  expect(machine.memory.readWord(PARSEBUF + 2)).toBe(DICT_BASE + 6);
  expect(machine.memory.readByte(PARSEBUF + 4)).toBe(4);
  expect(machine.memory.readByte(PARSEBUF + 5)).toBe(2);

  // token 1 "door" -> first entry, length 4, at text position 7
  expect(machine.memory.readWord(PARSEBUF + 6)).toBe(DICT_BASE);
  expect(machine.memory.readByte(PARSEBUF + 8)).toBe(4);
  expect(machine.memory.readByte(PARSEBUF + 9)).toBe(7);
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

test("provideKey delivers a raw ZSCII code to a pending read_char", () => {
  const machine = new Machine(
    buildStory(0x100, (bytes) => {
      bytes[HeaderOffset.Version] = 4;
      bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
      bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
      bytes[HeaderOffset.GlobalVariablesTableAddress] = (GLOBALS >> 8) & 0xff;
      bytes[HeaderOffset.GlobalVariablesTableAddress + 1] = GLOBALS & 0xff;
      // read_char 1 -> G_FIRST ; quit
      bytes.set([0xf6, 0x7f, 0x01, G_FIRST, ...quitInsn()], MAIN);
    }),
  );

  expect(machine.run()).toBe(RunState.WaitingForInput);
  expect(machine.awaitingCharInput).toBe(true);

  machine.provideKey(0x81); // ZSCII 129 (cursor up) — a raw, non-ASCII key

  expect(machine.awaitingCharInput).toBe(false);
  expect(machine.run()).toBe(RunState.Halted);
  expect(machine.memory.readWord(GLOBALS)).toBe(0x81);
});

test("provideKey is a no-op when the machine isn't awaiting a keystroke", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 4;
    }),
  );

  machine.provideKey(65); // nothing pending — should do nothing
  expect(machine.awaitingCharInput).toBe(false);
});

test("globalAddress returns the byte address of a global variable", () => {
  const base = 0x0400;
  const machine = new Machine(
    buildStory(0x600, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
      // global variables table pointer (0x0c, word)
      bytes[HeaderOffset.GlobalVariablesTableAddress] = (base >> 8) & 0xff;
      bytes[HeaderOffset.GlobalVariablesTableAddress + 1] = base & 0xff;
    }),
  );

  expect(machine.globalAddress(0)).toBe(base);
  expect(machine.globalAddress(1)).toBe(base + 2);
  expect(machine.globalAddress(5)).toBe(base + 10);
});

// show_status (0OP 0x0c) => 0xb0 | 0x0c. In v3 it draws the status bar from
// globals 0 (location object), 1 and 2 (score/moves, or hours/mins).
const SHOW_STATUS = 0xbc;

test("show_status draws a v3 score bar from the score and moves globals", () => {
  const machine = new Machine(
    buildStory(0x100, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
      bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
      bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
      bytes[HeaderOffset.GlobalVariablesTableAddress] = (GLOBALS >> 8) & 0xff;
      bytes[HeaderOffset.GlobalVariablesTableAddress + 1] = GLOBALS & 0xff;

      // global 0 = location 0 (none); global 1 = score 42; global 2 = moves 7
      bytes[GLOBALS + 3] = 42;
      bytes[GLOBALS + 5] = 7;

      bytes.set([SHOW_STATUS, ...quitInsn()], MAIN);
    }),
  );

  expect(machine.run()).toBe(RunState.Halted);
  expect(machine.screen.statusLine).toContain("Score: 42");
  expect(machine.screen.statusLine).toContain("Moves: 7");
});

test("show_status draws a time bar when Flags 1 marks a time game", () => {
  const machine = new Machine(
    buildStory(0x100, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
      bytes[0x01] = 0x02; // Flags 1, bit 1: status line shows hours:minutes
      bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
      bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
      bytes[HeaderOffset.GlobalVariablesTableAddress] = (GLOBALS >> 8) & 0xff;
      bytes[HeaderOffset.GlobalVariablesTableAddress + 1] = GLOBALS & 0xff;

      // global 1 = hours 13; global 2 = minutes 5
      bytes[GLOBALS + 3] = 13;
      bytes[GLOBALS + 5] = 5;

      bytes.set([SHOW_STATUS, ...quitInsn()], MAIN);
    }),
  );

  expect(machine.run()).toBe(RunState.Halted);
  expect(machine.screen.statusLine).toContain("Time: 13:05");
});

// --- debugger / inspection API ---------------------------------------------

test("readMemoryByte and readMemoryWord read raw memory (big-endian word)", () => {
  const machine = new Machine(
    buildStory(0x100, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
      bytes[0x50] = 0xab;
      bytes[0x51] = 0xcd;
    }),
  );

  expect(machine.readMemoryByte(0x50)).toBe(0xab);
  expect(machine.readMemoryWord(0x50)).toBe(0xabcd);
});

test("decodeAt decodes the instruction at a given address", () => {
  const machine = new Machine(
    buildStory(0x100, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
      bytes[0x40] = 0xba; // 0OP quit
    }),
  );

  expect(machine.decodeAt(0x40).opcode.name).toBe("quit");
});

test("unpackRoutineAddress unpacks a v3 packed routine address (x2)", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
    }),
  );

  expect(machine.unpackRoutineAddress(0x40)).toBe(0x80);
});

test("getGlobals returns all 240 global values", () => {
  const machine = new Machine(
    buildStory(0x400, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
      bytes[HeaderOffset.GlobalVariablesTableAddress] = (GLOBALS >> 8) & 0xff;
      bytes[HeaderOffset.GlobalVariablesTableAddress + 1] = GLOBALS & 0xff;
      bytes[GLOBALS + 2] = 0x12; // global 1, high byte
      bytes[GLOBALS + 3] = 0x34; // global 1, low byte
    }),
  );

  const globals = machine.getGlobals();
  expect(globals).toHaveLength(240);
  expect(globals[1]).toBe(0x1234);
});

test("addWatchpoint, watchWord, and removeWatchpoint manage the watch set", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
    }),
  );

  machine.addWatchpoint(0x10);
  expect(machine.watchpoints.has(0x10)).toBe(true);

  machine.watchWord(0x20); // watches both bytes of the word
  expect(machine.watchpoints.has(0x20)).toBe(true);
  expect(machine.watchpoints.has(0x21)).toBe(true);

  machine.removeWatchpoint(0x10);
  expect(machine.watchpoints.has(0x10)).toBe(false);
});

test("getLocals, getCallStack, and getEvalStack reflect the current routine after a call", () => {
  const machine = new Machine(
    buildProgram(
      [...callInsn(ROUTINE_PACKED, [0x1234], G_FIRST), ...retConst(0)],
      routine([0x0000], retVar(0x01)),
    ),
  );

  machine.step(); // execute the call — now inside the routine

  expect(machine.getLocals()).toEqual([0x1234]); // arg mapped to local 1
  expect(machine.getEvalStack()).toEqual([]); // nothing pushed yet

  const stack = machine.getCallStack();
  expect(stack).toHaveLength(2); // routine (innermost) + main
  expect(stack[0].routineAddress).toBe(ROUTINE);
});

test("pendingInputKind is null when running and 'char' while blocked on read_char", () => {
  const machine = new Machine(
    buildStory(0x100, (bytes) => {
      bytes[HeaderOffset.Version] = 4;
      bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
      bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
      bytes.set([0xf6, 0x7f, 0x01, G_FIRST, ...quitInsn()], MAIN);
    }),
  );

  expect(machine.pendingInputKind).toBeNull();

  machine.run();

  expect(machine.pendingInputKind).toBe("char");
});

test("a watchpoint pauses the machine when a watched location changes", () => {
  const machine = new Machine(buildProgram([...storeInsn(G_FIRST, 0x00ff), ...quitInsn()]));
  machine.watchWord(machine.globalAddress(0)); // watch global 0 (both bytes)

  expect(machine.run()).toBe(RunState.Paused);
  expect(machine.lastWatchHit).not.toBeNull();
  expect(machine.lastWatchHit?.newValue).toBe(0xff);
});

// --- execution: scan_table -------------------------------------------------

// scan_table (VAR:0x17 -> opcode byte 0xf7) searches a table for a value.
// Operands: value, table, length (word-sized, step 2 by default).
function scanTableInsn(
  value: number,
  table: number,
  length: number,
  store: number,
  branch: number,
): number[] {
  return [
    0xf7,
    0x03, // three large-constant operands, then omitted
    (value >> 8) & 0xff,
    value & 0xff,
    (table >> 8) & 0xff,
    table & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
    store & 0xff,
    branch & 0xff,
  ];
}

/** A v4 story with a 3-word table at 0x70 and a scan_table program at MAIN. */
function buildScanStory(value: number): Story {
  const TABLE = 0x70;
  const bytes = new Uint8Array(0x100);

  bytes[HeaderOffset.Version] = 4; // scan_table is v4+
  bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
  bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
  bytes[HeaderOffset.GlobalVariablesTableAddress] = (GLOBALS >> 8) & 0xff;
  bytes[HeaderOffset.GlobalVariablesTableAddress + 1] = GLOBALS & 0xff;

  bytes.set([0x00, 0x01, 0x00, 0x02, 0x00, 0x03], TABLE); // words 1, 2, 3
  bytes.set([...scanTableInsn(value, TABLE, 3, G_FIRST, BRANCH_CONTINUE), ...quitInsn()], MAIN);

  return new Story(bytes);
}

test("scan_table stores the address of a value it finds", () => {
  const machine = new Machine(buildScanStory(0x0002));

  machine.run();

  expect(machine.readMemoryWord(GLOBALS)).toBe(0x72); // 0x0002 sits at table + 2
});

test("scan_table stores 0 when the value isn't in the table", () => {
  const machine = new Machine(buildScanStory(0x0099));

  machine.run();

  expect(machine.readMemoryWord(GLOBALS)).toBe(0);
});

// --- execution: restore failure paths --------------------------------------

test("restore fails gracefully when onRestore throws", () => {
  const machine = new Machine(buildSaveProgram([...restoreInsn(BRANCH_CONTINUE), ...quitInsn()]));
  machine.onRestore = (): Uint8Array | null => {
    throw new Error("io error");
  };

  // The error is caught, restore reports failure (branch not taken), we quit.
  expect(machine.run()).toBe(RunState.Halted);
});

test("restore fails gracefully when the blob isn't valid Quetzal", () => {
  const machine = new Machine(buildSaveProgram([...restoreInsn(BRANCH_CONTINUE), ...quitInsn()]));
  machine.onRestore = (): Uint8Array | null => new Uint8Array([1, 2, 3, 4]); // not IFZS

  expect(machine.run()).toBe(RunState.Halted); // decode threw, caught, fell through
});

test("restore rejects a save whose header doesn't match this story", () => {
  // Story A saves and hands us the blob.
  let blob: Uint8Array | null = null;
  const a = new Machine(
    buildSaveProgram([...storeInsn(G_FIRST, 0x11), ...saveInsn(BRANCH_CONTINUE), ...quitInsn()]),
  );
  a.onSave = (data): boolean => {
    blob = data;
    return true;
  };
  a.run();
  expect(blob).not.toBeNull();

  // Story B is a *different* release (2 vs A's 0) trying to load A's save.
  const bBytes = new Uint8Array(0x100);
  bBytes[HeaderOffset.Version] = 3;
  bBytes[0x03] = 0x02; // release word (0x02, big-endian) = 2
  bBytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
  bBytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
  bBytes[HeaderOffset.StaticMemoryBase] = (0x100 >> 8) & 0xff;
  bBytes[HeaderOffset.StaticMemoryBase + 1] = 0x100 & 0xff;
  bBytes.set([...restoreInsn(BRANCH_CONTINUE), ...quitInsn()], MAIN);

  const b = new Machine(new Story(bBytes));
  b.onRestore = (): Uint8Array | null => blob;

  // Release mismatch -> restore rejected (branch not taken) -> quit.
  expect(b.run()).toBe(RunState.Halted);
});

// --- execution: long-form branch encoding ----------------------------------
//
// applyBranchAt (used for save/restore's v1-3 branch result) is the one branch
// decoder reached with the raw branch byte from memory, so its two-byte
// long-form path is exercised by giving save/restore a long-form branch.

test("applyBranchAt takes a long-form (two-byte) save branch", () => {
  // save with a two-byte on-true branch (bit 0x40 clear), offset 5: on success
  // it jumps over the store to the quit, so the store never runs.
  const machine = new Machine(
    buildSaveProgram([
      0xb5,
      0x80,
      0x05, // save ?<long, on-true, offset 5>
      ...storeInsn(G_FIRST, 0xff), // skipped when save succeeds and branches
      ...quitInsn(),
    ]),
  );
  machine.onSave = (): boolean => true;

  machine.run();

  expect(machine.readMemoryWord(GLOBALS)).toBe(0); // store was jumped over
});

test("applyBranchAt sign-extends a negative long-form branch offset", () => {
  // restore with a two-byte offset 0x3ffe (-2). onRestore yields null, so the
  // branch isn't taken -- but the negative offset still decodes without looping.
  const machine = new Machine(
    buildSaveProgram([
      0xb6,
      0xbf,
      0xfe, // restore ?<long, on-true, offset -2>
      ...quitInsn(),
    ]),
  );
  machine.onRestore = (): Uint8Array | null => null;

  expect(machine.run()).toBe(RunState.Halted); // not taken -> fell through to quit
});

// --- execution: v4/v5 save/restore (store form) ----------------------------
//
// v1-3 save/restore branch on their result; v4+ store it (0 = failed, 1 = just
// saved, 2 = just restored). v4 keeps the 0OP opcodes (0xb5/0xb6) but in store
// form; v5 moves them to the extended opcodes save (EXT:0x00) and restore
// (EXT:0x01), each here with no operands (types byte 0xff) and a store byte.
// All memory is dynamic so restore's memory revert is observable.

const G_SECOND = 0x11; // variable number of the second global (address GLOBALS + 2)

function buildStoreSaveProgram(version: number, main: number[]): Story {
  const bytes = new Uint8Array(0x100);

  bytes[HeaderOffset.Version] = version;
  bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
  bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
  bytes[HeaderOffset.GlobalVariablesTableAddress] = (GLOBALS >> 8) & 0xff;
  bytes[HeaderOffset.GlobalVariablesTableAddress + 1] = GLOBALS & 0xff;
  bytes[HeaderOffset.StaticMemoryBase] = (0x100 >> 8) & 0xff; // all memory dynamic
  bytes[HeaderOffset.StaticMemoryBase + 1] = 0x100 & 0xff;

  bytes.set(main, MAIN);

  return new Story(bytes);
}

test("v4 save stores its result via the 0OP save opcode", () => {
  const machine = new Machine(
    buildStoreSaveProgram(4, [0xb5, G_FIRST, ...quitInsn()]), // 0OP save -> global 0
  );
  machine.onSave = (): boolean => true;

  machine.run();

  expect(machine.readMemoryWord(GLOBALS)).toBe(1); // 1 = just saved
});

test("v5 save stores its result via the EXT save opcode", () => {
  const machine = new Machine(
    buildStoreSaveProgram(5, [0xbe, 0x00, 0xff, G_FIRST, ...quitInsn()]), // EXT save -> global 0
  );
  machine.onSave = (): boolean => true;

  machine.run();

  expect(machine.readMemoryWord(GLOBALS)).toBe(1); // 1 = just saved
});

test("v5 save/restore round-trips through the EXT opcodes", () => {
  // store 0x11; save -> G_SECOND; if the result is 2 (just restored) skip to
  // quit; else mutate to 0x22 and restore. restore reverts memory and resumes
  // right after the save with result 2, so the je then jumps to quit.
  const machine = new Machine(
    buildStoreSaveProgram(5, [
      ...storeInsn(G_FIRST, 0x11), // MAIN+0:  state = 0x11
      0xbe,
      0x00,
      0xff,
      G_SECOND, // MAIN+3:  save -> G_SECOND (store byte @ MAIN+6)
      0x41,
      G_SECOND,
      0x02,
      0xc9, // MAIN+7:  je G_SECOND, #2 ?<on-true, offset 9 -> quit>
      ...storeInsn(G_FIRST, 0x22), // MAIN+11: mutate state
      0xbe,
      0x01,
      0xff,
      G_SECOND, // MAIN+14: restore -> G_SECOND
      ...quitInsn(), // MAIN+18: quit
    ]),
  );

  let blob: Uint8Array | null = null;
  machine.onSave = (data): boolean => {
    blob = data;
    return true;
  };
  machine.onRestore = (): Uint8Array | null => blob;

  machine.run();

  expect(machine.readMemoryWord(GLOBALS)).toBe(0x11); // memory reverted to the save point
  expect(machine.readMemoryWord(GLOBALS + 2)).toBe(2); // restore stored result 2
});

// --- execution: save_undo / restore_undo (EXT opcodes, in-memory) -----------
//
// save_undo (EXT:0x09) / restore_undo (EXT:0x0a) mirror save/restore but keep
// the snapshot in an in-memory history rather than going through a host file
// callback, so no onSave/onRestore is needed. Result convention matches save:
// 0 = failed/unavailable, 1 = just saved, 2 = just restored.

test("save_undo snapshots state and stores success", () => {
  const machine = new Machine(
    buildStoreSaveProgram(5, [0xbe, 0x09, 0xff, G_FIRST, ...quitInsn()]), // EXT save_undo -> global 0
  );

  machine.run();

  expect(machine.readMemoryWord(GLOBALS)).toBe(1); // 1 = snapshot taken
});

test("restore_undo stores 0 when there's nothing to undo", () => {
  const machine = new Machine(
    buildStoreSaveProgram(5, [0xbe, 0x0a, 0xff, G_FIRST, ...quitInsn()]), // EXT restore_undo -> global 0
  );

  machine.run();

  expect(machine.readMemoryWord(GLOBALS)).toBe(0); // empty history -> failure
});

test("save_undo/restore_undo round-trips in memory", () => {
  // Same control flow as the v5 save/restore round-trip, but the snapshot lives
  // in memory: store 0x11; save_undo; mutate to 0x22; restore_undo reverts memory
  // and resumes right after the save_undo with result 2, so the je jumps to quit.
  const machine = new Machine(
    buildStoreSaveProgram(5, [
      ...storeInsn(G_FIRST, 0x11), // MAIN+0:  state = 0x11
      0xbe,
      0x09,
      0xff,
      G_SECOND, // MAIN+3:  save_undo -> G_SECOND (store byte @ MAIN+6)
      0x41,
      G_SECOND,
      0x02,
      0xc9, // MAIN+7:  je G_SECOND, #2 ?<on-true, offset 9 -> quit>
      ...storeInsn(G_FIRST, 0x22), // MAIN+11: mutate state
      0xbe,
      0x0a,
      0xff,
      G_SECOND, // MAIN+14: restore_undo -> G_SECOND
      ...quitInsn(), // MAIN+18: quit
    ]),
  );

  machine.run();

  expect(machine.readMemoryWord(GLOBALS)).toBe(0x11); // memory reverted to the save_undo point
  expect(machine.readMemoryWord(GLOBALS + 2)).toBe(2); // restore_undo stored result 2
});
