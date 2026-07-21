import { expect, test, vi } from "vite-plus/test";
import { Memory } from "../src/memory.ts";
import type { Story } from "../src/story.ts";
import type { Header } from "../src/header.ts";
import {
  OpcodeFlags,
  OpcodeKind,
  OpcodeTable,
  opcodeTableForVersion,
  type Opcode,
} from "../src/opcodes.ts";
import { disassembleReachable } from "../src/disassembler.ts";

vi.mock("../src/opcodes.ts", async () => {
  const actual = await vi.importActual("../src/opcodes.ts");

  return { ...actual, opcodeTableForVersion: vi.fn() };
});

function buildHeader(version: number, overrides: Partial<Header> = {}): Header {
  return {
    version,
    release: 0,
    highMemoryBase: 0,
    initialProgramCounter: 0,
    dictionaryAddress: 0,
    objectTableAddress: 0,
    globalVariablesTableAddress: 0,
    staticMemoryBase: 0,
    serialNumber: "",
    abbreviationsTableAddress: 0,
    fileLength: 0,
    alphabetTableAddress: 0,
    routinesOffset: 0,
    checksum: 0,
    ...overrides,
  };
}

/** A fake Story over `bytes`, with `ops` as the only known opcodes. */
function fakeStory(bytes: number[], ops: Opcode[], headerOverrides: Partial<Header> = {}): Story {
  const table = new OpcodeTable();

  for (const op of ops) table.add(op);

  vi.mocked(opcodeTableForVersion).mockReturnValue(table);

  return {
    memory: new Memory(new Uint8Array(bytes)),
    header: buildHeader(3, headerOverrides),
  } as unknown as Story;
}

const F = OpcodeFlags;
const fakecall: Opcode = { kind: OpcodeKind.OneOp, number: 0, name: "fakecall", flags: F.Call };
const rtrue: Opcode = { kind: OpcodeKind.ZeroOp, number: 0, name: "rtrue", flags: F.Return };

test("a linear run stops at a return-like opcode with no targets", () => {
  const story = fakeStory([0xb0], [rtrue]);
  const runs = disassembleReachable(story, 0);

  expect(runs).toEqual([
    { startAddress: 0, isRoutineStart: false, instructions: expect.any(Array), error: undefined },
  ]);
  expect(runs[0]?.instructions).toHaveLength(1);
});

test("a call's constant operand is unpacked and enqueued as a new routine", () => {
  // @0: fakecall #05 (unpacks to 5*2=10), rtrue. @10: locals count 0, rtrue.
  const bytes = [0x90, 0x05, 0xb0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0xb0];
  const story = fakeStory(bytes, [fakecall, rtrue]);
  const runs = disassembleReachable(story, 0);

  expect(runs).toHaveLength(2);
  expect(runs[0]?.instructions).toHaveLength(2); // fakecall, rtrue: call doesn't stop the run
  expect(runs[1]).toMatchObject({ startAddress: 10, isRoutineStart: true });
  expect(runs[1]?.instructions).toHaveLength(1);
});

test("a call through a Variable operand is not followed (can't be statically resolved)", () => {
  const variableCall: Opcode = { kind: OpcodeKind.OneOp, number: 0, name: "call", flags: F.Call };
  const bytes = [0xa0, 0x00]; // OneOp, Variable operand: the stack
  const story = fakeStory(bytes, [variableCall]);
  const runs = disassembleReachable(story, 0);

  expect(runs).toHaveLength(1);
});

test("jump's resolved target is enqueued, and following it stops the current run", () => {
  const jump: Opcode = { kind: OpcodeKind.OneOp, number: 0, name: "jump", flags: F.Jump };
  // @0: jump #03 -> target = 2 + 3 - 2 = 3. @3: rtrue.
  const bytes = [0x90, 0x03, 0xaa, 0xb0];
  const story = fakeStory(bytes, [jump, rtrue]);
  const runs = disassembleReachable(story, 0);

  expect(runs).toHaveLength(2);
  expect(runs[0]?.instructions).toHaveLength(1); // jump stops the run immediately
  expect(runs[1]).toMatchObject({ startAddress: 3, isRoutineStart: false });
});

test("a branch's resolved target is enqueued without stopping the current run", () => {
  const je: Opcode = { kind: OpcodeKind.TwoOp, number: 1, name: "je", flags: F.Branch };
  // @0: je #05 #07 [one-byte branch, whenTrue, offset 5 -> target 4+5-2=7], rtrue @4. @7: rtrue.
  const bytes = [0x01, 0x05, 0x07, 0xc5, 0xb0, 0xaa, 0xaa, 0xb0];
  const story = fakeStory(bytes, [je, rtrue]);
  const runs = disassembleReachable(story, 0);

  expect(runs).toHaveLength(2);
  expect(runs[0]?.instructions).toHaveLength(2); // branch doesn't stop the run
  expect(runs[1]).toMatchObject({ startAddress: 7, isRoutineStart: false });
});

test("a jump back to an already-visited address is not walked again", () => {
  const jump: Opcode = { kind: OpcodeKind.OneOp, number: 0, name: "jump", flags: F.Jump };
  // @0: jump #00 -> target = 2 + 0 - 2 = 0 (jumps back to its own start).
  const bytes = [0x90, 0x00];
  const story = fakeStory(bytes, [jump]);
  const runs = disassembleReachable(story, 0);

  expect(runs).toHaveLength(1);
});

test("an unrecognized opcode stops only that run; other queued runs still complete", () => {
  const fakereturn: Opcode = {
    kind: OpcodeKind.ZeroOp,
    number: 1,
    name: "fakereturn",
    flags: F.Return,
  };
  // @0: fakecall #05 (-> 10), fakereturn @2. @10: locals count 0, an opcode not in the table.
  const bytes = [0x90, 0x05, 0xb1, 0, 0, 0, 0, 0, 0, 0, 0x00, 0xb0];
  const story = fakeStory(bytes, [fakecall, fakereturn]); // note: rtrue (ZeroOp:0) is NOT registered
  const runs = disassembleReachable(story, 0);

  expect(runs).toHaveLength(2);
  expect(runs[0]?.error).toBeUndefined();
  expect(runs[1]).toMatchObject({ startAddress: 10, isRoutineStart: true, instructions: [] });
  expect(runs[1]?.error).toContain("Unknown opcode: kind=ZeroOp number=0x00");
});

test("v6's entry point is a packed address, unpacked and treated as a routine header", () => {
  // packed 5 -> 5*4 + 0*8 = 20; @20: locals count 0 -> first instruction @21.
  const bytes = Array.from({ length: 22 }, () => 0);

  bytes[20] = 0x00;
  bytes[21] = 0xb0;

  const story = fakeStory(bytes, [rtrue], { version: 6 });
  const runs = disassembleReachable(story, 5);

  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ startAddress: 20, isRoutineStart: true });
});
