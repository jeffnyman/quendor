import { expect, test, vi } from "vite-plus/test";
import { Memory } from "../src/memory.ts";
import {
  OpcodeFlags,
  OpcodeKind,
  OpcodeTable,
  opcodeTableForVersion,
  type Opcode,
} from "../src/opcodes.ts";
import {
  classifyVariable,
  InstructionReader,
  isReturnLike,
  OperandKind,
  VariableKind,
  type Instruction,
} from "../src/instruction.ts";

vi.mock("../src/opcodes.ts", async () => {
  const actual = await vi.importActual("../src/opcodes.ts");

  return { ...actual, opcodeTableForVersion: vi.fn() };
});

/** An InstructionReader over `bytes`, with `ops` as the only known opcodes. */
function makeReader(bytes: number[], ops: Opcode[]): InstructionReader {
  const table = new OpcodeTable();

  for (const op of ops) table.add(op);

  vi.mocked(opcodeTableForVersion).mockReturnValue(table);

  return new InstructionReader(new Memory(new Uint8Array(bytes)), 3, 0);
}

test("decodes the long form (2OP), small constant + small constant", () => {
  const op: Opcode = { kind: OpcodeKind.TwoOp, number: 1, name: "je", flags: OpcodeFlags.None };
  const reader = makeReader([0x01, 0x05, 0x07], [op]);

  expect(reader.next()).toEqual({
    address: 0,
    length: 3,
    opcode: op,
    operands: [
      { kind: OperandKind.SmallConstant, value: 5 },
      { kind: OperandKind.SmallConstant, value: 7 },
    ],
    storeVariable: undefined,
    branch: undefined,
    zwords: undefined,
  });
});

test("decodes the long form (2OP), small constant + variable", () => {
  const op: Opcode = { kind: OpcodeKind.TwoOp, number: 1, name: "je", flags: OpcodeFlags.None };
  const reader = makeReader([0x21, 0x05, 0x00], [op]);

  expect(reader.next().operands).toEqual([
    { kind: OperandKind.SmallConstant, value: 5 },
    { kind: OperandKind.Variable, value: 0 },
  ]);
});

test("decodes the long form (2OP), variable + small constant", () => {
  const op: Opcode = { kind: OpcodeKind.TwoOp, number: 1, name: "je", flags: OpcodeFlags.None };
  const reader = makeReader([0x41, 0x02, 0x09], [op]);

  expect(reader.next().operands).toEqual([
    { kind: OperandKind.Variable, value: 2 },
    { kind: OperandKind.SmallConstant, value: 9 },
  ]);
});

test("decodes the long form (2OP), variable + variable", () => {
  const op: Opcode = { kind: OpcodeKind.TwoOp, number: 1, name: "je", flags: OpcodeFlags.None };
  const reader = makeReader([0x61, 0x02, 0x03], [op]);

  expect(reader.next().operands).toEqual([
    { kind: OperandKind.Variable, value: 2 },
    { kind: OperandKind.Variable, value: 3 },
  ]);
});

test("decodes the short form (1OP), large constant", () => {
  const op: Opcode = { kind: OpcodeKind.OneOp, number: 0, name: "jz", flags: OpcodeFlags.None };
  const reader = makeReader([0x80, 0x12, 0x34], [op]);
  const insn = reader.next();

  expect(insn.operands).toEqual([{ kind: OperandKind.LargeConstant, value: 0x1234 }]);
  expect(insn.length).toBe(3);
});

test("decodes the short form (1OP), small constant", () => {
  const op: Opcode = { kind: OpcodeKind.OneOp, number: 0, name: "jz", flags: OpcodeFlags.None };
  const reader = makeReader([0x90, 0x07], [op]);

  expect(reader.next().operands).toEqual([{ kind: OperandKind.SmallConstant, value: 7 }]);
});

test("decodes the short form (1OP), variable", () => {
  const op: Opcode = { kind: OpcodeKind.OneOp, number: 0, name: "jz", flags: OpcodeFlags.None };
  const reader = makeReader([0xa0, 0x10], [op]);

  expect(reader.next().operands).toEqual([{ kind: OperandKind.Variable, value: 0x10 }]);
});

test("decodes the short form (0OP), no operands", () => {
  const op: Opcode = {
    kind: OpcodeKind.ZeroOp,
    number: 0,
    name: "rtrue",
    flags: OpcodeFlags.None,
  };
  const reader = makeReader([0xb0], [op]);
  const insn = reader.next();

  expect(insn.operands).toEqual([]);
  expect(insn.length).toBe(1);
});

test("0xbf is the short form (0OP), opcode number 15", () => {
  const op: Opcode = {
    kind: OpcodeKind.ZeroOp,
    number: 15,
    name: "piracy",
    flags: OpcodeFlags.None,
  };
  const reader = makeReader([0xbf], [op]);

  expect(reader.next().opcode).toEqual(op);
});

test("decodes the extended form, reading a following operand-kinds byte", () => {
  const op: Opcode = { kind: OpcodeKind.Ext, number: 5, name: "save", flags: OpcodeFlags.None };
  // kinds byte 0x7f -> [SmallConstant, Omitted, Omitted, Omitted]
  const reader = makeReader([0xbe, 0x05, 0x7f, 0x09], [op]);
  const insn = reader.next();

  expect(insn.opcode).toEqual(op);
  expect(insn.operands).toEqual([{ kind: OperandKind.SmallConstant, value: 9 }]);
  expect(insn.length).toBe(4);
});

test("decodes the variable form (2OP), reading a following operand-kinds byte", () => {
  const op: Opcode = { kind: OpcodeKind.TwoOp, number: 1, name: "je", flags: OpcodeFlags.None };
  // kinds byte 0xbf -> [Variable, Omitted, Omitted, Omitted]
  const reader = makeReader([0xc1, 0xbf, 0x00], [op]);

  expect(reader.next().operands).toEqual([{ kind: OperandKind.Variable, value: 0 }]);
});

test("decodes the variable form (VAR), reading a following operand-kinds byte", () => {
  const op: Opcode = {
    kind: OpcodeKind.VarOp,
    number: 1,
    name: "storew",
    flags: OpcodeFlags.None,
  };
  // kinds byte 0x7f -> [SmallConstant, Omitted, Omitted, Omitted]
  const reader = makeReader([0xe1, 0x7f, 0x09], [op]);

  expect(reader.next().operands).toEqual([{ kind: OperandKind.SmallConstant, value: 9 }]);
});

test("a double-variable opcode reads a second operand-kinds byte for up to 8 operands", () => {
  const op: Opcode = {
    kind: OpcodeKind.VarOp,
    number: 0,
    name: "call_vs2",
    flags: OpcodeFlags.DoubleVar,
  };
  // kinds bytes 0x55, 0x7f -> [Small, Small, Small, Small, Small, Omitted, Omitted, Omitted]
  const reader = makeReader([0xe0, 0x55, 0x7f, 0x01, 0x02, 0x03, 0x04, 0x05], [op]);
  const insn = reader.next();

  expect(insn.operands).toEqual([
    { kind: OperandKind.SmallConstant, value: 1 },
    { kind: OperandKind.SmallConstant, value: 2 },
    { kind: OperandKind.SmallConstant, value: 3 },
    { kind: OperandKind.SmallConstant, value: 4 },
    { kind: OperandKind.SmallConstant, value: 5 },
  ]);
  expect(insn.length).toBe(8);
});

test("reads a store variable when the opcode has the Store flag", () => {
  const op: Opcode = {
    kind: OpcodeKind.ZeroOp,
    number: 0,
    name: "catch",
    flags: OpcodeFlags.Store,
  };
  const reader = makeReader([0xb0, 0x05], [op]);
  const insn = reader.next();

  expect(insn.storeVariable).toBe(5);
  expect(insn.length).toBe(2);
});

test("reads a one-byte branch, computing the absolute target address", () => {
  const op: Opcode = { kind: OpcodeKind.ZeroOp, number: 0, name: "jz", flags: OpcodeFlags.Branch };
  const reader = makeReader([0xb0, 0xc5], [op]); // whenTrue, one-byte form, offset 5

  expect(reader.next().branch).toEqual({ whenTrue: true, offset: 5, targetAddress: 5 });
});

test("reads a two-byte branch, sign-extending a negative 14-bit offset", () => {
  const op: Opcode = { kind: OpcodeKind.ZeroOp, number: 0, name: "jz", flags: OpcodeFlags.Branch };
  const reader = makeReader([0xb0, 0x3f, 0x00], [op]);

  expect(reader.next().branch).toEqual({ whenTrue: false, offset: -256, targetAddress: -255 });
});

test("a branch offset of 0 is the rfalse special case (no target address)", () => {
  const op: Opcode = { kind: OpcodeKind.ZeroOp, number: 0, name: "jz", flags: OpcodeFlags.Branch };
  const reader = makeReader([0xb0, 0x40], [op]);

  expect(reader.next().branch).toEqual({
    whenTrue: false,
    offset: 0,
    targetAddress: undefined,
  });
});

test("a branch offset of 1 is the rtrue special case (no target address)", () => {
  const op: Opcode = { kind: OpcodeKind.ZeroOp, number: 0, name: "jz", flags: OpcodeFlags.Branch };
  const reader = makeReader([0xb0, 0xc1], [op]);

  expect(reader.next().branch).toEqual({
    whenTrue: true,
    offset: 1,
    targetAddress: undefined,
  });
});

test("reads Z-words up to and including the terminated word when the opcode has ZText", () => {
  const op: Opcode = {
    kind: OpcodeKind.ZeroOp,
    number: 0,
    name: "print",
    flags: OpcodeFlags.ZText,
  };
  const reader = makeReader([0xb0, 0x12, 0x34, 0x80, 0x05], [op]);
  const insn = reader.next();

  expect(insn.zwords).toEqual([0x1234, 0x8005]);
  expect(insn.length).toBe(5);
});

test.each([
  [0x00, VariableKind.Stack, 0],
  [0x01, VariableKind.Local, 0],
  [0x0f, VariableKind.Local, 14],
  [0x10, VariableKind.Global, 0],
  [0xff, VariableKind.Global, 0xef],
])("classifyVariable(0x%s) is %s index %i", (number, kind, index) => {
  expect(classifyVariable(number)).toEqual({ kind, index });
});

function fakeInstruction(opcode: Partial<Opcode>): Instruction {
  return {
    address: 0,
    length: 1,
    opcode: { kind: OpcodeKind.ZeroOp, number: 0, name: "x", flags: OpcodeFlags.None, ...opcode },
    operands: [],
    storeVariable: undefined,
    branch: undefined,
    zwords: undefined,
  };
}

test.each([
  ["an opcode with the Return flag", { flags: OpcodeFlags.Return }],
  ["quit", { name: "quit" }],
  ["restart", { name: "restart" }],
  ["jump", { name: "jump" }],
])("isReturnLike is true for %s", (_label, opcode) => {
  expect(isReturnLike(fakeInstruction(opcode))).toBe(true);
});

test("isReturnLike is false for an ordinary opcode", () => {
  expect(isReturnLike(fakeInstruction({ name: "je" }))).toBe(false);
});
