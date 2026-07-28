import { expect, test } from "vite-plus/test";
import { OperandKind, Story, Machine } from "quendor";
import type { Instruction, Operand } from "quendor";
import {
  callTarget,
  computeLabels,
  currentRoutineAddr,
  decodeRoutine,
  disasmEmptyMsg,
  disasmHtml,
  jumpOrBranchTarget,
  routineCodeStart,
  routineLabel,
} from "../web/disasm-model.ts";

/** Build a minimal Instruction covering only the fields these functions read. */
function insn(fields: {
  address?: number;
  length?: number;
  name?: string;
  operands?: Operand[];
  branchTarget?: number;
}): Instruction {
  return {
    address: fields.address ?? 0,
    length: fields.length ?? 0,
    opcode: { name: fields.name ?? "nop" },
    operands: fields.operands ?? [],
    storeVariable: undefined,
    branch: fields.branchTarget === undefined ? undefined : { targetAddress: fields.branchTarget },
    zwords: undefined,
    jumpTarget: undefined,
  } as unknown as Instruction;
}

const constOp = (value: number): Operand => ({ kind: OperandKind.LargeConstant, value });
const varOp = (value: number): Operand => ({ kind: OperandKind.Variable, value });

test("jumpOrBranchTarget returns a branch's absolute target", () => {
  expect(jumpOrBranchTarget(insn({ name: "je", branchTarget: 0x1234 }))).toBe(0x1234);
});

test("jumpOrBranchTarget computes a jump's relative target (addr + len + offset - 2)", () => {
  const i = insn({ name: "jump", address: 0x100, length: 3, operands: [constOp(10)] });
  expect(jumpOrBranchTarget(i)).toBe(0x100 + 3 + 10 - 2);
});

test("jumpOrBranchTarget handles a negative (backward) jump offset", () => {
  const i = insn({ name: "jump", address: 0x100, length: 3, operands: [constOp(0xfff0)] });
  expect(jumpOrBranchTarget(i)).toBe(0x100 + 3 + -16 - 2);
});

test("jumpOrBranchTarget is null for a variable jump or a plain instruction", () => {
  expect(jumpOrBranchTarget(insn({ name: "jump", operands: [varOp(1)] }))).toBeNull();
  expect(jumpOrBranchTarget(insn({ name: "add" }))).toBeNull();
});

test("callTarget unpacks a constant call operand via the machine", () => {
  const machine = { unpackRoutineAddress: (v: number) => v * 2 } as unknown as Machine;
  expect(callTarget(machine, insn({ name: "call_vs", operands: [constOp(0x40)] }))).toBe(0x80);
});

test("callTarget is null for non-calls, variable operands, or a zero address", () => {
  const machine = { unpackRoutineAddress: (v: number) => v * 2 } as unknown as Machine;
  expect(callTarget(machine, insn({ name: "add", operands: [constOp(0x40)] }))).toBeNull();
  expect(callTarget(machine, insn({ name: "call", operands: [varOp(1)] }))).toBeNull();
  expect(callTarget(machine, insn({ name: "call", operands: [constOp(0)] }))).toBeNull();
});

test("computeLabels names in-routine targets L1, L2 in address order", () => {
  const insns = [
    insn({ name: "je", address: 0x10, length: 2, branchTarget: 0x20 }),
    insn({ name: "je", address: 0x12, length: 2, branchTarget: 0x14 }),
    insn({ name: "nop", address: 0x14, length: 1 }),
    insn({ name: "nop", address: 0x20, length: 1 }),
  ];
  const labels = computeLabels(insns);
  expect(labels.get(0x14)).toBe("L1"); // lower address gets L1
  expect(labels.get(0x20)).toBe("L2");
});

test("computeLabels ignores targets outside the decoded routine", () => {
  const insns = [insn({ name: "je", address: 0x10, length: 2, branchTarget: 0x999 })];
  expect(computeLabels(insns).size).toBe(0);
});

test("routineLabel formats the toolbar location text", () => {
  expect(routineLabel(undefined, true)).toBe("");
  expect(routineLabel(0x4f05, true)).toBe("routine 0x4f05 · following PC");
  expect(routineLabel(0x4f05, false)).toBe("routine 0x4f05");
});

test("disasmEmptyMsg differs for halted vs a non-routine address", () => {
  expect(disasmEmptyMsg(undefined)).toContain("halted");
  expect(disasmEmptyMsg(0x1234)).toContain("not a routine at 0x1234");
});

// --- functions that decode real instructions, driven by a tiny v5 story ------
//
// The entry point at 0x40 is raw code (§5.5, no routine header): call_1n to the
// routine packed at 0x14 (→ 0x50), an unconditional jump, then rtrue. The routine
// at 0x50 is `0 locals` + rtrue.

function buildMachine(): Machine {
  const bytes = new Uint8Array(0x100);
  bytes[0x00] = 5; // version 5
  bytes[0x06] = 0x00;
  bytes[0x07] = 0x40; // initial PC → 0x40
  bytes[0x0c] = 0x00;
  bytes[0x0d] = 0x60; // globals → 0x60
  bytes[0x0e] = 0x01;
  bytes[0x0f] = 0x00; // static base → 0x100 (all of the above is dynamic)

  bytes.set([0x8f, 0x00, 0x14], 0x40); // call_1n 0x14  (packed → 0x50)
  bytes.set([0x8c, 0x00, 0x05], 0x43); // jump +5
  bytes[0x46] = 0xb0; // rtrue
  bytes.set([0x00, 0xb0], 0x50); // routine: 0 locals, then rtrue

  return new Machine(new Story(bytes));
}

test("currentRoutineAddr returns the innermost frame's routine, or undefined", () => {
  const m = buildMachine();
  expect(currentRoutineAddr(m)).toBe(m.getCallStack()[0]?.routineAddress);
  expect(currentRoutineAddr(m)).toBeTypeOf("number");

  const halted = { getCallStack: (): unknown[] => [] } as unknown as Machine;
  expect(currentRoutineAddr(halted)).toBeUndefined();
});

test("routineCodeStart: undefined, entry point, past the header, and unreadable", () => {
  const m = buildMachine();
  expect(routineCodeStart(m, undefined, true)).toBeNull();
  expect(routineCodeStart(m, 0x40, true)).toBe(0x40); // entry frame (returnPC 0): raw code
  expect(routineCodeStart(m, 0x50, false)).toBe(0x51); // header path: skip the local-count byte
  expect(routineCodeStart(m, 0x5000, false)).toBeNull(); // out of range → readRoutineHeader throws
});

test("decodeRoutine reads instructions until a return-like op", () => {
  // The unconditional jump ends the linear run (control doesn't fall through),
  // so decoding stops there — the rtrue past it is never reached this way.
  const insns = decodeRoutine(buildMachine(), 0x40);
  expect(insns.map((i) => i.opcode.name)).toEqual(["call_1n", "jump"]);
});

test("decodeRoutine stops cleanly when an instruction fails to decode", () => {
  // Starting at the very last byte, the reader runs off the end of memory on its
  // first read; the catch/break returns whatever was collected (nothing).
  expect(decodeRoutine(buildMachine(), 0xff)).toEqual([]);
});

test("disasmHtml renders rows with the PC marker and call/jump nav chips", () => {
  const m = buildMachine();
  const insns = decodeRoutine(m, 0x40);
  const html = disasmHtml(insns, m, new Map(), new Set());

  expect(html).toContain('data-addr="64"'); // 0x40, the first row
  expect(html).toContain('class="dline pc"'); // first insn sits on the PC
  expect(html).toContain("data-nav="); // call_1n → routine target chip
  expect(html).toContain("data-scroll="); // jump → in-routine target chip
});

test("disasmHtml emits a label before a targeted row and marks breakpoints", () => {
  const m = buildMachine();
  const insns = decodeRoutine(m, 0x40);
  const jumpAddr = insns[1].address;
  const html = disasmHtml(insns, m, new Map([[jumpAddr, "L1"]]), new Set([jumpAddr]));

  expect(html).toContain('class="dlabel">L1:</div>'); // label row precedes the instruction
  expect(html).toContain(" bp"); // breakpoint class on that row
});
