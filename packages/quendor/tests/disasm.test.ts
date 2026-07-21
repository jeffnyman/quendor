import { expect, test } from "vite-plus/test";
import { Memory } from "../src/memory.ts";
import type { Header } from "../src/header.ts";
import { ZText } from "../src/text.ts";
import { OpcodeFlags, OpcodeKind, type Opcode } from "../src/opcodes.ts";
import { OperandKind, type Instruction } from "../src/instruction.ts";
import { formatInstruction, formatVariable } from "../src/disasm.ts";

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
    checksum: 0,
    ...overrides,
  };
}

function newText(version = 3): ZText {
  return new ZText(new Memory(new Uint8Array(0)), buildHeader(version));
}

function fakeOpcode(overrides: Partial<Opcode> = {}): Opcode {
  return { kind: OpcodeKind.ZeroOp, number: 0, name: "op", flags: OpcodeFlags.None, ...overrides };
}

function fakeInstruction(overrides: Partial<Instruction> = {}): Instruction {
  return {
    address: 0,
    length: 1,
    opcode: fakeOpcode(),
    operands: [],
    storeVariable: undefined,
    branch: undefined,
    zwords: undefined,
    jumpTarget: undefined,
    ...overrides,
  };
}

test("formats the mnemonic, with no operands, store, branch, or text", () => {
  const insn = fakeInstruction({ opcode: fakeOpcode({ name: "rtrue" }) });

  expect(formatInstruction(insn)).toBe("rtrue");
});

test("formats each operand kind, defaulting to '?' for Omitted", () => {
  const insn = fakeInstruction({
    opcode: fakeOpcode({ name: "call" }),
    operands: [
      { kind: OperandKind.LargeConstant, value: 0x1234 },
      { kind: OperandKind.SmallConstant, value: 5 },
      { kind: OperandKind.Variable, value: 0 },
      { kind: OperandKind.Omitted, value: 0 },
    ],
  });

  expect(formatInstruction(insn)).toBe(`${"call".padEnd(15)} #1234 #05 sp ?`);
});

test("appends the store target when the instruction stores a result", () => {
  const insn = fakeInstruction({ opcode: fakeOpcode({ name: "add" }), storeVariable: 5 });

  expect(formatInstruction(insn)).toBe(`${"add".padEnd(15)}  -> local4`);
});

test.each([
  [{ whenTrue: true, offset: 5, targetAddress: 0x10 }, "[0010]"],
  [{ whenTrue: false, offset: 5, targetAddress: 0x10 }, "[~0010]"],
  [{ whenTrue: true, offset: 0, targetAddress: undefined }, "[rfalse]"],
  [{ whenTrue: false, offset: 1, targetAddress: undefined }, "[~rtrue]"],
  [{ whenTrue: true, offset: 5, targetAddress: undefined }, "[0000]"],
])("renders a branch %o as %s", (branch, expected) => {
  const insn = fakeInstruction({ opcode: fakeOpcode({ name: "jz" }), branch });

  expect(formatInstruction(insn)).toContain(expected);
});

test("renders jump's resolved target address in brackets", () => {
  const insn = fakeInstruction({ opcode: fakeOpcode({ name: "jump" }), jumpTarget: 0x4f05 });

  expect(formatInstruction(insn)).toBe(`${"jump".padEnd(15)}  [4f05]`);
});

test("renders no bracket when jumpTarget is absent", () => {
  const insn = fakeInstruction({ opcode: fakeOpcode({ name: "add" }) });

  expect(formatInstruction(insn)).not.toContain("[");
});

test("decodes and quotes inline Z-text when the opcode has ZText and a decoder is supplied", () => {
  const insn = fakeInstruction({
    opcode: fakeOpcode({ name: "print", flags: OpcodeFlags.ZText }),
    zwords: [(6 << 10) | (5 << 5) | 5 | 0x8000], // "a"
  });

  expect(formatInstruction(insn, newText())).toContain('"a"');
});

test("renders an empty quoted string when ZText is flagged but no decoder is supplied", () => {
  const insn = fakeInstruction({
    opcode: fakeOpcode({ name: "print", flags: OpcodeFlags.ZText }),
    zwords: [(6 << 10) | (5 << 5) | 5 | 0x8000],
  });

  expect(formatInstruction(insn)).toContain('""');
});

test("omits the text segment when the opcode has no zwords, even with ZText flagged", () => {
  const insn = fakeInstruction({
    opcode: fakeOpcode({ name: "print", flags: OpcodeFlags.ZText }),
    zwords: undefined,
  });

  expect(formatInstruction(insn, newText())).not.toContain('"');
});

test("escapes an embedded newline in decoded text as '^'", () => {
  const insn = fakeInstruction({
    opcode: fakeOpcode({ name: "print", flags: OpcodeFlags.ZText }),
    zwords: [(1 << 10) | (5 << 5) | 5 | 0x8000], // v1: zchar 1 is a literal newline
  });

  expect(formatInstruction(insn, newText(1))).toContain('"^"');
});

test.each([
  [0x00, "sp"],
  [0x01, "local0"],
  [0x0f, "local14"],
  [0x10, "g00"],
  [0xff, "gef"],
])("formatVariable(0x%s) is %s", (number, expected) => {
  expect(formatVariable(number)).toBe(expected);
});
