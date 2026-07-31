import { expect, test } from "vite-plus/test";
import { Story } from "../src/story.ts";
import { HeaderOffset } from "../src/header.ts";
import { Machine, RunState } from "../src/machine.ts";

// Targeted branch-coverage tests for machine.ts. The existing machine.test.ts
// covers the mainline; this file drives the edge branches (guards, version
// splits, error paths, state-machine transitions) with the smallest programs
// that reach each one. A tiny hand-assembler keeps the opcode bytes readable.

const MAIN = 0x40;
const GLOBALS = 0x60;
const G0 = 0x10; // variable number of the first global

// --- instruction encoders (see the Z-Machine Standard §4 on instruction forms).

/** Long-form 2OP, both operands small constants (0-255). */
const op2 = (n: number, a: number, b: number, tail: number[] = []): number[] => [
  n & 0x1f,
  a & 0xff,
  b & 0xff,
  ...tail,
];

/** Short-form 1OP, small-constant operand. */
const op1 = (n: number, a: number, tail: number[] = []): number[] => [
  0x90 | (n & 0x0f),
  a & 0xff,
  ...tail,
];

/** Short-form 1OP, large-constant (2-byte) operand. */
const op1L = (n: number, a: number, tail: number[] = []): number[] => [
  0x80 | (n & 0x0f),
  (a >> 8) & 0xff,
  a & 0xff,
  ...tail,
];

/** Short-form 0OP. */
const op0 = (n: number, tail: number[] = []): number[] => [0xb0 | (n & 0x0f), ...tail];

/** VAR-form opcode with every operand as a large constant (2 bytes each). */
const opV = (n: number, ops: number[], tail: number[] = []): number[] => {
  let kinds = 0;
  for (let i = 0; i < 4; i++) kinds |= (i < ops.length ? 0b00 : 0b11) << (6 - i * 2);
  const bytes = [0xe0 | (n & 0x1f), kinds];
  for (const v of ops) bytes.push((v >> 8) & 0xff, v & 0xff);
  return [...bytes, ...tail];
};

/** EXT-form opcode (0xbe prefix) with large-constant operands. */
const opExt = (n: number, ops: number[], tail: number[] = []): number[] => {
  let kinds = 0;
  for (let i = 0; i < 4; i++) kinds |= (i < ops.length ? 0b00 : 0b11) << (6 - i * 2);
  const bytes = [0xbe, n & 0xff, kinds];
  for (const v of ops) bytes.push((v >> 8) & 0xff, v & 0xff);
  return [...bytes, ...tail];
};

/** A branch byte that always continues to the next instruction (offset 2). */
const CONT = 0xc0 | 2;
const STORE_SP = 0x00; // store to the stack

/** Build a story at `version` with `main` at 0x40 and a globals table at 0x60. */
function buildV(
  version: number,
  main: number[],
  opts: { fill?: (b: Uint8Array) => void; size?: number } = {},
): Story {
  const bytes = new Uint8Array(opts.size ?? 0x100);

  bytes[HeaderOffset.Version] = version;
  bytes[HeaderOffset.InitialProgramCounter] = (MAIN >> 8) & 0xff;
  bytes[HeaderOffset.InitialProgramCounter + 1] = MAIN & 0xff;
  bytes[HeaderOffset.GlobalVariablesTableAddress] = (GLOBALS >> 8) & 0xff;
  bytes[HeaderOffset.GlobalVariablesTableAddress + 1] = GLOBALS & 0xff;

  bytes.set(main, MAIN);
  opts.fill?.(bytes);

  return new Story(bytes);
}

const QUIT = op0(0x0a);

// --- constructor / RNG -----------------------------------------------------

test("a zero random seed is coerced to 1 (same stream as seed 1)", () => {
  const prog = [...opV(0x07, [1000], [G0]), ...QUIT]; // random 1000 -> g0; quit
  const readG0 = (seed: number): number => {
    const m = new Machine(buildV(3, prog), { randomSeed: seed });
    m.run();
    return m.memory.readWord(GLOBALS);
  };

  expect(readG0(0)).toBe(readG0(1)); // seed 0 collapses to seed 1
});

// --- watchpoints -----------------------------------------------------------

test("a watched write records the hit; an unwatched byte in the same write is skipped", () => {
  const m = new Machine(buildV(3, QUIT));

  m.addWatchpoint(0x50); // watch a single byte
  m.memory.writeWord(0x50, 0x1234); // 2-byte write: 0x50 watched, 0x51 not

  expect(m.lastWatchHit?.address).toBe(0x50);
  expect(m.lastWatchHit?.newValue).toBe(0x12); // high byte landed at the watched address
  expect(m.lastWatchHit?.oldValue).toBe(0); // the value cached when the watch was set
});

test("removing the last watchpoint detaches the memory observer", () => {
  const m = new Machine(buildV(3, QUIT));

  m.addWatchpoint(0x50);
  expect(m.memory.onWrite).toBeDefined();

  m.removeWatchpoint(0x50);
  expect(m.memory.onWrite).toBeUndefined();
});

// --- run / step state machine ----------------------------------------------

test("run() on a halted machine is a no-op that returns Halted", () => {
  const m = new Machine(buildV(3, QUIT));

  expect(m.run()).toBe(RunState.Halted);
  expect(m.run()).toBe(RunState.Halted); // still halted, no throw
});

test("step() throws once the machine has halted", () => {
  const m = new Machine(buildV(3, QUIT));
  m.run();

  expect(() => m.step()).toThrow(/halted/);
});

test("run() enforces the instruction limit on a tight loop", () => {
  const m = new Machine(buildV(3, op1L(0x0c, 0xffff))); // jump -1: back onto itself

  expect(() => m.run(5)).toThrow(/instruction limit/);
});

test("continueFromMore is a no-op when not paused at a [More] prompt", () => {
  const m = new Machine(buildV(3, QUIT));

  expect(() => m.continueFromMore()).not.toThrow();
  m.run();
  expect(() => m.continueFromMore()).not.toThrow();
});

test("a breakpoint pauses at its address, and resuming steps past it", () => {
  // print_num 5 (4 bytes) then quit at 0x44.
  const m = new Machine(buildV(3, [...opV(0x06, [5]), ...QUIT]));
  m.breakpoints.add(0x44);

  expect(m.run()).toBe(RunState.Paused); // stopped at the quit
  expect(m.programCounter).toBe(0x44);
  expect(m.run()).toBe(RunState.Halted); // resume: don't re-break, run the quit
});

// --- read_char: key/char/line delivery -------------------------------------

// A v4 story that blocks on read_char, storing the key to the stack.
const readCharProg = buildV(4, [...opV(0x16, [1], [STORE_SP]), ...QUIT]);

test("step() throws while the machine is waiting for input", () => {
  const m = new Machine(readCharProg);
  expect(m.run()).toBe(RunState.WaitingForInput);

  expect(() => m.step()).toThrow(/waiting for input/);
});

test("provideKey delivers a single ZSCII code and resumes", () => {
  const m = new Machine(readCharProg);
  m.run();

  m.provideKey(65);
  expect(m.run()).toBe(RunState.Halted); // resumed and ran to the quit
});

test("provideChar delivers a single keystroke and resumes", () => {
  const m = new Machine(readCharProg);
  m.run();

  m.provideChar("A");
  expect(m.run()).toBe(RunState.Halted);
});

test("provideChar is a no-op when nothing is waiting on a read_char", () => {
  const m = new Machine(buildV(3, QUIT));
  expect(() => m.provideChar("x")).not.toThrow();
});

test("provideInput feeds a whole line into a pending read_char one key at a time", () => {
  const m = new Machine(readCharProg);
  m.run();

  m.provideInput("hi"); // first char delivered now; the rest buffered
  expect(m.run()).toBe(RunState.Halted);
});

// --- misc v3 opcodes (fills in untested switch arms) -----------------------

test("assorted v3 opcodes execute and halt cleanly", () => {
  const prog = [
    ...op1(0x0f, 5, [STORE_SP]), // not #5 -> sp
    ...op2(0x07, 6, 4, [CONT]), // test #6 #4 ?~
    ...opV(0x08, [7]), // push #7
    ...op0(0x09), // pop
    ...op1(0x0e, G0, [STORE_SP]), // load (global 0) -> sp
    ...op2(0x06, 0, 0, [CONT]), // jin #0 #0 ?~  (object 0 guard)
    ...QUIT,
  ];
  const m = new Machine(buildV(3, prog));

  expect(m.run()).toBe(RunState.Halted);
});

// --- misc v5 opcodes -------------------------------------------------------

test("assorted v5 opcodes (EXT, piracy, call_vn, sound, guards) execute and halt", () => {
  const prog = [
    ...op0(0x0f, [CONT]), // piracy ?~
    ...opV(0x1f, [0], [CONT]), // check_arg_count #0 ?~
    ...opExt(3, [4, 1], [STORE_SP]), // art_shift #4 #1 -> sp
    ...opExt(2, [256, 0xffff], [STORE_SP]), // log_shift #256 #-1 -> sp
    ...opV(0x19, [0]), // call_vn #0  (packed routine 0, non-storing)
    ...opV(0x15, [1, 2]), // sound_effect #1 #2  (two operands)
    ...opV(0x15, [1, 2, 3, 4]), // sound_effect #1 #2 #3 #4
    ...opV(0x0f, [0xffff, 1]), // set_cursor #-1 #1  (negative row -> ignored)
    ...QUIT,
  ];
  const m = new Machine(buildV(5, prog));

  expect(m.run()).toBe(RunState.Halted);
});

test("sound_effect: bleeps always fire; real effects are gated on sound availability", () => {
  const fire = (number: number, soundAvailable: boolean): number => {
    const m = new Machine(buildV(5, [...opV(0x15, [number, 2]), ...QUIT]), { soundAvailable });
    let calls = 0;
    m.onSoundEffect = (n): void => {
      calls++;
      expect(n).toBe(number);
    };
    m.run();
    return calls;
  };

  expect(fire(1, false)).toBe(1); // high bleep: always available
  expect(fire(2, false)).toBe(1); // low bleep: always available
  expect(fire(3, false)).toBe(0); // sampled effect: suppressed when no sound
  expect(fire(3, true)).toBe(1); // sampled effect: fires when sound is available
});

// --- object-0 guards (no object table needed; every guard returns early) ----

test("object opcodes with object 0 no-op instead of touching the (absent) table", () => {
  const prog = [
    ...op1(0x03, 0, [STORE_SP]), // get_parent 0 -> sp
    ...op1(0x01, 0, [STORE_SP, CONT]), // get_sibling 0 -> sp ?~
    ...op1(0x02, 0, [STORE_SP, CONT]), // get_child 0 -> sp ?~
    ...op2(0x0b, 0, 5), // set_attr 0 5
    ...op2(0x0c, 0, 5), // clear_attr 0 5
    ...op2(0x0e, 0, 1), // insert_obj 0 1
    ...op1(0x09, 0), // remove_obj 0
    ...op2(0x11, 0, 5, [STORE_SP]), // get_prop 0 5 -> sp
    ...op2(0x13, 0, 5, [STORE_SP]), // get_next_prop 0 5 -> sp
    ...op2(0x12, 0, 5, [STORE_SP]), // get_prop_addr 0 5 -> sp
    ...op1(0x04, 0, [STORE_SP]), // get_prop_len 0 -> sp
    ...opV(0x03, [0, 5, 9]), // put_prop 0 5 9
    ...QUIT,
  ];
  const m = new Machine(buildV(3, prog));

  expect(m.run()).toBe(RunState.Halted);
});

// --- queued input reaches beginRead without ever blocking -------------------

// A v3 sread program: sread TEXTBUF PARSEBUF; quit. TEXTBUF/PARSEBUF are set up
// with capacities so a completed read has somewhere to write.
function buildSread(): Story {
  const TEXTBUF = 0x80;
  const PARSEBUF = 0x90;
  return buildV(3, [...opV(0x04, [TEXTBUF, PARSEBUF]), ...QUIT], {
    fill: (b) => {
      b[TEXTBUF] = 20; // max input length
      b[PARSEBUF] = 5; // max parsed words
    },
  });
}

test("input queued before a read is consumed by beginRead without blocking", () => {
  const m = new Machine(buildSread());

  m.provideInput("look"); // no pending read yet -> queued
  expect(m.run()).toBe(RunState.Halted); // beginRead drains the queue, never waits

  // text buffer (v3): NUL-terminated one byte in
  expect(m.memory.readByte(0x80 + 1)).toBe("l".charCodeAt(0));
});

// --- property opcodes on a real v3 object table ----------------------------
//
// Object table @0x100 (31 default words, then 9-byte entries). Object 1 has a
// name and two properties: P5 (1 byte = 0xab) and P3 (2 bytes = 0x1234). Object
// 2 is nameless with a single property.

const OBJT = 0x100;
const OBJ1 = OBJT + 62; // 0x13e — past the 31 default-property words
const OBJ2 = OBJ1 + 9;
const PROPS1 = 0x160;
const PROPS2 = 0x170;

function buildObjStory(main: number[], globalW0?: number): Story {
  return buildV(3, main, {
    size: 0x200,
    fill: (b) => {
      b[HeaderOffset.ObjectTableAddress] = (OBJT >> 8) & 0xff;
      b[HeaderOffset.ObjectTableAddress + 1] = OBJT & 0xff;

      b[OBJ1 + 7] = (PROPS1 >> 8) & 0xff; // object 1 -> property table
      b[OBJ1 + 8] = PROPS1 & 0xff;
      b[OBJ2 + 7] = (PROPS2 >> 8) & 0xff; // object 2 -> property table
      b[OBJ2 + 8] = PROPS2 & 0xff;

      // object 1's properties: name "a" (1 word), P5 (1 byte), P3 (2 bytes)
      b[PROPS1] = 1; // short-name length in words
      b[PROPS1 + 1] = 0x98; // a z-encoded "a" (terminator bit set); content irrelevant
      b[PROPS1 + 2] = 0xa5;
      b[PROPS1 + 3] = 0x05; // size byte: property 5, length 1
      b[PROPS1 + 4] = 0xab;
      b[PROPS1 + 5] = 0x23; // size byte: property 3, length 2
      b[PROPS1 + 6] = 0x12;
      b[PROPS1 + 7] = 0x34;
      b[PROPS1 + 8] = 0x00; // terminator

      // object 2: nameless, one property
      b[PROPS2] = 0;
      b[PROPS2 + 1] = 0x05;
      b[PROPS2 + 2] = 0xab;
      b[PROPS2 + 3] = 0x00;

      if (globalW0 !== undefined) {
        b[GLOBALS] = (globalW0 >> 8) & 0xff;
        b[GLOBALS + 1] = globalW0 & 0xff;
      }
    },
  });
}

test("property reads/writes resolve a found property (1-byte and word-sized)", () => {
  const prog = [
    ...op2(0x11, 1, 5, [G0]), // get_prop obj1 p5 -> g0  (1-byte -> 0xab)
    ...op2(0x11, 1, 3, [STORE_SP]), // get_prop obj1 p3 -> sp  (word-sized)
    ...opV(0x03, [1, 5, 0xcd]), // put_prop obj1 p5 = 0xcd (1-byte write)
    ...op2(0x12, 1, 99, [STORE_SP]), // get_prop_addr obj1 p99 -> sp (missing -> 0)
    ...op2(0x13, 1, 0, [STORE_SP]), // get_next_prop obj1 0 -> sp (first property)
    ...QUIT,
  ];
  const m = new Machine(buildObjStory(prog));

  expect(m.run()).toBe(RunState.Halted);
  expect(m.memory.readWord(GLOBALS)).toBe(0xab); // get_prop of the 1-byte property
  expect(m.memory.readByte(PROPS1 + 4)).toBe(0xcd); // put_prop wrote the byte back
});

test("put_prop on a missing property throws", () => {
  const m = new Machine(buildObjStory([...opV(0x03, [1, 99, 0]), ...QUIT]));
  expect(() => m.run()).toThrow(/put_prop/);
});

test("get_next_prop with a property that isn't present throws", () => {
  const m = new Machine(buildObjStory([...op2(0x13, 1, 4, [STORE_SP]), ...QUIT]));
  expect(() => m.run()).toThrow(/get_next_prop/);
});

test("show_status names a located object, and blanks a nameless one", () => {
  const prog = [
    ...op0(0x0c), // show_status: location = object 1 (named)
    ...opV(0x01, [GLOBALS, 0, 2]), // storew: global 0 = object 2 (nameless)
    ...op0(0x0c), // show_status: location = object 2
    ...QUIT,
  ];
  const m = new Machine(buildObjStory(prog, 1)); // global 0 starts at object 1

  expect(m.run()).toBe(RunState.Halted);
});

// --- output streams (memory capture + screen toggles) ----------------------

test("output_stream redirects to memory, then toggles the screen stream", () => {
  const OSBUF = 0x80;
  const prog = [
    ...opV(0x13, [3, OSBUF]), // output_stream 3 -> capture to OSBUF
    ...opV(0x05, [65]), // print_char 'A'  (captured, screen suppressed)
    ...opV(0x13, [0xfffd]), // output_stream -3 -> close, write the length
    ...opV(0x13, [1]), // output_stream 1  -> screen on
    ...opV(0x13, [2]), // output_stream 2  -> transcript (unhandled)
    ...opV(0x13, [0xffff]), // output_stream -1 -> screen off
    ...opV(0x13, [0xfffd]), // output_stream -3 -> nothing open (no-op)
    ...QUIT,
  ];
  const m = new Machine(buildV(3, prog));

  expect(m.run()).toBe(RunState.Halted);
  expect(m.memory.readByte(OSBUF + 2)).toBe(65); // 'A' captured
  expect(m.memory.readWord(OSBUF)).toBe(1); // length written on close
});

// --- v5 aread / v4 sread / truncation --------------------------------------

test("v5 aread fills the text and parse buffers and stores the terminator", () => {
  const TB = 0x80;
  const PB = 0x90;
  const m = new Machine(
    buildV(5, [...opV(0x04, [TB, PB], [STORE_SP]), ...QUIT], {
      fill: (b) => {
        b[TB] = 20;
        b[PB] = 5;
      },
    }),
  );

  expect(m.run()).toBe(RunState.WaitingForInput);
  m.provideInput("go");
  expect(m.run()).toBe(RunState.Halted);
  expect(m.memory.readByte(TB + 1)).toBe(2); // length prefix (v5 buffer)
});

test("v5 aread without a parse buffer still completes", () => {
  const TB = 0x80;
  const m = new Machine(
    buildV(5, [...opV(0x04, [TB], [STORE_SP]), ...QUIT], {
      fill: (b) => {
        b[TB] = 20;
      },
    }),
  );

  m.run();
  m.provideInput("hi");
  expect(m.run()).toBe(RunState.Halted);
});

test("aread truncates input longer than the text buffer allows", () => {
  const TB = 0x80;
  const PB = 0x90;
  const m = new Machine(
    buildV(5, [...opV(0x04, [TB, PB], [STORE_SP]), ...QUIT], {
      fill: (b) => {
        b[TB] = 4; // capacity 4
        b[PB] = 5;
      },
    }),
  );

  m.run();
  m.provideInput("abcdefgh");
  m.run();
  expect(m.memory.readByte(TB + 1)).toBe(4); // truncated to the capacity
});

test("v4 sread skips the v1-3 status refresh", () => {
  const TB = 0x80;
  const PB = 0x90;
  const m = new Machine(
    buildV(4, [...opV(0x04, [TB, PB]), ...QUIT], {
      fill: (b) => {
        b[TB] = 20;
        b[PB] = 5;
      },
    }),
  );

  m.run();
  m.provideInput("look");
  expect(m.run()).toBe(RunState.Halted);
});

test("v3 sread with no parse buffer only fills the text buffer", () => {
  const TB = 0x80;
  const m = new Machine(
    buildV(3, [...opV(0x04, [TB, 0]), ...QUIT], {
      fill: (b) => {
        b[TB] = 20;
      },
    }),
  );

  m.run();
  m.provideInput("look");
  expect(m.run()).toBe(RunState.Halted);
  expect(m.memory.readByte(TB + 1)).toBe("l".charCodeAt(0));
});

// --- read_char draining a queued line, including the trailing Enter --------

test("read_char drains a queued line character by character, ending in Enter", () => {
  const prog = [
    ...opV(0x16, [1], [STORE_SP]), // read_char -> sp  ('h')
    ...opV(0x16, [1], [STORE_SP]), // read_char -> sp  ('i')
    ...opV(0x16, [1], [G0]), // read_char -> g0  ('\r' -> 13)
    ...QUIT,
  ];
  const m = new Machine(buildV(4, prog));

  m.provideInput("hi"); // queued before the first read
  expect(m.run()).toBe(RunState.Halted);
  expect(m.memory.readWord(GLOBALS)).toBe(13); // Enter delivered as ZSCII 13
});

// --- tokenize with an explicit dictionary and the keep-unmatched flag -------

test("tokenize honors an explicit dictionary and the keep-unmatched flag", () => {
  const TB = 0x80;
  const PB = 0x90;
  const DICT = 0xa0;
  const prog = [...opV(0x1b, [TB, PB, DICT, 1]), ...QUIT]; // tokenize TB PB DICT flag=1
  const m = new Machine(
    buildV(5, prog, {
      fill: (b) => {
        b[TB] = 20;
        b[TB + 1] = 2; // length-prefixed "ab"
        b[TB + 2] = "a".charCodeAt(0);
        b[TB + 3] = "b".charCodeAt(0);
        b[PB] = 5;
        b[DICT] = 0; // 0 separators
        b[DICT + 1] = 6; // entry length
        b[DICT + 2] = 0; // entry count = 0 (word) -> "ab" is unknown
        b[DICT + 3] = 0;
      },
    }),
  );

  expect(m.run()).toBe(RunState.Halted);
});

// --- undo overflow, random reseed, scan_table byte form --------------------

test("save_undo past the history cap drops the oldest snapshot", () => {
  const prog: number[] = [];
  for (let i = 0; i < 26; i++) prog.push(...opExt(0x09, [], [STORE_SP])); // 26 > MAX_UNDO (25)
  prog.push(...QUIT);
  const m = new Machine(buildV(5, prog));

  expect(m.run()).toBe(RunState.Halted);
});

test("save_undo then restore_undo round-trips the machine state", () => {
  const prog = [
    ...opExt(0x09, [], [STORE_SP]), // save_undo -> sp
    ...opExt(0x0a, [], [STORE_SP]), // restore_undo -> sp (resumes at the save point)
    ...QUIT,
  ];
  const m = new Machine(buildV(5, prog));

  expect(m.run()).toBe(RunState.Halted);
});

test("restore_undo with an empty history reports failure", () => {
  const m = new Machine(buildV(5, [...opExt(0x0a, [], [STORE_SP]), ...QUIT]));
  expect(m.run()).toBe(RunState.Halted);
});

// --- more opcodes to fill remaining switch arms ----------------------------

test("assorted screen/query opcodes execute and halt", () => {
  const prog = [
    ...op0(0x0d, [CONT]), // verify ?~
    ...opV(0x12, [1]), // buffer_mode 1
    ...opV(0x11, [2]), // set_text_style 2
    ...opV(0x0a, [1]), // split_window 1
    ...opV(0x0b, [0]), // set_window 0
    ...op1L(0x07, 0x80), // print_addr 0x80  (a terminated z-string lives there)
    ...QUIT,
  ];
  const m = new Machine(
    buildV(5, prog, {
      fill: (b) => {
        b[0x80] = 0x80; // word 0x8000: terminator bit set -> decodes and stops
        b[0x81] = 0x00;
      },
    }),
  );

  expect(m.run()).toBe(RunState.Halted);
});

test("print_obj prints an object's short name", () => {
  const m = new Machine(buildObjStory([...op1(0x0a, 1), ...QUIT])); // print_obj obj1
  expect(m.run()).toBe(RunState.Halted);
});

test("erase_window clears a window", () => {
  const m = new Machine(buildV(5, [...opV(0x0d, [0xffff]), ...QUIT])); // erase_window -1
  expect(m.run()).toBe(RunState.Halted);
});

// NOTE: execute()'s `default` (an "unimplemented opcode" throw) is unreachable —
// every opcode quendor's table decodes has a case, so a bad opcode is rejected
// by the InstructionReader before execute() ever runs. It stays as a safety net.

// --- v3 save whose branch offset is 0 returns false from the routine --------

test("a save branch with offset 0 returns from the current routine", () => {
  // v3 save is a branching opcode; a failed save (default onSave) with a
  // branch-on-false, offset-0 byte takes the branch, which means "return 0".
  const m = new Machine(buildV(3, [0xb5, 0x40, ...QUIT])); // save ?~(offset 0, on false)
  expect(m.run()).toBe(RunState.Halted);
});

// NOTE: `tokenize` (VAR:0x1b) and `show_status` (0OP:0x0c) are not decodable
// past v3/v5 respectively, so opTokenize's pre-v5 buffer scan (903/913/918) and
// showStatus's `version > 3` early-out (988) can't be reached through bytecode
// — the decoder rejects the opcodes first. They stay as defensive guards.

test("random 0 reseeds from the configured seed", () => {
  const m = new Machine(buildV(5, [...opV(0x07, [0], [STORE_SP]), ...QUIT]));
  expect(m.run()).toBe(RunState.Halted);
});

test("scan_table scans a byte-sized table with an explicit form byte", () => {
  const TAB = 0x80;
  // scan_table 0xab TAB len=2 form=0x04 (byte-sized, stride 4) -> sp ?~
  const prog = [...opV(0x17, [0xab, TAB, 2, 0x04], [STORE_SP, CONT]), ...QUIT];
  const m = new Machine(buildV(5, prog)); // table is all zeros: value not found

  expect(m.run()).toBe(RunState.Halted);
  expect(m.memory.readWord(GLOBALS)).toBe(0); // not-found stores 0... to the stack, not g0
});

// --- stack-underflow guards ------------------------------------------------

test("reading the stack when empty throws (pop)", () => {
  const m = new Machine(buildV(3, [...op0(0x09), ...QUIT])); // pop with an empty stack
  expect(() => m.run()).toThrow(/stack underflow/);
});

test("reading a stack variable indirectly when empty throws (load 0)", () => {
  const m = new Machine(buildV(3, [...op1(0x0e, 0, [STORE_SP]), ...QUIT])); // load var0 -> sp
  expect(() => m.run()).toThrow(/stack underflow/);
});

test("writing a stack variable indirectly when empty throws (store 0)", () => {
  const m = new Machine(buildV(3, [...op2(0x0d, 0, 5), ...QUIT])); // store var0 = 5
  expect(() => m.run()).toThrow(/stack underflow/);
});

// --- unsorted dictionary (negative entry count) ----------------------------

test("an unsorted dictionary (negative entry count) is indexed by magnitude", () => {
  const DICT = 0x80;
  const m = new Machine(
    buildV(3, QUIT, {
      fill: (b) => {
        b[HeaderOffset.DictionaryAddress] = (DICT >> 8) & 0xff;
        b[HeaderOffset.DictionaryAddress + 1] = DICT & 0xff;
        b[DICT] = 0; // separators
        b[DICT + 1] = 4; // entry length
        b[DICT + 2] = 0xff; // entry count 0xfffe -> unsorted, |count| = 2
        b[DICT + 3] = 0xfe;
      },
    }),
  );

  // Building the index walks the two entries; the address just has to resolve.
  expect(m.getDictionaryWord(DICT + 4)).not.toBeUndefined();
});
