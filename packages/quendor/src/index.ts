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
export { Machine, RunState } from "./machine.ts";
export type { Frame, FrameInfo } from "./machine.ts";
export { Story } from "./story.ts";
export { Memory } from "./memory.ts";

// Everything below is the inspection toolkit — decode, disassemble, and dump a
// story's internals. Its audience is tools built on the engine (the zexplorer
// debugger), not code that just plays a game. It's exported deliberately, not
// for the tests (those import from ./src directly); pruning can wait for the
// 0.x surface to settle, since removals are a pre-1.0 concern.

// --- toolkit: header --------------------------------------------------------
export { HeaderOffset, readHeader, computeChecksum, unpackRoutineAddress } from "./header.ts";
export type { Header } from "./header.ts";

// --- toolkit: decode / disassemble -----------------------------------------
export {
  VariableKind,
  OperandKind,
  InstructionReader,
  isReturnLike,
  classifyVariable,
} from "./instruction.ts";
export type { Operand, Branch, Instruction } from "./instruction.ts";

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
} from "./opcodes.ts";
export type { Opcode } from "./opcodes.ts";

export { readRoutineHeader, type RoutineHeader } from "./routine.ts";
export { formatInstruction, formatVariable, formatResolvedOperands } from "./disasm.ts";
export { disassembleReachable } from "./disassembler.ts";
export type { DisassembledRun } from "./disassembler.ts";

// --- toolkit: text / objects ------------------------------------------------
export { DEFAULT_FLAGS, ZText } from "./text.ts";
export type { DecodeFlags } from "./text.ts";
export { AlphabetTable } from "./alphabet.ts";
export { ObjectTable } from "./objects.ts";

// --- toolkit: dumps ---------------------------------------------------------
export { dumpAll, dumpHeader, dumpObjects, dumpAbbreviations, dumpDictionary } from "./dump.ts";

// --- toolkit: quetzal -------------------------------------------------------
export { encodeQuetzal, decodeQuetzal } from "./quetzal.ts";
export type { DecodedQuetzal, QuetzalState, QuetzalFrame } from "./quetzal.ts";

// --- resources (Blorb pictures/sounds) -------------------------------------
export { describeBlorb, extractBlorb, parseBlorb, unwrapStory } from "./blorb.ts";
export type { BlorbPicture, BlorbSound, BlorbResources } from "./blorb.ts";
export { decodeAiff, type DecodedAudio } from "./aiff.ts";

// --- screen models ---------------------------------------------------------
export type { OutputAttrs, Cell } from "./screen.ts";
export { font3Char, hasFont3Glyph } from "./font3.ts";
export { V6Screen } from "./v6screen.ts";
