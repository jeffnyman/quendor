import type { ZText } from "./text.ts";
import {
  classifyVariable,
  OperandKind,
  VariableKind,
  type Instruction,
  type Operand,
} from "./instruction.ts";
import { hasZText, isCall } from "./opcodes.ts";

/**
 * Render an instruction as a single line of assembly, in the spirit
 * of the `txd` disassembler (mnemonic, operands, `-> store`, branch
 * target, and inline text). `text` is optional; when supplied,
 * inline Z-text is decoded.
 */
export function formatInstruction(instruction: Instruction, text?: ZText): string {
  const { opcode, operands, storeVariable, branch, zwords } = instruction;
  const parts: string[] = [opcode.name.padEnd(15)];
  const operandStrings = operands.map(formatOperand);

  // For calls, the first operand is a packed routine address; leave as-is here.
  parts.push(operandStrings.join(" "));

  if (storeVariable !== undefined) {
    parts.push(`-> ${formatVariable(storeVariable)}`);
  }

  if (branch !== undefined) {
    const cond = branch.whenTrue ? "" : "~";
    let target: string;

    if (branch.offset === 0) target = "rfalse";
    else if (branch.offset === 1) target = "rtrue";
    else target = hex(branch.targetAddress ?? 0, 4);

    parts.push(`[${cond}${target}]`);
  }

  if (hasZText(opcode) && zwords !== undefined) {
    const decoded = text
      ? text.decode(zwords as number[], {
          allowAbbreviations: true,
          allowIncompleteMultibyte: true,
        })
      : "";

    parts.push(`"${decoded.replace(/\n/g, "^")}"`);
  }

  void isCall; // reserved for future call-target annotation
  return parts.join(" ").replace(/\s+$/, "");
}

/** Format a raw variable number as sp / localN / gNN. */
export function formatVariable(number: number): string {
  const { kind, index } = classifyVariable(number);

  switch (kind) {
    case VariableKind.Stack:
      return "sp";
    case VariableKind.Local:
      return `local${index}`;
    case VariableKind.Global:
      return `g${hex(index, 2)}`;
  }
}

function formatOperand(operand: Operand): string {
  switch (operand.kind) {
    case OperandKind.LargeConstant:
      return `#${hex(operand.value, 4)}`;
    case OperandKind.SmallConstant:
      return `#${hex(operand.value, 2)}`;
    case OperandKind.Variable:
      return formatVariable(operand.value);
    default:
      return "?";
  }
}

function hex(n: number, width = 0): string {
  return n.toString(16).padStart(width, "0");
}
