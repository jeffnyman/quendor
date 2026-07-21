import type { Story } from "./story.ts";
import type { Memory } from "./memory.ts";
import { unpackRoutineAddress } from "./header.ts";
import { isCall } from "./opcodes.ts";
import { InstructionReader, isReturnLike, OperandKind, type Instruction } from "./instruction.ts";

/** One linear run of decoded instructions, starting at a routine or a jump/branch target. */
export interface DisassembledRun {
  readonly startAddress: number;
  /** True if `startAddress` is a routine header (locals count + v1-4 initial values). */
  readonly isRoutineStart: boolean;
  readonly instructions: readonly Instruction[];
  /** Set if decoding stopped early because of an unrecognized opcode or bad address. */
  readonly error: string | undefined;
}

interface QueueEntry {
  readonly address: number;
  readonly isRoutineStart: boolean;
}

/**
 * Walks every routine and jump/branch target reachable from `startAddress`,
 * decoding each as a linear run of instructions -- a txd-style whole-program
 * disassembler that follows the story's actual control flow rather than
 * reading bytes strictly in address order.
 *
 * Deliberately simple for now: a visited address is tracked only at the
 * granularity of a run's own start address, so a jump/branch that lands
 * inside an already-decoded run's byte range is walked again rather than
 * being recognized as already covered.
 */
export function disassembleReachable(story: Story, startAddress: number): DisassembledRun[] {
  const { memory, header } = story;
  // §5.4/§5.5: only v6 has a routine header at the entry point, reached via
  // a packed address; every other version's initial PC is already the
  // address of the first instruction. Mirrors Machine.setupInitialFrame.
  const isRoutineStart = header.version === 6;
  const address = isRoutineStart
    ? unpackRoutineAddress(header.version, startAddress, header.routinesOffset)
    : startAddress;
  const queue: QueueEntry[] = [{ address, isRoutineStart }];
  const visited = new Set<number>();
  const runs: DisassembledRun[] = [];

  for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
    if (visited.has(entry.address)) continue;

    visited.add(entry.address);

    const run = walkRun(memory, header.version, entry.address, entry.isRoutineStart);

    runs.push(run);

    for (const target of collectTargets(run.instructions, header.version, header.routinesOffset)) {
      if (!visited.has(target.address)) queue.push(target);
    }
  }

  return runs;
}

/** Decode instructions from `address` until a return-like opcode, or a decoding error. */
function walkRun(
  memory: Memory,
  version: number,
  address: number,
  isRoutineStart: boolean,
): DisassembledRun {
  const instructions: Instruction[] = [];

  try {
    const firstInstructionAddress = isRoutineStart
      ? skipRoutineHeader(memory, version, address)
      : address;
    const reader = new InstructionReader(memory, version, firstInstructionAddress);

    for (;;) {
      const insn = reader.next();

      instructions.push(insn);

      if (isReturnLike(insn)) break;
    }

    return { startAddress: address, isRoutineStart, instructions, error: undefined };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    return { startAddress: address, isRoutineStart, instructions, error };
  }
}

/** §5.2: a routine begins with a locals count, then (v1-4 only) their initial values. */
function skipRoutineHeader(memory: Memory, version: number, address: number): number {
  const localCount = memory.readByte(address);

  return version <= 4 ? address + 1 + localCount * 2 : address + 1;
}

/** Every call/jump/branch target reachable from a run's instructions. */
function collectTargets(
  instructions: readonly Instruction[],
  version: number,
  routinesOffset: number,
): QueueEntry[] {
  const targets: QueueEntry[] = [];

  for (const insn of instructions) {
    if (isCall(insn.opcode) && insn.operands.length > 0) {
      const first = insn.operands[0];

      if (first.kind !== OperandKind.Variable) {
        const address = unpackRoutineAddress(version, first.value, routinesOffset);

        targets.push({ address, isRoutineStart: true });
      }
    }

    if (insn.jumpTarget !== undefined) {
      targets.push({ address: insn.jumpTarget, isRoutineStart: false });
    }

    if (insn.branch?.targetAddress !== undefined) {
      targets.push({ address: insn.branch.targetAddress, isRoutineStart: false });
    }
  }

  return targets;
}
