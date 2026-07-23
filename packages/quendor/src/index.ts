/**
 * Quendor — the public API of the Z-Machine engine.
 *
 * This is the boundary between the interpreter/engine and anything built on top
 * of it (the zdebug web debugger and the CLI). Everything re-exported here is
 * pure — no DOM, no node — so it runs in a browser or in node unchanged. The
 * node-only story loader lives in a separate entry, `./node.ts` (`quendor/node`),
 * so importing the engine never pulls in `node:fs`.
 *
 * Consumers should import from here rather than reaching into `./<module>.js`.
 */

// --- engine — everything needed to load and run a story --------------------
export { Machine, RunState } from "./machine.js";
export type { Frame } from "./machine.js";
export { Story } from "./story.js";
export { Memory } from "./memory.js";

// Everything below is the inspection toolkit — decode, disassemble, and dump a
// story's internals. Its audience is tools built on the engine (the zexplorer
// debugger), not code that just plays a game. It's exported deliberately, not
// for the tests (those import from ./src directly); pruning can wait for the
// 0.x surface to settle, since removals are a pre-1.0 concern.

// --- toolkit: header --------------------------------------------------------
export { HeaderOffset, readHeader, computeChecksum, unpackRoutineAddress } from "./header.js";
export type { Header } from "./header.js";

// --- toolkit: decode / disassemble -----------------------------------------
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

// --- toolkit: text / objects ------------------------------------------------
export { DEFAULT_FLAGS, ZText } from "./text.js";
export type { DecodeFlags } from "./text.js";
export { AlphabetTable } from "./alphabet.js";
export { ObjectTable } from "./objects.js";

// --- toolkit: dumps ---------------------------------------------------------
export { dumpAll, dumpHeader, dumpObjects, dumpAbbreviations, dumpDictionary } from "./dump.js";
