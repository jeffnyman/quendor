/**
 * Quendor — the public API of the Z-Machine engine.
 *
 * This is the boundary between the interpreter/engine and anything built on top
 * of it (the zdebug web debugger, the CLI, tests). Everything re-exported here is
 * pure — no DOM, no node — so it runs in a browser or in node unchanged. The
 * node-only story loader lives in a separate entry, `./node.ts` (`quendor/node`),
 * so importing the engine never pulls in `node:fs`.
 *
 * Consumers should import from here rather than reaching into `./<module>.js`.
 */

export function fn(): string {
  return "Quendor Z-Machine Interpreter and Debugger";
}

// --- execution -------------------------------------------------------------
export { Machine, RunState } from "./machine.js";
export type { Frame } from "./machine.js";
export { Story } from "./story.js";
export { Memory } from "./memory.js";

// --- header ----------------------------------------------------------------
export { HeaderOffset, readHeader, computeChecksum, unpackRoutineAddress } from "./header.js";
export type { Header } from "./header.js";

// --- decode / disassemble ---------------------------------------------------
export {
  VariableKind,
  OperandKind,
  InstructionReader,
  isReturnLike,
  classifyVariable,
} from "./instruction.js";
export type { Operand, Branch, Instruction } from "./instruction.js";

export {
  OpcodeKind,
  OpcodeTable,
  OpcodeFlags,
  isReturn,
  hasZText,
  isCall,
  isDoubleVar,
  hasStore,
  hasBranch,
  opcodeTableForVersion,
} from "./opcodes.js";
export type { Opcode } from "./opcodes.js";

export { formatInstruction, formatVariable, formatResolvedOperands } from "./disasm.js";
export { disassembleReachable } from "./disassembler.js";
export type { DisassembledRun } from "./disassembler.js";

// --- text / objects --------------------------------------------------------
export { DEFAULT_FLAGS, ZText } from "./text.js";
export type { DecodeFlags } from "./text.js";
export { AlphabetTable } from "./alphabet.js";
export { ObjectTable } from "./objects.js";

// --- tooling ---------------------------------------------------------------
export { dumpAll, dumpHeader, dumpObjects, dumpAbbreviations, dumpDictionary } from "./dump.js";
