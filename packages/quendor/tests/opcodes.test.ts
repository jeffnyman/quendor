import { expect, test } from "vite-plus/test";
import {
  hasBranch,
  hasStore,
  hasZText,
  isCall,
  isDoubleVar,
  isJump,
  isReturn,
  OpcodeFlags,
  OpcodeKind,
  OpcodeTable,
  opcodeTableForVersion,
  type Opcode,
} from "../src/opcodes.ts";

test("add/get round-trips an opcode by kind and number", () => {
  const table = new OpcodeTable();
  const je: Opcode = { kind: OpcodeKind.TwoOp, number: 1, name: "je", flags: OpcodeFlags.Branch };

  table.add(je);

  expect(table.get(OpcodeKind.TwoOp, 1)).toEqual(je);
});

test("get distinguishes opcodes by kind, not just number", () => {
  const table = new OpcodeTable();
  const twoOp: Opcode = { kind: OpcodeKind.TwoOp, number: 1, name: "je", flags: OpcodeFlags.None };
  const oneOp: Opcode = {
    kind: OpcodeKind.OneOp,
    number: 1,
    name: "jz",
    flags: OpcodeFlags.None,
  };

  table.add(twoOp);
  table.add(oneOp);

  expect(table.get(OpcodeKind.TwoOp, 1)).toEqual(twoOp);
  expect(table.get(OpcodeKind.OneOp, 1)).toEqual(oneOp);
});

test("get throws for an unknown opcode, naming the kind and number in hex", () => {
  const table = new OpcodeTable();

  expect(() => table.get(OpcodeKind.VarOp, 0x2a)).toThrow("Unknown opcode: kind=VarOp number=0x2a");
});

test.each([
  ["isReturn", isReturn, OpcodeFlags.Return],
  ["hasZText", hasZText, OpcodeFlags.ZText],
  ["isJump", isJump, OpcodeFlags.Jump],
  ["isCall", isCall, OpcodeFlags.Call],
  ["isDoubleVar", isDoubleVar, OpcodeFlags.DoubleVar],
  ["hasStore", hasStore, OpcodeFlags.Store],
  ["hasBranch", hasBranch, OpcodeFlags.Branch],
] as const)("%s reports true only when its flag bit is set", (_name, predicate, flag) => {
  const withFlag: Opcode = { kind: OpcodeKind.VarOp, number: 0, name: "x", flags: flag };
  const withoutFlag: Opcode = { kind: OpcodeKind.VarOp, number: 0, name: "x", flags: 0 };

  expect(predicate(withFlag)).toBe(true);
  expect(predicate(withoutFlag)).toBe(false);
});

test("opcodeTableForVersion throws for a version below the supported range", () => {
  expect(() => opcodeTableForVersion(0)).toThrow("No opcode table for version 0");
});

test("opcodeTableForVersion throws for a version above the supported range", () => {
  expect(() => opcodeTableForVersion(9)).toThrow("No opcode table for version 9");
});

test("opcodeTableForVersion returns the same table for repeated lookups of one version", () => {
  expect(opcodeTableForVersion(3)).toBe(opcodeTableForVersion(3));
});

test("opcodeTableForVersion returns independent tables per version", () => {
  expect(opcodeTableForVersion(1)).not.toBe(opcodeTableForVersion(2));
});
