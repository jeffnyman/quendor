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
