import type { Memory } from "./memory.ts";
import {
  hasBranch,
  hasStore,
  hasZText,
  isDoubleVar,
  isJump,
  isReturn,
  OpcodeKind,
  opcodeTableForVersion,
} from "./opcodes.ts";
import type { Opcode, OpcodeTable } from "./opcodes.ts";

/** A store target or by-reference operand: a raw variable number (0..255). */
export const VariableKind = {
  Stack: 0,
  Local: 1,
  Global: 2,
} as const;

export type VariableKind = (typeof VariableKind)[keyof typeof VariableKind];

export const OperandKind = {
  LargeConstant: 0,
  SmallConstant: 1,
  Variable: 2,
  Omitted: 3,
} as const;

export type OperandKind = (typeof OperandKind)[keyof typeof OperandKind];

export interface Operand {
  readonly kind: OperandKind;
  readonly value: number;
}

export interface Branch {
  /** Whether the branch is taken when the condition is true or when false. */
  readonly whenTrue: boolean;
  /** Signed branch offset. 0 = return false, 1 = return true, else relative. */
  readonly offset: number;
  /** Absolute target address, or undefined for the rtrue/rfalse special cases. */
  readonly targetAddress: number | undefined;
}

export interface Instruction {
  readonly address: number;
  readonly length: number;
  readonly opcode: Opcode;
  readonly operands: readonly Operand[];
  readonly storeVariable: number | undefined;
  readonly branch: Branch | undefined;
  readonly zwords: readonly number[] | undefined;
  /** jump's resolved target address; undefined for every other opcode. */
  readonly jumpTarget: number | undefined;
}

/**
 * Decodes a stream of Z-Machine instructions from memory.
 *
 * Each instruction begins with an opcode byte whose high bits
 * select the encoding form (long / short / variable / extended);
 * that determines the opcode group and how operand types are
 * read. See the Z-Machine Standards Document 1.1, section 4.
 */
export class InstructionReader {
  private readonly memory: Memory;
  private addr: number;
  private readonly opcodeTable: OpcodeTable;

  constructor(memory: Memory, version: number, address: number) {
    this.memory = memory;
    this.addr = address;

    this.opcodeTable = opcodeTableForVersion(version);
  }

  /** Unlike Memory.readByte, tracks a cursor rather than taking an explicit address. */
  private readByte(): number {
    return this.memory.readByte(this.addr++);
  }

  private readWord(): number {
    const w = this.memory.readWord(this.addr);
    this.addr += 2;
    return w;
  }

  private readOperandKinds(kinds: OperandKind[], offset: number): void {
    const b = this.readByte();

    kinds[offset] = ((b & 0xc0) >> 6) as OperandKind;
    kinds[offset + 1] = ((b & 0x30) >> 4) as OperandKind;
    kinds[offset + 2] = ((b & 0x0c) >> 2) as OperandKind;
    kinds[offset + 3] = (b & 0x03) as OperandKind;
  }

  private readOperand(kind: OperandKind): Operand {
    switch (kind) {
      case OperandKind.LargeConstant:
        return { kind, value: this.readWord() };
      case OperandKind.SmallConstant:
      case OperandKind.Variable:
        return { kind, value: this.readByte() };
      default:
        throw new Error("Attempted to read an omitted operand.");
    }
  }

  private readOperands(kinds: OperandKind[]): Operand[] {
    let size = kinds.length;
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] === OperandKind.Omitted) {
        size = i;
        break;
      }
    }

    const operands: Operand[] = [];

    for (let i = 0; i < size; i++) {
      operands.push(this.readOperand(kinds[i]));
    }

    return operands;
  }

  private readBranch(): Branch {
    const b1 = this.readByte();
    const whenTrue = (b1 & 0x80) === 0x80;

    let offset: number;

    if ((b1 & 0x40) === 0x40) {
      // one-byte form: bottom 6 bits, always positive
      offset = b1 & 0x3f;
    } else {
      // two-byte form: 14-bit signed value
      const b2 = this.readByte();
      let value = ((b1 & 0x3f) << 8) | b2;

      if ((value & 0x2000) !== 0) value -= 0x4000; // sign-extend 14-bit

      offset = value;
    }

    // 0 and 1 are the "return false / return true" special cases.
    const targetAddress = offset === 0 || offset === 1 ? undefined : this.addr + offset - 2;

    return { whenTrue, offset, targetAddress };
  }

  /**
   * jump is not a branch: its one operand is a signed 16-bit offset applied
   * directly to the address after the instruction. See §4.7 / the jump
   * opcode reference: "address after instruction + Offset - 2".
   */
  private computeJumpTarget(operand: Operand): number {
    const offset = operand.value >= 0x8000 ? operand.value - 0x10000 : operand.value;

    return this.addr + offset - 2;
  }

  private readZWords(): number[] {
    const words: number[] = [];

    for (;;) {
      const zword = this.readWord();
      words.push(zword);
      if ((zword & 0x8000) !== 0) break;
    }

    return words;
  }

  /**
   * The opcode and its operand kinds are both determined by the opcode
   * byte's encoding form (long / short / variable / extended); see §4.3.
   * Kinds are written into `kinds` in place; the long/short forms encode
   * them directly in the opcode byte, while variable/extended forms read
   * a following operand-kinds byte (or two, for double-variable opcodes).
   */
  private decodeOpcodeAndKinds(opByte: number, kinds: OperandKind[]): Opcode {
    if (opByte <= 0x1f) {
      kinds[0] = OperandKind.SmallConstant;
      kinds[1] = OperandKind.SmallConstant;
      return this.opcodeTable.get(OpcodeKind.TwoOp, opByte & 0x1f);
    }

    if (opByte <= 0x3f) {
      kinds[0] = OperandKind.SmallConstant;
      kinds[1] = OperandKind.Variable;
      return this.opcodeTable.get(OpcodeKind.TwoOp, opByte & 0x1f);
    }

    if (opByte <= 0x5f) {
      kinds[0] = OperandKind.Variable;
      kinds[1] = OperandKind.SmallConstant;
      return this.opcodeTable.get(OpcodeKind.TwoOp, opByte & 0x1f);
    }

    if (opByte <= 0x7f) {
      kinds[0] = OperandKind.Variable;
      kinds[1] = OperandKind.Variable;
      return this.opcodeTable.get(OpcodeKind.TwoOp, opByte & 0x1f);
    }

    if (opByte <= 0x8f) {
      kinds[0] = OperandKind.LargeConstant;
      return this.opcodeTable.get(OpcodeKind.OneOp, opByte & 0x0f);
    }

    if (opByte <= 0x9f) {
      kinds[0] = OperandKind.SmallConstant;
      return this.opcodeTable.get(OpcodeKind.OneOp, opByte & 0x0f);
    }

    if (opByte <= 0xaf) {
      kinds[0] = OperandKind.Variable;
      return this.opcodeTable.get(OpcodeKind.OneOp, opByte & 0x0f);
    }

    if ((opByte >= 0xb0 && opByte <= 0xbd) || opByte === 0xbf) {
      return this.opcodeTable.get(OpcodeKind.ZeroOp, opByte & 0x0f);
    }

    if (opByte === 0xbe) {
      const opcode = this.opcodeTable.get(OpcodeKind.Ext, this.readByte());

      this.readOperandKinds(kinds, 0);

      return opcode;
    }

    if (opByte <= 0xdf) {
      const opcode = this.opcodeTable.get(OpcodeKind.TwoOp, opByte & 0x1f);

      this.readOperandKinds(kinds, 0);

      return opcode;
    }

    const opcode = this.opcodeTable.get(OpcodeKind.VarOp, opByte & 0x1f);

    this.readOperandKinds(kinds, 0);

    return opcode;
  }

  /** Decode the instruction at the current address and advance past it. */
  next(): Instruction {
    const startAddress = this.addr;
    const opByte = this.readByte();

    const kinds: OperandKind[] = [
      OperandKind.Omitted,
      OperandKind.Omitted,
      OperandKind.Omitted,
      OperandKind.Omitted,
      OperandKind.Omitted,
      OperandKind.Omitted,
      OperandKind.Omitted,
      OperandKind.Omitted,
    ];

    const opcode = this.decodeOpcodeAndKinds(opByte, kinds);

    if (isDoubleVar(opcode)) {
      this.readOperandKinds(kinds, 4);
    }

    const operands = this.readOperands(kinds);
    const jumpTarget = isJump(opcode) ? this.computeJumpTarget(operands[0]) : undefined;

    const storeVariable = hasStore(opcode) ? this.readByte() : undefined;
    const branch = hasBranch(opcode) ? this.readBranch() : undefined;
    const zwords = hasZText(opcode) ? this.readZWords() : undefined;

    return {
      address: startAddress,
      length: this.addr - startAddress,
      opcode,
      operands,
      storeVariable,
      branch,
      zwords,
      jumpTarget,
    };
  }
}

/** True for instructions that end a straight-line run (return, quit, jump). */
export function isReturnLike(instruction: Instruction): boolean {
  const name = instruction.opcode.name;
  return isReturn(instruction.opcode) || name === "quit" || name === "restart" || name === "jump";
}

export function classifyVariable(number: number): {
  kind: VariableKind;
  index: number;
} {
  if (number === 0) return { kind: VariableKind.Stack, index: 0 };
  if (number < 0x10) return { kind: VariableKind.Local, index: number - 1 };
  return { kind: VariableKind.Global, index: number - 0x10 };
}
