import { expect, test } from "vite-plus/test";
import { OperandKind } from "quendor";
import type { Instruction, Machine, Operand } from "quendor";
import {
  callTarget,
  computeLabels,
  disasmEmptyMsg,
  jumpOrBranchTarget,
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
