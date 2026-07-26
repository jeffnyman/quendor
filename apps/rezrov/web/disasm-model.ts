import {
  InstructionReader,
  OperandKind,
  readRoutineHeader,
  formatInstruction,
  isReturnLike,
} from "quendor";
import type { Instruction, Machine } from "quendor";
import { escapeHtml, hex, signed } from "./format.ts";

// Pure disassembly-view logic: memory/instructions in → data or HTML strings
// out. No DOM access, so `renderDisasm` stays a thin shell that just commits
// the strings these produce.

const MAX_INSNS = 400;

/** The routine address of the current (innermost) call frame, if any. */
export function currentRoutineAddr(machine: Machine): number | undefined {
  return machine.getCallStack()[0]?.routineAddress;
}

/** The routine target of a `call*` with a constant operand (else null). */
export function callTarget(machine: Machine, insn: Instruction): number | null {
  if (!insn.opcode.name.startsWith("call")) return null;
  const op = insn.operands[0];
  if (op.kind === OperandKind.Variable || op.value === 0) return null;
  return machine.unpackRoutineAddress(op.value);
}

/** The in-routine target address of a branch or jump (else null). */
export function jumpOrBranchTarget(insn: Instruction): number | null {
  if (insn.branch && insn.branch.targetAddress !== undefined) {
    return insn.branch.targetAddress;
  }

  if (insn.opcode.name === "jump") {
    const op = insn.operands[0];
    if (op.kind !== OperandKind.Variable) {
      return insn.address + insn.length + signed(op.value) - 2;
    }
  }

  return null;
}

/**
 * Byte address where a routine's code begins, or null if `routineAddr` isn't a
 * routine (or is undefined). §5.5: in v1–5 the entry point (the main frame — no
 * caller, so returnPC 0) is raw code with no header, so code starts there.
 */
export function routineCodeStart(
  machine: Machine,
  routineAddr: number | undefined,
  following: boolean,
): number | null {
  if (routineAddr === undefined) return null;

  const atEntry = following && machine.version < 6 && machine.getCallStack()[0].returnPC === 0;
  if (atEntry) return routineAddr;

  try {
    return readRoutineHeader(machine.memory, machine.version, routineAddr).codeAddress;
  } catch {
    return null;
  }
}

/** Decode a routine's instructions from `codeStart`, stopping at a return-like op. */
export function decodeRoutine(machine: Machine, codeStart: number): Instruction[] {
  const reader = new InstructionReader(machine.memory, machine.version, codeStart);
  const insns: Instruction[] = [];

  for (let i = 0; i < MAX_INSNS; i++) {
    let insn: Instruction;
    try {
      insn = reader.next();
    } catch {
      break;
    }
    insns.push(insn);
    if (isReturnLike(insn)) break;
  }

  return insns;
}

/** Name in-routine branch/jump targets L1, L2, … in address order. */
export function computeLabels(insns: Instruction[]): Map<number, string> {
  const addrSet = new Set(insns.map((insn) => insn.address));
  const targets = new Set<number>();

  for (const insn of insns) {
    const t = jumpOrBranchTarget(insn);
    if (t !== null && addrSet.has(t)) targets.add(t);
  }

  const labels = new Map<number, string>();
  [...targets]
    .sort((a, b) => a - b)
    .forEach((addr, i) => {
      labels.set(addr, `L${i + 1}`);
    });
  return labels;
}

/** The disassembly toolbar's location label. */
export function routineLabel(routineAddr: number | undefined, following: boolean): string {
  if (routineAddr === undefined) return "";
  return `routine ${hex(routineAddr)}${following ? " · following PC" : ""}`;
}

/** The empty-state body shown when there's nothing to disassemble. */
export function disasmEmptyMsg(routineAddr: number | undefined): string {
  const msg =
    routineAddr === undefined
      ? "halted — use “goto” to inspect a routine"
      : `not a routine at ${hex(routineAddr)}`;
  return `<div class="empty">${msg}</div>`;
}

/** CSS classes for one instruction row. */
function rowClass(insn: Instruction, machine: Machine, breakpoints: ReadonlySet<number>): string {
  let cls = "dline";
  if (insn.address === machine.programCounter) cls += " pc";
  if (breakpoints.has(insn.address)) cls += " bp";
  return cls;
}

/** Inner HTML for one instruction row: address, text, and call/jump nav chips. */
function rowHtml(insn: Instruction, machine: Machine, labels: Map<number, string>): string {
  let html =
    `<span class="gutter"></span>` +
    `<span class="addr">${hex(insn.address)}</span>` +
    `<span class="text">${escapeHtml(formatInstruction(insn, machine.text))}</span>`;

  const ct = callTarget(machine, insn);
  if (ct !== null) html += `<span class="nav" data-nav="${ct}">→ ${hex(ct)}</span>`;

  const jt = jumpOrBranchTarget(insn);
  if (jt !== null) {
    const label = labels.get(jt) ?? hex(jt);
    html += `<span class="nav" data-scroll="${jt}">↳ ${label}</span>`;
  }

  return html;
}

/** The full disassembly body as HTML: label rows interleaved with instruction rows. */
export function disasmHtml(
  insns: Instruction[],
  machine: Machine,
  labels: Map<number, string>,
  breakpoints: ReadonlySet<number>,
): string {
  let html = "";

  for (const insn of insns) {
    if (labels.has(insn.address)) {
      html += `<div class="dlabel">${labels.get(insn.address)}:</div>`;
    }
    const cls = rowClass(insn, machine, breakpoints);
    html += `<div class="${cls}" data-addr="${insn.address}">${rowHtml(insn, machine, labels)}</div>`;
  }

  return html;
}
